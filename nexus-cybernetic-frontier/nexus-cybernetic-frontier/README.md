# NEXUS: CYBERNETIC FRONTIER

一款純前端、無後端的 Cyberpunk Roguelite ARPG。完全用原生 Web API（Canvas 2D、ES Modules、IndexedDB、Web Audio API）打造，不需要任何建置工具就能執行。

> **目前狀態：Phase 1 / 18 — 引擎架構（Engine Architecture）**
> 原始規格書把整個專案切成 18 個 Phase，並且明確要求不要一次生成整個遊戲。這裡先把可重用的引擎骨架蓋好、跑起來，之後每個 Phase 都疊加在這個基礎上，不重寫底層。

## 這個階段做了什麼

- **Game Loop**：固定時間步（fixed-timestep）+ 累加器模式，遊戲邏輯更新頻率和畫面更新頻率解耦。
- **ECS**：Entity 只是數字 ID；Component 是純資料；System 各自只做一件事（讀輸入 → 移動 → 渲染）。
- **Scene Manager**：Boot Scene → Demo Scene 的場景切換。
- **Event Bus**：發布/訂閱機制，之後讓 Combat、Quest、Faction 等系統彼此解耦，不必互相 import 內部細節。
- **Input Manager**：鍵盤／滑鼠狀態，支援「持續按住」與「剛按下」兩種判斷；開發者主控台取得焦點時會自動放開所有按鍵，不會卡鍵。
- **Resource / Audio / Save Manager**：資源快取骨架、Web Audio 播放骨架、IndexedDB 存檔（已經有 `schemaVersion` 欄位和 migration 掛勾點）。
- **Debug Manager**：`F3` 開關效能面板（FPS / Frame Time / Entity 數），`` ` ``（反引號）開關開發者主控台，目前可用指令 `help`、`teleport <x> <y>`、`hp <0-100>`、`energy <0-100>`。
- **Renderer**：Canvas 2D + 攝影機（世界座標轉螢幕座標）、高 DPI 處理、視窗縮放。
- **Demo Scene**：一個可以用 WASD 移動的角色、攝影機跟隨、散落的地標——用來證明整條管線真的能動，不是紙上談兵。

程式碼裡的每個 `.js` 都跑過 `node --check`；ECS / EventBus / MathUtils 這些不碰瀏覽器 API 的核心邏輯，也另外寫了 smoke test 實際執行驗證過。

## 操作方式

| 按鍵 | 功能 |
| --- | --- |
| 滑鼠點擊 / 任意鍵 | 略過開場畫面 |
| W A S D／方向鍵 | 移動 |
| F3 | 開關效能除錯面板 |
| \`（反引號） | 開關開發者主控台 |

## 在本機執行

ES Modules 受瀏覽器 CORS 限制，**不能直接雙擊打開 `index.html`**，需要跑一個簡單的靜態伺服器：

```bash
# 方法 1：Python（大多數系統已內建）
python3 -m http.server 8080

# 方法 2：Node.js，不需要安裝任何套件
npx serve .

# 方法 3：VS Code 的 "Live Server" 套件，右鍵 index.html → Open with Live Server
```

啟動後開啟 `http://localhost:8080`（依你用的工具調整埠號）。

## 部署到 GitHub Pages

```bash
git init
git add .
git commit -m "NEXUS: Cybernetic Frontier - Phase 1"
git branch -M main
git remote add origin <你的 repo 網址>
git push -u origin main
```

接著在 GitHub 上：

1. `Settings` → `Pages`
2. Source 選 `Deploy from a branch`
3. Branch 選 `main`，資料夾選 `/ (root)`
4. 存檔後等幾分鐘，會拿到 `https://<帳號>.github.io/<repo>/`

整個專案沒有後端、沒有建置步驟，GitHub Pages 可以直接把這個資料夾當靜態網站發布。

## 專案結構

```
nexus-cybernetic-frontier/
├── index.html
├── css/
│   └── main.css
├── src/
│   ├── main.js         # 進入點：組裝所有 Manager 並啟動 Game Loop
│   ├── core/            # Game Loop、Scene/Event/Input/Audio/Save/Debug Manager
│   ├── ecs/              # Entity / Component / System Manager + World 組合根
│   ├── rendering/          # Canvas 2D Renderer + Camera
│   ├── components/          # 純資料元件（Transform、Velocity...）
│   ├── systems/               # PlayerInput / Movement / Render
│   ├── scenes/                  # BootScene、DemoScene
│   └── utils/                    # 通用數學工具
└── assets/                        # 尚未使用，之後放美術與音效資源
```

## 架構原則（之後每個 Phase 都要守）

- Gameplay 邏輯不依賴 UI；Renderer 不管理 Gameplay 狀態；AI 不直接碰 UI。
- 系統之間用 Event Bus 溝通，不要互相 import 對方的內部細節。
- 存檔一律經過 `SaveManager`，並帶 `schemaVersion`；之後改資料格式時在 `_migrate()` 裡加分支，不要讓舊存檔直接壞掉。
- `ecs/ComponentManager.js` 的 `query()` 目前是線性掃描，量體變大時（一堆子彈/粒子/敵人）要不要換成 archetype table 排進 Phase 16（效能最佳化），現在的實體數量完全夠用，不用提前生出一個沒有必要的優化。

## 這個階段還沒做的部分（刻意留給後面的 Phase）

- **Physics Manager**：等 Phase 5（戰鬥）真的需要碰撞/擊退時再加，避免現在生出一個沒有實際邏輯的空殼。
- **Particle Manager**：排在 Phase 17（UI / 特效）。
- **Animation Manager**：等 Phase 2（渲染）有真正的 Sprite 之後再加。
- **AI Manager**：排在 Phase 6。
- **觸控／手把輸入**：Demo 目前只做鍵盤（WASD）。HUD 版面已經是 responsive，但實際的觸控搖桿排在 Phase 4（玩家）。

## 下一步：Phase 2 預告

Phase 2 會在這套引擎上加：程序化城市的第一版渲染（分區、建築佔位）、攝影機的世界邊界處理，並把 Renderer 的畫圖方式從「基本圖形」升級成可替換的 Sprite / 圖層系統，為武器與敵人的視覺做準備。

想繼續就說「繼續 Phase 2」。
