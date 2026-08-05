"""
============================================================
 幾何方塊戰場：多人連線 AI 攻防戰 - main.py
 【雙軌非同步架構：即時推論 (Actor) + 背景線上訓練 (Learner)】
------------------------------------------------------------
 這是「真．線上強化學習」架構，AI 不是載入一份訓練好的靜態權重，
 而是在伺服器持續運行、玩家實際連線對戰的過程中，一邊做決策、
 一邊把經驗塞進 Replay Buffer、一邊在背景被 PyTorch 訓練，
 權重每隔一段時間動態同步回主迴圈——AI 會隨著這場遊戲玩下去，
 肉眼可見地變聰明（伺服器剛啟動時 AI 甚至會亂走亂撞牆）。

 ------------------------------------------------------------
 架構設計核心問題：為什麼不能只用 asyncio.create_task() 做訓練？
 ------------------------------------------------------------
 asyncio 是「單執行緒協作式併發」：event loop 在同一條 Python
 執行緒裡切換不同 coroutine，切換的時機點是 `await`。但 PyTorch
 的 `loss.backward()` / `optimizer.step()` 是同步、阻塞、不會
 `await` 的 CPU 密集運算——如果把它包成一個 asyncio task 丟進
 event loop，它跑的當下會直接把整個 event loop「卡住」，WebSocket
 連線的 60FPS 主迴圈也會跟著一起卡住，這正是我們最不能接受的事。

 正確做法是把「學習者 (Learner)」放進一條獨立的 **OS 執行緒**
 （`threading.Thread`），讓它跟 asyncio event loop 所在的主執行緒
 並行推進。雖然 Python 有 GIL（Global Interpreter Lock），同一時間
 只有一條執行緒能真正執行 Python bytecode，但 PyTorch 的張量運算
 在呼叫底層 C++ / BLAS 函式庫時，**會主動釋放 GIL**，這段時間主執行緒
 的 asyncio event loop 就能拿回 GIL 繼續處理 WebSocket I/O 與物理迴圈。
 這就是為什麼「threading + PyTorch」在這裡是可行且合理的雙軌架構，
 而不是自欺欺人的假並行。

 ------------------------------------------------------------
 雙軌之間怎麼安全地共享資料？
 ------------------------------------------------------------
 1. Replay Buffer（主迴圈寫入、背景執行緒讀取取樣）
        用 threading.Lock 保護 deque 的 append 與 sample，
        因為這兩個操作本身雖然單步是安全的，但「取樣一個 batch」
        牽涉到多次隨機存取，必須視為一個不可分割的臨界區。

 2. 模型權重（背景執行緒寫入、主迴圈讀取做推論）
        主迴圈是效能熱點（要求 1-2ms 內完成），所以**完全不對它上鎖**。
        做法是：背景執行緒訓練用的是自己獨立的一份模型（training_model），
        每訓練滿 N 步，才把它「深拷貝」成一份唯讀快照，
        用一次單純的參考賦值（self._model = snapshot）換掉主迴圈手上的模型指標。
        CPython 保證單一屬性賦值在 GIL 保護下是原子操作，
        所以主迴圈任何時刻讀到的，一定是某個「完整版本」的模型，
        不會讀到權重更新到一半的中間狀態，也完全不需要等鎖。
============================================================
"""

import asyncio
import copy
import json
import math
import os
import random
import threading
import time
from collections import deque

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.tensorboard import SummaryWriter
from aiohttp import web, WSMsgType

# ============================================================
# 第一部分：地圖常數與手寫 2D 物理引擎
# ============================================================
CANVAS_W, CANVAS_H = 800, 600
CELL = 40
GRID_W, GRID_H = CANVAS_W // CELL, CANVAS_H // CELL  # 20 x 15

TICK_RATE = 60
TICK_DT = 1.0 / TICK_RATE

PLAYER_RADIUS = 15
PLAYER_SPEED = 4
PLAYER_MAX_HP = 3
PLAYER_HIT_COOLDOWN = 1.0

BULLET_RADIUS = 4
BULLET_SPEED = 9
BULLET_MAX_BOUNCES = 2

AI_SIZE = 30
AI_MAX_HP = 3
AI_SPEED = 2.1
AI_SPAWN_INTERVAL = 3.0
AI_KNOCKBACK_DISTANCE = 20
AI_KNOCKBACK_DECAY = 0.82
MAX_AI_COUNT = 20          # 安全上限：避免長時間運行下 AI 數量無限增長拖垮伺服器

MAX_PLAYERS = 4

# 寫死至少 5 個黑色矩形牆壁（格子座標），構成內部迷宮
WALL_CELLS_DEF = [
    dict(c=8, r=6, w=4, h=1),
    dict(c=2, r=2, w=1, h=5),
    dict(c=2, r=9, w=6, h=1),
    dict(c=17, r=2, w=1, h=5),
    dict(c=10, r=9, w=6, h=1),
    dict(c=9, r=2, w=1, h=3),
]
WALLS = [
    dict(x=w['c'] * CELL, y=w['r'] * CELL, w=w['w'] * CELL, h=w['h'] * CELL)
    for w in WALL_CELLS_DEF
]

blocked_grid = [[False] * GRID_W for _ in range(GRID_H)]
for w in WALL_CELLS_DEF:
    for dr in range(w['h']):
        for dc in range(w['w']):
            r, c = w['r'] + dr, w['c'] + dc
            if 0 <= r < GRID_H and 0 <= c < GRID_W:
                blocked_grid[r][c] = True


def cell_blocked(c, r):
    if c < 0 or c >= GRID_W or r < 0 or r >= GRID_H:
        return True
    return blocked_grid[r][c]


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def normalize(dx, dy):
    length = math.sqrt(dx * dx + dy * dy) or 1.0
    return dx / length, dy / length


def circle_rect_collide(cx, cy, radius, rx, ry, rw, rh):
    """圓形 vs 矩形 AABB 碰撞偵測（最近點法）"""
    closest_x = clamp(cx, rx, rx + rw)
    closest_y = clamp(cy, ry, ry + rh)
    dx, dy = cx - closest_x, cy - closest_y
    return (dx * dx + dy * dy) < radius * radius


def resolve_circle_rect(circle, rect):
    """把圓形從矩形中推出，回傳是否有實際發生碰撞修正"""
    closest_x = clamp(circle['x'], rect['x'], rect['x'] + rect['w'])
    closest_y = clamp(circle['y'], rect['y'], rect['y'] + rect['h'])
    dx = circle['x'] - closest_x
    dy = circle['y'] - closest_y
    dist_sq = dx * dx + dy * dy
    r = circle['radius']
    if dist_sq < r * r:
        dist = math.sqrt(dist_sq)
        if dist < 1e-6:
            dx, dy, dist = 1.0, 0.0, 1.0
        overlap = r - dist
        nx, ny = dx / dist, dy / dist
        circle['x'] += nx * overlap
        circle['y'] += ny * overlap
        return True
    return False


def reflect_bullet_off_wall(bullet, wall):
    """子彈撞牆反彈：v' = v - 2*(v·n)*n（向量內積反射公式）"""
    closest_x = clamp(bullet['x'], wall['x'], wall['x'] + wall['w'])
    closest_y = clamp(bullet['y'], wall['y'], wall['y'] + wall['h'])
    dx = bullet['x'] - closest_x
    dy = bullet['y'] - closest_y
    dist = math.sqrt(dx * dx + dy * dy)
    if dist < 1e-6:
        dx, dy = bullet['vx'], bullet['vy']
        dist = math.sqrt(dx * dx + dy * dy) or 1.0
    nx, ny = dx / dist, dy / dist

    overlap = BULLET_RADIUS - dist
    if overlap > 0:
        bullet['x'] += nx * overlap
        bullet['y'] += ny * overlap

    dot = bullet['vx'] * nx + bullet['vy'] * ny
    bullet['vx'] = bullet['vx'] - 2 * dot * nx
    bullet['vy'] = bullet['vy'] - 2 * dot * ny


def cast_ray(x, y, angle_rad, max_dist, step=4.0):
    """簡化版 LiDAR 感測射線：回傳命中牆壁/邊界前的正規化距離（1.0 = 暢通）"""
    dx, dy = math.cos(angle_rad), math.sin(angle_rad)
    dist = 0.0
    while dist < max_dist:
        px, py = x + dx * dist, y + dy * dist
        if px < 0 or px > CANVAS_W or py < 0 or py > CANVAS_H:
            return dist / max_dist
        for wall in WALLS:
            if wall['x'] <= px <= wall['x'] + wall['w'] and wall['y'] <= py <= wall['y'] + wall['h']:
                return dist / max_dist
        dist += step
    return 1.0


def random_open_cell():
    for _ in range(200):
        c = random.randint(0, GRID_W - 1)
        r = random.randint(0, GRID_H - 1)
        if not cell_blocked(c, r):
            return c, r
    return 0, 0


# ============================================================
# 第二部分：強化學習核心 — DQN 模型、ModelHolder、Replay Buffer
# ============================================================
STATE_DIM = 10   # [dx, dy, 8 個方向的感測器讀數]
ACTION_DIM = 8    # 8 個方向的離散移動動作
HIDDEN = 32

SENSOR_MAX_DIST = 100.0

# 8 個方向的單位移動向量（45 度為單位，含斜向，動作比 4 方向更平滑）
ACTION_VECTORS = [
    (math.cos(math.radians(k * 45)), -math.sin(math.radians(k * 45)))
    for k in range(8)
]

# ---- reward shaping 常數 ----
DIST_REWARD_SCALE = 0.05   # 逼近玩家的距離差 * 此係數
STEP_PENALTY = -0.01        # 每個決策的固定小懲罰，鼓勵有效率地移動而非亂晃
WALL_PENALTY = 0.6           # 撞牆懲罰（絕對值，reward -= WALL_PENALTY）
CATCH_BONUS = 5.0             # 成功碰到玩家（追擊任務的「成功」訊號）
DEATH_PENALTY = 3.0            # 被玩家擊殺時的懲罰（終端狀態）

# ---- DQN 訓練超參數 ----
GAMMA = 0.95
LR = 5e-4
BATCH_SIZE = 64
REPLAY_CAPACITY = 30000
MIN_REPLAY_BEFORE_TRAIN = 300
TARGET_SYNC_EVERY = 200          # 背景訓練每滿 200 步，同步一次 target network
INFERENCE_SYNC_EVERY = 100        # 背景訓練每滿 100 步，把最新權重同步回主迴圈（符合需求：滿 100 步同步一次）

EPS_START, EPS_END, EPS_DECAY_ONLINE_STEPS = 0.35, 0.05, 15000

PERSIST_WEIGHTS_PATH = os.path.join(os.path.dirname(__file__), 'ai_weights.pt')


def current_epsilon(online_steps):
    """Epsilon 隨著『累積線上決策次數』衰減，而非離線 episode 數—— 這是即時系統與離線訓練腳本的根本差異"""
    if online_steps >= EPS_DECAY_ONLINE_STEPS:
        return EPS_END
    frac = online_steps / EPS_DECAY_ONLINE_STEPS
    return EPS_START + (EPS_END - EPS_START) * frac


class DQN(nn.Module):
    """Q-network：全連接層 + ReLU，輸出 8 個離散動作各自的 Q 值"""

    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(STATE_DIM, HIDDEN), nn.ReLU(),
            nn.Linear(HIDDEN, HIDDEN), nn.ReLU(),
            nn.Linear(HIDDEN, ACTION_DIM),
        )

    def forward(self, x):
        return self.net(x)


class ModelHolder:
    """
    主迴圈讀取推論模型的唯一入口。
    讀取端 (get) 完全 lock-free；寫入端 (set) 用 lock 保護，
    依賴 CPython 對單一屬性賦值的原子性，讓兩端不互相阻塞。
    """

    def __init__(self, model: nn.Module):
        self._model = model
        self._write_lock = threading.Lock()

    def get(self) -> nn.Module:
        return self._model

    def set(self, new_model: nn.Module):
        with self._write_lock:
            self._model = new_model


class ReplayBuffer:
    """執行緒安全的經驗回放緩衝區：主迴圈寫入 (push)，背景執行緒讀取取樣 (sample)"""

    def __init__(self, capacity):
        self._buffer = deque(maxlen=capacity)
        self._lock = threading.Lock()

    def push(self, state, action, reward, next_state, done):
        with self._lock:
            self._buffer.append((state, action, reward, next_state, done))

    def sample(self, batch_size):
        with self._lock:
            if len(self._buffer) < max(batch_size, MIN_REPLAY_BEFORE_TRAIN):
                return None
            batch = random.sample(self._buffer, batch_size)
        states = np.array([b[0] for b in batch], dtype=np.float32)
        actions = np.array([b[1] for b in batch], dtype=np.int64)
        rewards = np.array([b[2] for b in batch], dtype=np.float32)
        next_states = np.array([b[3] for b in batch], dtype=np.float32)
        dones = np.array([b[4] for b in batch], dtype=np.float32)
        return states, actions, rewards, next_states, dones

    def __len__(self):
        with self._lock:
            return len(self._buffer)


def make_eval_snapshot(model: nn.Module) -> nn.Module:
    """深拷貝一份『唯讀、不追蹤梯度』的推論用快照，避免背景執行緒繼續更新的同一顆模型被拿去推論"""
    snapshot = copy.deepcopy(model)
    snapshot.eval()
    for p in snapshot.parameters():
        p.requires_grad_(False)
    return snapshot


# ---- 建立全域的三份模型：訓練用、target network、推論快照 ----
training_model = DQN()
target_model = DQN()
target_model.load_state_dict(training_model.state_dict())
target_model.eval()
for _p in target_model.parameters():
    _p.requires_grad_(False)

if os.path.exists(PERSIST_WEIGHTS_PATH):
    training_model.load_state_dict(torch.load(PERSIST_WEIGHTS_PATH, map_location='cpu'))
    target_model.load_state_dict(training_model.state_dict())
    print(f'[RL] 已載入既有權重繼續學習： {PERSIST_WEIGHTS_PATH}')
else:
    print('[RL] 找不到既有權重，AI 將從隨機初始化開始，肉眼可見地從「亂走」進步到「會追人」')

model_holder = ModelHolder(make_eval_snapshot(training_model))
replay_buffer = ReplayBuffer(REPLAY_CAPACITY)

# ---- PyTorch 暖機：實測發現「第一次 forward pass」會觸發執行緒池與運算子初始化，
#      耗時可達 1000ms 以上，若讓它發生在遊戲主迴圈的第一個 tick，會造成明顯卡頓。
#      解法：伺服器啟動時就先跑幾次假的 forward pass，把這筆初始化成本挪到遊戲開始之前。----
with torch.no_grad():
    _dummy = torch.zeros((max(BATCH_SIZE, MAX_AI_COUNT), STATE_DIM), dtype=torch.float32)
    for _m in (training_model, target_model, model_holder.get()):
        _m(_dummy)
print('[RL] PyTorch 暖機完成，主迴圈第一個 tick 不會再有初始化延遲尖峰')

stats = {
    'train_steps': 0,
    'latest_loss': 0.0,
    'online_steps': 0,
}

# ---- TensorBoard：紀錄 loss / epsilon / reward 等訓練曲線，供事後檢視收斂狀況 ----
TENSORBOARD_LOG_DIR = os.path.join(os.path.dirname(__file__), 'runs', time.strftime('%Y%m%d-%H%M%S'))
tb_writer = SummaryWriter(log_dir=TENSORBOARD_LOG_DIR)
print(f'[RL] TensorBoard log 目錄： {TENSORBOARD_LOG_DIR}（用 `tensorboard --logdir runs` 檢視訓練曲線）')


def training_loop(stop_event: threading.Event):
    """
    【背景學習執行緒】(Learner)
    獨立於 asyncio event loop 之外的 OS 執行緒，不斷從 Replay Buffer
    取樣、做 forward / backward / optimizer.step()，並定期把權重同步回主迴圈。

    這裡用的是 Double DQN（van Hasselt et al., 2015）而非原始 DQN：
    原始 DQN 用同一個 target_model 「選出最好的動作」又「幫這個動作估值」，
    兩件事都交給同一個網路，會讓估值系統性偏高（因為 max 運算對雜訊天生樂觀）。
    Double DQN 把這兩件事拆開：用還在更新中的 training_model 選動作，
    但用相對穩定的 target_model 幫這個動作評分，兩個網路互相制衡，
    大幅降低 Q 值被高估的問題，訓練也更穩定。
    """
    optimizer = optim.Adam(training_model.parameters(), lr=LR)
    loss_fn = nn.MSELoss()

    while not stop_event.is_set():
        batch = replay_buffer.sample(BATCH_SIZE)
        if batch is None:
            time.sleep(0.02)  # 資料還不夠，短暫休息避免空轉浪費 CPU
            continue

        states, actions, rewards, next_states, dones = batch
        states_t = torch.from_numpy(states)
        actions_t = torch.from_numpy(actions)
        rewards_t = torch.from_numpy(rewards)
        next_states_t = torch.from_numpy(next_states)
        dones_t = torch.from_numpy(dones)

        # ---- Double DQN 的 TD target ----
        # 1) 「選動作」：用 training_model（目前正在更新、最新鮮）算出 next_state 下最好的動作是哪個
        # 2) 「評估值」：把這個動作丟給 target_model（比較穩定、落後幾步）去問它「這個動作值多少」
        with torch.no_grad():
            best_actions = training_model(next_states_t).argmax(dim=1)
            next_q_target = target_model(next_states_t)
            max_next_q = next_q_target.gather(1, best_actions.unsqueeze(1)).squeeze(1)
            td_target = rewards_t + GAMMA * max_next_q * (1.0 - dones_t)

        q_values = training_model(states_t)
        q_selected = q_values.gather(1, actions_t.unsqueeze(1)).squeeze(1)

        loss = loss_fn(q_selected, td_target)
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()

        stats['train_steps'] += 1
        stats['latest_loss'] = float(loss.item())

        # ---- TensorBoard：把訓練過程中的關鍵數值畫成曲線，事後可以檢視收斂狀況 ----
        tb_writer.add_scalar('train/loss', stats['latest_loss'], stats['train_steps'])
        tb_writer.add_scalar('train/mean_batch_reward', float(rewards_t.mean().item()), stats['train_steps'])
        tb_writer.add_scalar('train/mean_q_value', float(q_selected.mean().item()), stats['train_steps'])
        tb_writer.add_scalar('rl/epsilon', current_epsilon(stats['online_steps']), stats['train_steps'])
        tb_writer.add_scalar('rl/replay_buffer_size', len(replay_buffer), stats['train_steps'])

        if stats['train_steps'] % TARGET_SYNC_EVERY == 0:
            target_model.load_state_dict(training_model.state_dict())

        if stats['train_steps'] % INFERENCE_SYNC_EVERY == 0:
            model_holder.set(make_eval_snapshot(training_model))

        # 主動讓出時間片：訓練迴圈技術上可以不停跑，但刻意讓一下，
        # 讓主執行緒的 asyncio event loop 能更頻繁地拿到 GIL 處理 WebSocket I/O
        time.sleep(0.001)


# ============================================================
# 第三部分：遊戲實體與狀態
# ============================================================
players = {}
bullets = []
ais = []

counters = {
    'next_player_id': 1,
    'next_bullet_id': 1,
    'next_ai_id': 1,
    'slot_counter': 0,
    'last_ai_spawn': time.monotonic(),
}

SPAWN_POINTS = [(50, 50), (750, 50), (50, 550), (750, 550)]


def make_player(pid, ws, slot_index):
    sx, sy = SPAWN_POINTS[slot_index % len(SPAWN_POINTS)]
    return {
        'id': pid, 'ws': ws,
        'x': float(sx), 'y': float(sy),
        'radius': PLAYER_RADIUS,
        'hp': PLAYER_MAX_HP,
        'alive': True,
        'keys': {'w': False, 'a': False, 's': False, 'd': False},
        'kills': 0,
        'last_hit_at': 0.0,
    }


def spawn_ai():
    c, r = random_open_cell()
    cx, cy = c * CELL + CELL / 2, r * CELL + CELL / 2
    ais.append({
        'id': counters['next_ai_id'], 'x': cx, 'y': cy, 'size': AI_SIZE, 'hp': AI_MAX_HP,
        'knockback': [0.0, 0.0],
        'last_state': None, 'last_action': None,  # 供死亡時推入終端 (terminal) transition 使用
    })
    counters['next_ai_id'] += 1


def build_state(ai, target):
    dx, dy = normalize(target['x'] - ai['x'], target['y'] - ai['y'])
    sensors = [cast_ray(ai['x'], ai['y'], math.radians(k * 45), SENSOR_MAX_DIST) for k in range(8)]
    return [dx, dy] + sensors


# ============================================================
# 第四部分：60 FPS 主迴圈更新邏輯
# ============================================================
def update_players():
    for p in players.values():
        if not p['alive']:
            continue
        dx = (1 if p['keys']['d'] else 0) - (1 if p['keys']['a'] else 0)
        dy = (1 if p['keys']['s'] else 0) - (1 if p['keys']['w'] else 0)
        if dx != 0 or dy != 0:
            nx, ny = normalize(dx, dy)
            p['x'] += nx * PLAYER_SPEED
            p['y'] += ny * PLAYER_SPEED
        p['x'] = clamp(p['x'], p['radius'], CANVAS_W - p['radius'])
        p['y'] = clamp(p['y'], p['radius'], CANVAS_H - p['radius'])
        for wall in WALLS:
            resolve_circle_rect(p, wall)


def update_bullets():
    global bullets
    survivors = []
    for b in bullets:
        b['x'] += b['vx']
        b['y'] += b['vy']
        if b['x'] < 0 or b['x'] > CANVAS_W or b['y'] < 0 or b['y'] > CANVAS_H:
            continue

        destroyed = False
        for wall in WALLS:
            if circle_rect_collide(b['x'], b['y'], BULLET_RADIUS, wall['x'], wall['y'], wall['w'], wall['h']):
                if b['bounces'] >= BULLET_MAX_BOUNCES:
                    destroyed = True
                else:
                    reflect_bullet_off_wall(b, wall)
                    b['bounces'] += 1
                break
        if destroyed:
            continue

        for ai in ais:
            half = ai['size'] / 2
            if circle_rect_collide(b['x'], b['y'], BULLET_RADIUS,
                                    ai['x'] - half, ai['y'] - half, ai['size'], ai['size']):
                ai['hp'] -= 1
                dirx, diry = normalize(b['vx'], b['vy'])
                ai['knockback'][0] += dirx * AI_KNOCKBACK_DISTANCE
                ai['knockback'][1] += diry * AI_KNOCKBACK_DISTANCE
                if ai['hp'] <= 0:
                    owner = players.get(b['owner_id'])
                    if owner:
                        owner['kills'] += 1
                destroyed = True
                break

        if not destroyed:
            survivors.append(b)

    bullets = survivors


def update_ais():
    """
    每 tick 呼叫一次，包含三件事：
      1. 處理上一輪已死亡的 AI，推入終端 (done=True) transition
      2. 【批次】收集所有存活 AI 的 state，一次 forward pass 做決策（而非逐一呼叫，降低延遲）
      3. 套用物理引擎移動、計算 reward、推進 Replay Buffer、處理與玩家的碰撞傷害
    """
    global ais

    # ---- 1. 處理死亡 AI 的終端 transition ----
    dead_ais = [ai for ai in ais if ai['hp'] <= 0]
    for ai in dead_ais:
        if ai['last_state'] is not None and ai['last_action'] is not None:
            replay_buffer.push(ai['last_state'], ai['last_action'], -DEATH_PENALTY, ai['last_state'], True)
    ais = [ai for ai in ais if ai['hp'] > 0]

    alive_players = [p for p in players.values() if p['alive']]
    if not alive_players or not ais:
        return

    # ---- 2. 批次推論：把所有 AI 的 state 疊成一個 batch，一次 forward pass ----
    targets = []
    states = []
    for ai in ais:
        nearest = min(alive_players, key=lambda p: (p['x'] - ai['x']) ** 2 + (p['y'] - ai['y']) ** 2)
        targets.append(nearest)
        states.append(build_state(ai, nearest))

    state_batch = torch.tensor(states, dtype=torch.float32)
    model = model_holder.get()
    with torch.no_grad():
        q_batch = model(state_batch).numpy()  # shape: (num_ai, ACTION_DIM)

    eps = current_epsilon(stats['online_steps'])
    now = time.monotonic()

    # ---- 3. 逐一套用動作、物理引擎、reward、寫入 replay buffer ----
    for i, ai in enumerate(ais):
        target = targets[i]
        state_t = states[i]

        if random.random() < eps:
            action = random.randrange(ACTION_DIM)
        else:
            action = int(np.argmax(q_batch[i]))

        dist_before = math.hypot(target['x'] - ai['x'], target['y'] - ai['y'])

        vx, vy = ACTION_VECTORS[action]
        intended_x = clamp(ai['x'] + vx * AI_SPEED, ai['size'] / 2, CANVAS_W - ai['size'] / 2)
        intended_y = clamp(ai['y'] + vy * AI_SPEED, ai['size'] / 2, CANVAS_H - ai['size'] / 2)

        circle = {'x': intended_x, 'y': intended_y, 'radius': ai['size'] / 2}
        collided = False
        for wall in WALLS:
            if resolve_circle_rect(circle, wall):
                collided = True
        ai['x'], ai['y'] = circle['x'], circle['y']

        # 套用先前累積的擊退動量（隨 frame 衰減釋放）
        kx, ky = ai['knockback']
        if abs(kx) > 0.01 or abs(ky) > 0.01:
            ai['x'] += kx
            ai['y'] += ky
            ai['knockback'][0] *= AI_KNOCKBACK_DECAY
            ai['knockback'][1] *= AI_KNOCKBACK_DECAY
        else:
            ai['knockback'][0] = 0.0
            ai['knockback'][1] = 0.0

        half = ai['size'] / 2
        ai['x'] = clamp(ai['x'], half, CANVAS_W - half)
        ai['y'] = clamp(ai['y'], half, CANVAS_H - half)

        dist_after = math.hypot(target['x'] - ai['x'], target['y'] - ai['y'])

        reward = (dist_before - dist_after) * DIST_REWARD_SCALE + STEP_PENALTY
        if collided:
            reward -= WALL_PENALTY

        # AI vs 玩家碰撞：扣血 + 給予「追到目標」的獎勵訊號
        for p in alive_players:
            if not p['alive']:
                continue
            if circle_rect_collide(p['x'], p['y'], p['radius'], ai['x'] - half, ai['y'] - half, ai['size'], ai['size']):
                reward += CATCH_BONUS
                if now - p['last_hit_at'] > PLAYER_HIT_COOLDOWN:
                    p['hp'] -= 1
                    p['last_hit_at'] = now
                    if p['hp'] <= 0:
                        p['alive'] = False

        next_state = build_state(ai, target)
        replay_buffer.push(state_t, action, reward, next_state, False)

        ai['last_state'] = state_t
        ai['last_action'] = action

        stats['online_steps'] += 1


def try_spawn_ai():
    now = time.monotonic()
    if now - counters['last_ai_spawn'] >= AI_SPAWN_INTERVAL and len(ais) < MAX_AI_COUNT:
        spawn_ai()
        counters['last_ai_spawn'] = now


def build_state_message():
    return {
        'type': 'state',
        'players': [
            {'id': p['id'], 'x': p['x'], 'y': p['y'], 'hp': p['hp'], 'alive': p['alive'], 'kills': p['kills']}
            for p in players.values()
        ],
        'bullets': [{'x': b['x'], 'y': b['y']} for b in bullets],
        'ais': [{'id': a['id'], 'x': a['x'], 'y': a['y'], 'hp': a['hp'], 'size': a['size']} for a in ais],
        'walls': WALLS,
        'aliveCount': sum(1 for p in players.values() if p['alive']),
        'totalPlayers': len(players),
        'aiTraining': {
            'trainSteps': stats['train_steps'],
            'latestLoss': round(stats['latest_loss'], 4),
            'bufferSize': len(replay_buffer),
            'epsilon': round(current_epsilon(stats['online_steps']), 3),
            'onlineSteps': stats['online_steps'],
        },
    }


async def broadcast(message: dict):
    if not players:
        return
    data = json.dumps(message)
    dead_ids = []
    for pid, p in players.items():
        ws = p['ws']
        if ws.closed:
            dead_ids.append(pid)
            continue
        try:
            await ws.send_str(data)
        except Exception:
            dead_ids.append(pid)
    for pid in dead_ids:
        players.pop(pid, None)


async def game_loop(app):
    """【主迴圈執行緒 = asyncio 主執行緒】60 FPS，處理物理與 AI 推論（不含訓練）"""
    next_tick = time.monotonic()
    while True:
        t0 = time.perf_counter()

        update_players()
        update_bullets()
        update_ais()          # 內含批次 DQN forward pass（推論，no_grad，不做梯度計算）
        try_spawn_ai()
        await broadcast(build_state_message())

        elapsed_ms = (time.perf_counter() - t0) * 1000
        if elapsed_ms > 8.0:  # tick 花超過一半的預算(16.67ms)才印警告,避免洗版
            print(f'[perf] tick 花費 {elapsed_ms:.2f}ms (ai={len(ais)})')

        next_tick += TICK_DT
        sleep_time = next_tick - time.monotonic()
        if sleep_time > 0:
            await asyncio.sleep(sleep_time)
        else:
            next_tick = time.monotonic()


# ============================================================
# 第五部分：HTTP + WebSocket 路由
# ============================================================
async def index_handler(request):
    path = os.path.join(os.path.dirname(__file__), 'public', 'index.html')
    with open(path, 'r', encoding='utf-8') as f:
        return web.Response(text=f.read(), content_type='text/html')


async def ws_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    if len(players) >= MAX_PLAYERS:
        await ws.send_str(json.dumps({'type': 'full'}))
        await ws.close()
        return ws

    pid = counters['next_player_id']
    counters['next_player_id'] += 1
    player = make_player(pid, ws, counters['slot_counter'])
    counters['slot_counter'] += 1
    players[pid] = player

    await ws.send_str(json.dumps({
        'type': 'init', 'id': pid,
        'canvas': {'w': CANVAS_W, 'h': CANVAS_H, 'cell': CELL},
        'walls': WALLS,
    }))
    print(f'[+] Player {pid} connected ({len(players)}/{MAX_PLAYERS})')

    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                except (json.JSONDecodeError, TypeError):
                    continue

                if data.get('type') == 'keys':
                    player['keys']['w'] = bool(data.get('w'))
                    player['keys']['a'] = bool(data.get('a'))
                    player['keys']['s'] = bool(data.get('s'))
                    player['keys']['d'] = bool(data.get('d'))
                elif data.get('type') == 'shoot':
                    if not player['alive']:
                        continue
                    mx, my = data.get('mx', 0), data.get('my', 0)
                    dirx, diry = normalize(mx - player['x'], my - player['y'])
                    offset = player['radius'] + BULLET_RADIUS + 1
                    bullets.append({
                        'id': counters['next_bullet_id'],
                        'x': player['x'] + dirx * offset,
                        'y': player['y'] + diry * offset,
                        'vx': dirx * BULLET_SPEED,
                        'vy': diry * BULLET_SPEED,
                        'bounces': 0,
                        'owner_id': player['id'],
                    })
                    counters['next_bullet_id'] += 1
            elif msg.type == WSMsgType.ERROR:
                break
    finally:
        players.pop(pid, None)
        print(f'[-] Player {pid} disconnected ({len(players)}/{MAX_PLAYERS})')

    return ws


# ============================================================
# 第六部分：啟動與關閉（同時掛載 asyncio 主迴圈任務 + 背景學習執行緒）
# ============================================================
async def start_background_tasks(app):
    app['game_loop_task'] = asyncio.create_task(game_loop(app))

    app['stop_event'] = threading.Event()
    app['training_thread'] = threading.Thread(
        target=training_loop, args=(app['stop_event'],), daemon=True, name='dqn-learner'
    )
    app['training_thread'].start()
    print('[RL] 背景學習執行緒已啟動（threading.Thread，與 asyncio 主迴圈並行）')


async def cleanup_background_tasks(app):
    app['game_loop_task'].cancel()
    try:
        await app['game_loop_task']
    except asyncio.CancelledError:
        pass

    app['stop_event'].set()
    app['training_thread'].join(timeout=3)

    torch.save(training_model.state_dict(), PERSIST_WEIGHTS_PATH)
    print(f'[RL] 已將本次學習成果存至 {PERSIST_WEIGHTS_PATH}，下次啟動會接續訓練')

    tb_writer.flush()
    tb_writer.close()
    print(f'[RL] TensorBoard log 已寫入 {TENSORBOARD_LOG_DIR}')


def create_app():
    app = web.Application()
    app.router.add_get('/', index_handler)
    app.router.add_get('/ws', ws_handler)
    app.on_startup.append(start_background_tasks)
    app.on_cleanup.append(cleanup_background_tasks)
    return app


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3000))
    print('====================================================')
    print(f'  幾何方塊戰場（線上強化學習版）已啟動： http://localhost:{port}')
    print(f'  Grid: {GRID_W}x{GRID_H} (cell={CELL}px) | Walls: {len(WALLS)}')
    print(f'  DQN state_dim={STATE_DIM} action_dim={ACTION_DIM} hidden={HIDDEN}')
    print('====================================================')
    web.run_app(create_app(), port=port)
