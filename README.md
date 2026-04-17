# FFXIV 高難度副本機制模擬練習器

專為《Final Fantasy XIV》高難度副本（零式 / 絕本）玩家打造的機制模擬工具。
讓玩家在進本前，針對特定副本、特定攻略、特定職能，反覆練習處理機制的判斷與走位。

採 Monorepo 架構，由兩個獨立的前端應用組成：

- **玩家練習前台（Player）**：純靜態網頁，唯讀載入題庫 JSON，部署於 GitHub Pages
- **本機端視覺化出題後台（Editor）**：僅在開發者本機 `localhost` 運行，產出題庫 JSON

> 本專案的開發運作準則定義於 [CLAUDE.md](./CLAUDE.md)，包含架構邊界、語言規範、已確立的技術決策等。

---

## 功能特色

### 玩家練習前台

- **四選精靈**：依序選擇 副本 → 攻略組 → 職能，即可開始練習
- **4 種題型支援**：
  - 地圖點擊題（支援連續走位，clickCount > 1）
  - 單選題
  - 多選題
  - 排序題
- **Boss 讀條倒數**：模擬實戰時間壓力，歸零自動結算
- **Debuff 狀態顯示**：依職能顯示當下身上的 debuff，圖示載入失敗時 fallback 為名稱文字
- **結算與逐題回顧**：
  - FFXIV 風評價（Perfect / Duty Complete / Wipe）
  - 點擊每題進入回顧模式：地圖題疊圖對照、選擇題文字對照
  - 解析文字（note）提示為何要這樣站位

### 本機端視覺化出題後台

- **場地編輯**：上傳自訂背景圖、切換形狀（方形 / 圓形）、邏輯尺寸與中心校正
- **輔助線繪製**：在場地上拖曳畫出參考線（介於背景與 waymark 之間，不遮擋）
- **攻略 Waymark 視覺化拖曳**：直接拖曳 A/B/C/D/1/2/3/4 標記調整座標
- **題目 CRUD**：新增、編輯、複製（深拷貝）、刪除
- **8 職能解答獨立編輯**：每題的 MT/ST/H1/H2/D1~D4 各自設定 Debuff、安全區、解析文字
- **視覺化安全區框選工具**：
  - **圓形**：點擊圓心 → 點擊圓周
  - **矩形**：點擊一角 → 點擊對角（自動處理 4 象限正規化）
  - **多邊形**：連續點擊頂點 + 磁吸閉合（起點變金色提示）
  - 點擊已存在形狀選取 → 按 Delete 刪除
  - Esc / 右鍵取消當前繪製
- **選擇/排序題正解設定**：單選 radio、多選 checkbox、排序上下移
- **一鍵儲存**：透過本機 Vite Plugin API 寫回 `apps/player/public/assets/data/`

---

## 專案結構

```
.
├── apps/
│   ├── player/                # 玩家練習前台（純靜態，部署 GitHub Pages）
│   │   ├── public/assets/
│   │   │   ├── data/          # 題庫 JSON（index.json + 各副本.json）
│   │   │   ├── arenas/        # 場地背景圖（由 Editor 上傳產出）
│   │   │   └── debuffs/       # Debuff 圖示（手動放置）
│   │   └── src/
│   │       ├── views/         # SetupView / PracticeView / ResultView / ReviewView
│   │       ├── components/    # ArenaMap + practice/ + review/ + setup/
│   │       ├── stores/        # Pinia: settings, session
│   │       ├── services/      # dataset loading
│   │       ├── utils/         # rating
│   │       └── router/
│   │
│   └── editor/                # 本機出題工具（僅 localhost，嚴禁部署）
│       ├── plugins/
│       │   ├── localFileApi.ts         # Vite plugin 提供 /api/dataset 與 /api/upload-arena-image
│       │   └── imageUploadHelpers.ts   # 上傳 MIME / 大小 / 檔名驗證純函數
│       └── src/
│           ├── views/         # EditorView
│           ├── components/    # EditableArenaMap, WaymarkToolbar, ArenaSettingsPanel,
│           │                  # QuestionsPanel, RoleSolutionPanel
│           ├── stores/        # Pinia: editor
│           ├── services/      # datasetApi（呼叫 localFileApi）
│           └── utils/         # drawing（計算半徑、矩形正規化、磁吸判定）
│
└── packages/
    └── shared/                # Player 與 Editor 共用的型別與純函數
        └── src/
            ├── types/         # Instance, Strategy, Question, RoleSolution,
            │                  # SafeArea, ArenaLine, Session ...
            ├── constants/     # SCHEMA_VERSION, ROLE_IDS, WAYMARK_IDS ...
            └── utils/         # geometry（命中判定、Boss-relative 座標轉換）+ facing
```

---

## 技術選型

| 層級 | 採用 |
|---|---|
| 前端框架 | Vue 3 + `<script setup>` |
| 建構工具 | Vite 5 |
| 狀態管理 | Pinia |
| 路由（僅 Player） | Vue Router 4（hash mode，相容 GitHub Pages） |
| 樣式 | Tailwind CSS |
| 型別 | TypeScript strict mode |
| 測試 | Vitest + @vue/test-utils + jsdom |
| Monorepo | npm workspaces |

---

## 快速開始

```bash
# 安裝所有 workspace 依賴
npm install

# 啟動玩家前台（http://localhost:5173）
npm run dev:player

# 啟動本機出題工具（http://localhost:5174）
npm run dev:editor

# 建構玩家前台靜態檔（輸出至 apps/player/dist）
npm run build:player

# 跑全 workspace 單元測試（328+ 個）
npm test

# Typecheck
cd apps/player && npx vue-tsc --noEmit
cd apps/editor && npx vue-tsc --noEmit
```

---

## 資料模型概覽

完整型別定義見 [`packages/shared/src/types/`](./packages/shared/src/types/)。資料採關聯式設計：

```
Instance (副本)
├── arena            場地形狀、背景圖、邏輯尺寸、中心、lines（輔助線）
└── (擁有多組)
    ├── Strategy (攻略組)
    │   └── waymarks      A/B/C/D/1/2/3/4 場地標記座標（各攻略不同）
    │
    └── Question (題目)
        ├── boss          技能名稱、讀條時間、面嚮（度，正北 0 順時針）
        ├── type          map-click / single-choice / multi-choice / ordering
        ├── options       （choice 系列）選項陣列
        └── roleSolutions   8 職能各自的 Debuff、安全區/正解、解析文字
            ├── MT, ST
            ├── H1, H2
            └── D1, D2, D3, D4
```

### 關鍵設計

1. **題目綁副本而非攻略** — 一道題可被該副本下任何攻略組套用
2. **座標系統一** — 場地原點為左上角、y 軸向下（與 DOM/Canvas 一致），邏輯座標 1000×1000
3. **面嚮角度約定** — 0° 正北、順時針增加（與遊戲社群 True North 巨集一致）
4. **題型判別聯合** — `Question` 是 discriminated union，type 不同則 `roleSolutions` 結構不同
5. **Debuff 共用庫** — 每副本維護 `debuffLibrary`，題目只引用 ID
6. **Schema 版本** — 每個 dataset 檔含 `schemaVersion`，前台載入時驗證

---

## 架構邊界（極重要）

依 [CLAUDE.md 第 7 點](./CLAUDE.md)：

- **`apps/player`** 嚴禁包含任何 Node.js 寫檔邏輯。所有 JSON 一律以 `fetch` 唯讀載入
- **`apps/editor`** 僅在 `localhost` 運行，所有寫檔走 `localFileApi.ts` Vite plugin，目標路徑硬編碼為 `apps/player/public/assets/` 並有檔名白名單與路徑穿越防護
- **`packages/shared`** 為純型別與純函數，不可引入任何運行時依賴或瀏覽器/Node 專屬 API

**`apps/editor` 嚴禁部署到公開網路** — 它的 `build` script 會主動 `exit 1` 擋下誤操作。

---

## 社群題庫與離線匯入（Community Datasets & Custom Import）

本工具最強大的社群化特性：**題庫就是純 JSON 檔案**，任何人都能產出、分享、載入。

### 三種來源的題庫

1. **官方題庫**：本 repo 的 `apps/player/public/assets/data/` 內附題目，隨網站部署
2. **社群分享**：固定團／親友團用自家 Editor 產出的 `.json`，透過雲端硬碟、Discord、論壇分享
3. **自己的題庫**：本機跑 `npm run dev:editor` 視覺化出題後儲存為 `.json`

### 離線匯入流程

玩家在設定畫面頂部的「拖放區」，直接把 `.json` 檔拖入即可：

```
朋友傳來的 m1s-fixed-team.json
       ↓
    拖到 Player 網站設定畫面
       ↓
  自動驗證 schema → 載入 → 切入攻略/職能選擇
       ↓
    開始練習
```

**三層驗證防線**：
1. 檔案層：副檔名 `.json`、大小 ≤ 5MB
2. JSON 解析：語法合法
3. Schema 驗證：`schemaVersion` 相容、必要欄位齊全、型別正確

任何一層失敗 → 紅色錯誤提示，原本的設定狀態保持不動。

### 成績分享

結算畫面的「📋 複製分享連結」會產生類似：

```
https://<你的網域>/#/scorecard?data=eyJ2IjoxLCJpIjoiTTFTIiwi...
```

- 任何人打開連結 → 看到分享者的**評價 / 百分比 / 副本 / 攻略 / 職能**
- 下方「我也要挑戰 ⚔️」按鈕直接導去 `/setup` 開始自己的練習
- payload 經 Base64URL 編碼、帶版本號、支援中文與 emoji、正常情境 URL 長度 < 200 字元
- Clipboard 不可用的環境自動 fallback 到手動複製輸入框

### 為何設計為純前端匯入而非後端共享

- 零運維成本：GitHub Pages 免費承載，社群分享靠 Discord/雲端硬碟即可
- 資料主權：團隊的攻略 JSON 留在自己手上，不經第三方伺服器
- 容易 fork：每個團都能維護自己的題庫 repo，不需要等官方 PR 合併

---

## 出題者指南（給協助設計題目的朋友）

Editor 部署於 GitHub Pages 的 `/<repo>/editor/` 子路徑，**完全不需要安裝任何工具**即可出題。

### 流程

1. 開啟管理員提供的 Editor 網址（例如 `https://foo.github.io/ffxiv-raid-simulator/editor/`）
2. 按 **「📂 載入 JSON」** 選擇管理員給您的既有題庫 `.json` 檔（或從零開始，但場地圖需管理員先處理）
3. 使用三個模式進行編輯：
   - **場地標記**：拖曳 A/B/C/D/1-4 標記到正確位置
   - **場地設定**：調整場地邏輯尺寸與中心（場地圖上傳此模式下不可用，需管理員處理）
   - **題目編輯**：新增 / 編輯 / 複製 / 刪除題目與解答
4. 完成後按 **「📥 下載 JSON」** 取得編輯後的 JSON 檔
5. 把 JSON 檔傳給管理員（Discord / Email / 雲端硬碟皆可）
6. 管理員 commit 檔案到 repo → CI 自動部署 → 幾分鐘內玩家端就能看到新題目

### 本機模式 vs 靜態模式差異

| 功能 | 本機模式（管理員）| 靜態模式（朋友）|
|---|---|---|
| 載入 dataset | 下拉選單列出 repo 內現有檔案 | 手動上傳 JSON 檔 |
| 儲存 dataset | 直接寫回 repo 資料夾 | 瀏覽器下載 JSON 檔 |
| 上傳場地背景圖 | ✅ 可用 | ❌ disabled（需管理員處理） |
| 編輯 Waymark / 題目 / 解答 | ✅ 可用 | ✅ 可用 |
| 繪製安全區 | ✅ 可用 | ✅ 可用 |

Editor 會在啟動時自動探測環境（fetch `/api/dataset/list` 測試），根據結果切換 UI。

---

## 出題與部署流程

1. 開發者在本機啟動 `npm run dev:editor`，視覺化編輯題庫
2. Editor 透過 `POST /api/dataset?file=xxx.json` 寫入 `apps/player/public/assets/data/xxx.json`
3. 同時可透過 `POST /api/upload-arena-image` 上傳場地圖至 `apps/player/public/assets/arenas/`
4. 開發者 `git diff` 確認後 commit
5. Push 到 `main` 分支 → GitHub Actions 自動執行測試 + build + 部署到 GitHub Pages
6. 玩家前台啟動時先 fetch `assets/data/index.json` 取副本列表，選定後懶載入對應副本 JSON

---

## CI / CD

GitHub Actions workflow 位於 [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml)。

- **觸發**：push 到 `main` 分支
- **流程**：install → test（跑全 workspace）→ build:player → 部署到 GitHub Pages
- **只部署 Player**：Editor 工具含寫檔 API，僅限本機使用

若要啟用 Pages 部署，需在 repo Settings → Pages → Source 選「GitHub Actions」。
首次使用前，請將 [`apps/player/vite.config.ts`](./apps/player/vite.config.ts) 中的 `VITE_BASE_PATH`
預設值調整為您的 repo 名稱（例如 `/ffxiv-raid-simulator/`）。

---

## 測試

```bash
npm test                          # 全 workspace
cd packages/shared && npm test    # shared 純函數（48 tests）
cd apps/player && npm test        # Player stores/views/components（135 tests）
cd apps/editor && npm test        # Editor stores/services/utils（145 tests）
```

總計 328+ 個單元測試，涵蓋：

- 幾何命中判定（圓/矩形/多邊形，含邊界情境）
- Boss-relative 座標轉換
- 題型分派與結算邏輯（map-click 連續走位、choice 系列三種比對）
- Pinia store 的 cascading reset 契約
- 繪圖工具狀態機（圓/矩形雙擊、多邊形磁吸）
- Dataset API 錯誤分類（network / http / parse / schema-version）
- 圖片上傳 MIME 白名單與檔名安全

---

## 語言規範

- 所有文件、註解、commit message 使用 **繁體中文（台灣用語）**
- 嚴禁中國用語（介面 ≠ 接口、專案 ≠ 項目、資料庫 ≠ 數據庫 …）
- FFXIV 專有術語依台服與玩家社群習慣
