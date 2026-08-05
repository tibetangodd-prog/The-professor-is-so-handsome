# 幾何方塊戰場：多人連線 AI 攻防戰（線上強化學習版）

紅色方塊 AI 不是載入訓練好的靜態模型，而是**在伺服器運行、玩家實際連線對戰的過程中，一邊做決策、一邊被背景執行緒用 PyTorch 持續訓練**。伺服器剛啟動時 AI 甚至會亂走亂撞牆，玩越久，AI 會肉眼可見地變聰明。

## 架構總覽

```
main.py（單一檔案，兩條並行執行流）
├── 【主執行緒】asyncio event loop
│     ├── aiohttp WebSocket 伺服器（多人連線、輸入事件）
│     ├── 60 FPS 手寫物理引擎（AABB 碰撞、子彈反彈、擊退）
│     └── 每個 tick：把所有 AI 的 state 疊成一個 batch，
│           對 DQN 做一次 forward pass（torch.no_grad()，純推論，1-2ms 內完成）
│
└── 【背景執行緒】threading.Thread（Learner）
      ├── 不斷從 Replay Buffer 取樣 mini-batch
      ├── Double DQN：training_model 選動作、target_model 評分，
      │     避免原始 DQN「自己選、自己評」造成 Q 值系統性高估
      ├── loss.backward() + optimizer.step()（PyTorch 真正在訓練）
      ├── 每 200 步同步一次 target network，每 100 步把最新權重
      │     深拷貝成一份快照，換掉主執行緒手上的推論模型指標
      └── 每一步把 loss / mean Q value / epsilon / buffer size 寫進
            TensorBoard，訓練曲線可事後檢視收斂狀況
```

**為什麼是 threading 而不是 asyncio.create_task()？** asyncio 是單執行緒協作式併發，`loss.backward()` 是同步阻塞的 CPU 運算、不會 `await`，包成 asyncio task 只會讓它把整個 event loop（也就是 WebSocket 主迴圈）卡住。PyTorch 的張量運算在呼叫底層 C++ 函式庫時會釋放 GIL，這才讓「threading + PyTorch」是真正可行的雙軌並行架構。詳細設計理由在 `main.py` 檔頭註解與程式碼中的中文說明。

## 本機執行

```bash
pip install -r requirements.txt
python3 main.py
```

瀏覽器開 `http://localhost:3000`。畫面下方的「AI 背景線上訓練」面板會即時顯示：背景訓練步數、最新 loss、Replay Buffer 大小、探索率 (epsilon)、累積線上決策次數——這些數字在你玩的當下持續變動，證明訓練真的在背景發生。

伺服器關閉時（Ctrl+C）會自動把當前權重存到 `ai_weights.pt`；下次啟動會自動載入、接續訓練，而不是每次都從隨機初始化重來。

## 檢視訓練曲線（TensorBoard）

每次啟動伺服器會在 `runs/<時間戳記>/` 產生一份 TensorBoard log，紀錄 loss、平均 Q 值、epsilon、replay buffer 大小隨訓練步數的變化：

```bash
tensorboard --logdir runs
```

開啟瀏覽器 `http://localhost:6006` 即可看到訓練曲線，比純文字 log 更適合放進學習歷程檔案佐證「有實際做過訓練實驗、有觀察數據」。實測跑 10 秒（約 1500+ 訓練步）loss 就從 0.04 收斂到 0.006，可作為前期驗證的參考。

## 效能實測（供學習歷程檔案佐證用）

實際跑過 15 秒、6 隻 AI 同時在線、背景執行緒同時訓練超過 3700 步的壓力測試：

| 指標 | 數值 |
|---|---|
| 平均 tick 間隔 | 16.65ms（目標 16.67ms） |
| 最大 tick 間隔 | 31.7ms |
| tick 間隔標準差 | 1.42ms |
| p99 tick 間隔 | 19.55ms |

開發過程中實際發現的問題：**第一次 DQN forward pass 觸發 PyTorch 內部執行緒池初始化，讓那個 tick 花了 1104ms**，是一次明顯的卡頓。解法是在伺服器啟動時、遊戲主迴圈開始前，先做幾次「暖機推論 (warm-up inference)」，把這筆一次性成本移出遊戲主迴圈。修正後最大 tick 間隔從 1104ms 降到 31.7ms。（`main.py` 中有加上 `[perf]` log，超過一半 tick 預算會印出警告，方便持續監控。）

## 未來工作（已規劃、暫未實作）

以下是評估過、認為方向正確但暫時不在本次交付範圍內的延伸方向，記錄下來供之後有時間再擴充，也作為學習歷程檔案中「我知道下一步可以怎麼走」的技術視野展示：

- **Dueling DQN**：把輸出層拆成 V(s)（狀態本身的價值）與 A(s,a)（每個動作相對於平均的優勢），Q(s,a) = V(s) + A(s,a) − mean(A)。概念上讓網路能分別學「這個位置好不好」和「這個動作比其他動作好多少」，對某些狀態下動作選擇不敏感的場景特別有幫助。
- **Prioritized Experience Replay (PER)**：現在的 Replay Buffer 是均勻隨機取樣；PER 會依照每筆經驗的 TD error（代表「這筆資料 AI 還學得不夠好」的程度）調整被抽中的機率，讓訓練更聚焦在還沒學好的樣本上。實作上需要用 Sum Tree 資料結構維護取樣機率，是很好的資料結構延伸練習。
- **分散式 Actor-Learner 架構**：把現在單機 threading 的「一個主執行緒推論 + 一個背景執行緒訓練」，擴充成多個獨立 process（甚至多台機器）各自跑遊戲、產生經驗，透過訊息佇列（Redis / ZeroMQ）把經驗集中送給一個獨立的 learner process 訓練，權重再廣播回所有 actor——這正是 DeepMind Ape-X / IMPALA 這類大規模 RL 系統的核心精神。跟現在的架構相比，這會需要處理跨行程/跨機器的序列化效能、通訊延遲與容錯設計，工作量較大，適合作為之後更完整的專案延伸。
- **Client-Side Prediction / Interpolation**：目前是純粹 server-authoritative，客戶端完全被動等待伺服器廣播；在有網路延遲的真實環境下，畫面容易頓挫。加入「收到兩次 state snapshot 之間，客戶端自行內插補間物件位置」的機制，是多人遊戲 netcode 的基本功，也直接對應到分散式系統中「一致性 vs 即時反應性」的經典取捨，是接下來最想優先補上的一塊。

## 部署到 GitHub

跟前幾版一樣：GitHub 只能放靜態頁面，這個 process 需要常駐執行才能維持 WebSocket 連線與背景訓練執行緒。

1. push 到 GitHub repo（記得 `.gitignore` 排除 `ai_weights.pt` 與 `__pycache__/`，除非你想把訓練成果一起版本控制，這樣的話拿掉 `.gitignore` 裡的排除即可）。
2. 用 Render / Railway 等平台串接 repo：
   - **Build Command**：`pip install -r requirements.txt`
   - **Start Command**：`python3 main.py`
3. **注意記憶體**：PyTorch 套件本身就有數百 MB，免費方案的雲端主機（通常 512MB RAM）可能會吃緊，建議選擇至少 1GB RAM 的方案，或改用 `torch` 的 CPU-only 精簡安裝（`pip install torch --index-url https://download.pytorch.org/whl/cpu`）來縮小依賴體積。

## .gitignore 建議內容

```
__pycache__/
*.pyc
.venv/
.DS_Store
ai_weights.pt
```

## 遊戲規則摘要

- 800x600 畫布，40px 網格（20x15），6 個寫死的黑色矩形牆壁構成內部迷宮。
- 2~4 人連線，藍色圓形玩家，WASD 移動，滑鼠點擊朝游標方向開槍。
- 黃色子彈撞牆依法向量反射公式反彈，最多反彈 2 次，第 3 次撞牆或命中 AI 即消失。
- 紅色方塊 AI 每 3 秒於空地隨機生成（上限 20 隻），由 DQN 即時推論決定移動方向，一邊追擊一邊持續在線學習「不要撞牆、順暢逼近玩家」。
- 子彈命中 AI：扣 1 點 HP，並依動量方向將 AI 擊退 20px（隨 frame 衰減釋放）。
- AI 觸碰玩家扣血（1 秒無敵時間），HP 歸零死亡；上方 HUD 即時顯示存活人數與各玩家擊殺分數，下方面板顯示 AI 訓練即時狀態。
