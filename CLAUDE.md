# CLAUDE.md - FFXIV 高難度副本機制模擬練習器 專案指南

## 運作準則 (Operating Principles)

1. **嚴格遵守準則 (Strict Adherence)**：
   * 最高優先級：本運作準則必須被嚴格執行。在每一個開發與重構的步驟中，請反覆確認是否符合此處列出的所有規範。

2. **全盤檢視與交接導向 (Context & Handover)**：
   * 完整檢視：每次修改前，必須完整檢視專案所有相關程式碼（包含元件樹、狀態管理、JSON Schema 定義），確保理解整體脈絡。
   * 交接思維：撰寫程式碼與註解時，必須假設「這份專案即將移交給完全未接觸過的新人」。盡可能添加詳細的上下文（Context）註解，尤其是複雜的**畫布座標轉換（Canvas Coordinates）**、**命中判定演算法（Hitbox/Collision）**與**王的面嚮（Boss Relative / True North）計算邏輯**，解釋「為什麼這樣做」而非僅是「做了什麼」，確保邏輯清晰可追溯。

3. **規劃優先 (Planning First)**：
   * 在實際撰寫程式碼前，必須先規劃要執行的項目與影響範圍，並列出簡要的 Step-by-step 計畫。特別是涉及 `data.json` 結構變更時，必須先確認前台解析與後台匯出邏輯是否同步更新。

4. **變更檢核與自我修正 (Verification & Review)**：
   * Git Diff 檢查：每次執行完畢前，必須執行 `git diff` 重新檢視即將提交的變更。
   * 意義確認：確認所有更新皆有具體意義、無多餘程式碼（Clean Code），且每一處變更都附帶了充分的註解說明。

5. **強制測試 (Mandatory Testing)**：
   * 執行測試：每次任務執行完畢前，必須進行測試以確保功能正常且無回歸錯誤（Regression）。
   * 測試優先級：針對「靜態 JSON Schema 驗證」、「範圍重疊計算」與「連續走位驗證邏輯」，優先撰寫單元測試（如 Vitest / Jest），確保解答判定的絕對準確性。

6. **文件一致性與可追溯性 (Documentation Consistency)**：
   * 全面同步：每次執行完畢前，必須完整檢視 `CLAUDE.md` 與 `README.md`。
   * 逐一檢核：確認文件內的所有紀錄（如：JSON 資料結構規格、環境變數、相依套件）與目前的專案狀態完全相符。

7. **架構邊界嚴守 (Architecture Boundaries)**：
   * 本專案包含兩個獨立運作的環境，兩者的職責必須嚴格分離，絕不能產生不合理的依賴：
   * **Player Frontend (玩家練習前台)**：純靜態網頁（部署於 GitHub Pages）。負責 UI 渲染、倒數計時邏輯、Debuff 狀態顯示、地圖點擊互動與解答驗證。**只能唯讀（Read-only）載入 `data.json`**，絕對不可包含任何寫入或儲存檔案的 Node.js 邏輯。
   * **Local Editor (本機端視覺化出題工具)**：僅在開發者本機環境（localhost）運行。負責提供視覺化介面讓開發者拖曳標記、框選安全區解答，並透過 Node.js API（如 Vite 外掛或簡單的 Express）將設定**寫入匯出為 `data.json`**。

8. **語言規範與社群在地化 (Language & Localization Standards)**：
   * 所有對話、Git Commit Message、文件、註解皆需使用**繁體中文 (台灣用語)**。
   * 嚴禁使用中國用語（例如：將「接口、項目、回調、模塊、內存、數據庫」替換為「介面、專案、Callback、模組、記憶體、資料庫」）。
   * **i18n 與社群用語**：若涉及多國語系介面（特別是日語需求），請配合 FFXIV 玩家社群習慣，使用自然、口語化且精確的遊戲術語（例如：機制/ギミック、滅團/ワイプ、巨集/マクロ、站位/立ち位置、詠唱條/Cast Bar）。

9. **例外處理與優雅降級 (Exception Handling)**：
   * **資料載入失敗**：前台若遇到 `data.json` 載入失敗或格式損毀，需有明確的 UI 錯誤提示。
   * **圖片資源遺失**：若場地背景圖或 Debuff 圖示載入失敗，需有替代的 Placeholder 顯示，不可讓畫面崩潰或使題目無法進行。

10. **程式碼風格 (Code Style)**：
    * 專案需符合 ESLint 與 Prettier 規範。
    * 全面實施 **TypeScript** 開發，必須嚴格定義型別（Type Hinting / Interfaces），特別是 `Instance`、`Strategy`、`Question`、`RoleContext` 的關聯與 JSON 結構。

11. **靜態資源與題庫管理 (Assets & Data Management)**：
    * 所有的副本場地圖、Debuff 圖示、職能 Icon 需妥善壓縮，統一管理於前台的 `public/assets/` 目錄下。
    * 題庫檔案（如 `data.json`）需有版本控制概念（Schema Versioning），以便未來系統升級時能向下相容舊版的題目資料。

12. **準則鎖定 (Principle Locking)**：
    * `CLAUDE.md` 的「運作準則」不允許被 AI 自行修改，僅能由使用者發起變更。
    * 以下「附錄：已確立的技術決策」由 AI 於開發過程中隨實作累積補充，作為未來協作的背景知識，不屬於「運作準則」，更新時無需使用者明確授權（但仍須反映已發生的既成事實，不可憑空新增規則）。

---

## 附錄：已確立的技術決策（Established Technical Decisions）

本區記錄開發過程中已透過實作與測試驗證的架構選型與慣例，供未來擴充時沿用。每條都已在現行 codebase 中落地，修改這些決策會牽動多個元件，變更前請先確認影響範圍。

### A. 座標系與幾何

- **座標原點**：場地【左上角】，x 向右、y 向下。與 DOM/Canvas 一致；與 FFXIV 遊戲內座標無關。
- **邏輯座標單位**：Arena.size（建議 1000×1000），與實際螢幕像素解耦
- **面嚮角度**：0° = 正北、順時針增加（與 FFXIV True North 巨集一致）
- **SVG 座標換算**：統一採用 `svg.getScreenCTM().inverse()` + `SVGPoint.matrixTransform`，boundingRect 僅作 fallback（CTM 能處理任何 transform/viewBox，最穩健）
- **命中判定邊界**：所有形狀政策一致「點在邊上 = 命中」（`<=` 而非 `<`），以 `EPSILON=1e-9` 吸收浮點誤差
- **多邊形演算法**：射線法 + 邊界特判（點在任一邊/頂點上直接命中，繞開射線法的奇異點）
- **Boss-relative 座標**：出題者可用「王朝北時相對座標」描述機制，前台透過 `rotatePoint` / `toWorldCoord` 依 `boss.facing` 旋轉至世界座標

### B. 狀態管理（Pinia）

- **Cascading Reset 契約**：上層選擇變更時自動清空下層
  - Player settings：換副本 → 清攻略+職能+dataset；換攻略 → 清職能
  - Editor：換題/換職能/啟用工具/離開模式 → 清 drawingPoints、selectedSafeAreaId
- **狀態與 UI 資源分層**：計時器（RAF handle）、滑鼠暫態座標（currentMousePos）放 view 層；僅「可序列化的資料」放 store
- **`isDirty` 旗標 by mutation 標記**：每次 mutation 設 true、save 後 false。不做深比較
- **Pinia 物件深拷貝**：用 `JSON.parse(JSON.stringify(...))` 而非 `structuredClone`，避免 Pinia Proxy 拋 `DataCloneError`

### C. 題型與資料模型

- **Question 判別聯合**：`map-click` vs `single-choice` | `multi-choice` | `ordering`
- **題型切換重置 RoleSolution**：`updateQuestion` 若帶入不同 type，自動將 8 職能 RoleSolution 重置為新型別空骨架（避免孤兒欄位）
- **刪除 Option 連動清正解**：`removeQuestionOption` 掃全 8 職能 `correctOptionIds`，移除指向已刪 option 的 ID
- **SafeArea 選填 id 欄位**：editor commit 時自動分配；player 不依賴 id（向下相容無 id 的手寫 dataset）
- **結算純函數抽出**：`evaluateMapClick` / `evaluateChoice` 獨立可測試，不依賴 store
- **判定策略**：
  - 地圖題：嚴格依序比對（clicks[i] 必須落在 safeAreas[i]）
  - 單選：correctOptionIds 長度 1、玩家選 1 個且相等
  - 多選：集合相等（Set 比對）
  - 排序：陣列逐 index 嚴格相等
- **動態實體（Phase 1+）**：所有實體位置統一採 `Point2D` 邏輯座標
  - `Question.boss.position?` 選填，未提供 fallback 至 `arena.center`
  - `Question.enemies?: EnemyEntity[]` 分身（id / name / position / facing）
  - 兩者面嚮（degrees）共用 `facingToCssRotation` 轉 SVG 旋轉
- **連線（Tether）採 ID 引用，不存死座標**：
  - `Tether.sourceId` / `targetId` 是字串引用：`'boss'` | `EnemyEntity.id` | `WaymarkId`（Player 端解析順序固定）
  - **Why ID 而非座標**：實體位置是動態的（boss 可被拖、enemy 會被改），ID 引用讓連線在實體移動時自動跟著重繪；存死座標會在資料層產生失同步陷阱
  - **Editor 特例**：Role ID 端點在 editor 無法預知玩家站位，fallback 至 `arena.center` + 淡虛線（`stroke-dasharray="8 4"`、`opacity=0.5`）作示意
  - **連動清理**：`removeEnemy` 自動掃 tethers 移除所有引用該 enemy.id 的條目（避免孤兒引用）
- **動態場地破壞（arena.grid + Question.arenaMask）**：
  - `Arena.grid?: { rows, cols }` 副本層共用設定
  - `Question.arenaMask?: number[]` 此題破碎的格 index
  - **Row-major 索引**：`index = row * cols + col`（左上 0、右下 `rows*cols - 1`）
  - **Schema 強制規範**：若 `arenaMask` 非空陣列，所屬 `Arena` 必須有 `grid` 定義；validator 在 [`packages/shared/src/utils/validateDataset.ts`](packages/shared/src/utils/validateDataset.ts) 強制檢查越界 index
  - **跨題清掃契約**：`updateArenaGrid(rows, cols)` 縮小尺寸時必須掃所有題目的 `arenaMask`，移除 `>= rows * cols` 的 index（避免存出 player 拒絕的非法資料），並設 `isDirty = true`
  - **雙層防線**：validator 已擋越界；ArenaMap 元件層仍 `filter` 一次防硬傷崩潰

### D. 計時器與生命週期

- **讀條倒數用 RAF + `performance.now()` delta**，不靠 setInterval（避免背景分頁累積、掉幀失準）
- **RAF 由 view 層持有**，store 只接受 `tick(deltaMs)`；單元測試不需 mock RAF
- **首幀邊界**：`lastFrameTimestamp === 0` 時 delta 設 0，避免 mount 到首幀間的大躍進
- **cleanup 三道防線**：startTimer 內先 stopTimer、watch 切題時清 timeout、onBeforeUnmount 統一清

### E. SVG 圖層（Z-index = DOM 順序）

Player ArenaMap 從底到頂：
1. background（場地形狀 + 背景圖）
2. arena-mask（破碎格遮罩 - 半透明黑底 + 紅色對角交叉，當 `arenaMask` 非空時）
3. lines（arena.lines 輔助線）
4. waymarks
5. safe-areas（僅 review 模式，interactive 模式必須隱藏以防洩漏答案）
6. tethers（實體連線，虛線 + drop-shadow）
7. boss + enemies（同層；enemies 為縮小版 boss marker + 紅色光暈圓框）
8. user-clicks

Editor EditableArenaMap：
1. background
2. arena-mask（與 player 同視覺；恆顯示讓出題者隨時看到當前破壞狀態）
3. grid-helper（僅 grid-mask 子模式顯示輔助網格虛線，`pointer-events="none"`）
4. lines（依 mode 決定可選/唯讀）
5. safe-areas（questions + safe-area 子模式 + `pointer-events=all` 允許點擊選取）
6. draft-safe-area（繪圖中暫態）
7. waymarks（依 mode 可拖/唯讀/隱藏）
8. tethers（與 player 視覺對齊；Role ID 端點以淡虛線示意）
9. boss（questions 模式；entity 子模式下疊透明 hitbox 接拖曳）
10. enemies（同 boss 層；entity 子模式下可拖曳）

- **`pointer-events="none"`** 用於「視覺參考但不應擋點擊」的圖層（arena.lines、arena-mask、grid-helper、tethers、safeAreas 在 player interactive）
- **Waymarks 在 arena 模式必須隱藏**，避免畫線時誤拖到 waymark 命中熱區
- **Boss / enemies 的 `pointer-events` 動態切換**：entity 子模式 `auto`（接拖曳），其他子模式 `none`（不擋 grid-mask click 等下層互動）

### F. Editor 拖曳與繪圖互動

- **Waymark 拖曳**：mousedown on waymark → window.mousemove/mouseup
- **Arena 畫線**：mousedown 分支（點到既有線 = 選取 / 點空白 = 開始畫）、過短線（< 5 單位）過濾
- **SafeArea 繪圖狀態機**：統一「雙擊定義」模式
  - Circle: 點 1 = 圓心 / 點 2 = 圓周
  - Rect: 點 1 = 一角 / 點 2 = 對角（`normalizeRect` 處理 4 象限）
  - Polygon: 連續點 + 磁吸閉合（3+ 點 + 距起點 ≤ 15 單位）
- **暫態用本地 ref，commit 走 store**：`dragPosition` / `draftLine` / `draftCircle` / `entityDragPosition` 等不污染 store reactivity
- **連續繪製 UX**：commit 後保留工具、清 drawingPoints
- **clamp 統一策略**：方形場地軸對齊 clamp、圓形場地沿向徑投影回圓周

#### F.1 Editor questions 子模式狀態機（Phase 2+）

進入 `mode='questions'` 後再分三個子模式（`store.questionSubMode`），畫布事件嚴格分流：

- **`safe-area`（預設）**：既有 SafeArea 繪圖狀態機（mousedown 分派 circle / rect / polygon）
- **`entity`**：拖曳 boss / 分身改變 `position`
  - mousedown on hitbox → `window.mousemove`（暫態 `entityDragPosition`）→ `mouseup` 才呼叫 `updateBossPosition` / `updateEnemy`
  - hitbox 是疊在 boss/enemy 圖示上的透明 `<circle>`（boss r=65、enemy r=44）
  - cursor: `grab` / `grabbing`
- **`grid-mask`**：點擊網格切換破碎/完好
  - 用 SVG `@click`（非 `mousedown`），避免被誤判為拖曳開始
  - 邊界防呆：座標超出 `[0, arena.width / height]` 直接忽略
  - `Math.min(col, cols-1)` 防右/下邊界 `floor` 溢位

**自動重置契約**：
- 切題（`selectQuestion`）→ 子模式回 `safe-area`
- 離開 `questions` 主模式（`setMode('arena' | 'waymarks')`）→ 回 `safe-area`
- `setQuestionSubMode` 切換時統一 `cancelDrawing()` + 清 `selectedSafeAreaId` + 清 `activeDrawingTool`，避免半成品 SafeArea 卡在 entity / grid-mask 子模式
- **雙保險**：`isDrawing` computed 強制要求 `sub-mode === 'safe-area'`，即使 store 殘留工具也不觸發 mousemove 監聽

#### F.2 動態網格修改與全副本清掃

- `updateArenaGrid(rows, cols)` 在縮小尺寸時必須掃 *所有題目* 的 `arenaMask` 過濾越界 index（不只當前題）
- UI 端在 `applyGrid` 套用前對「縮小且現有題目有破碎格」彈出 `window.confirm` 警告
- `clearArenaGrid` 為獨立 action，避免出題者誤打 0 觸發災難性清空

### G. 上傳與檔案安全（Editor localFileApi）

- **檔名一律自動產生**（16 bytes hex UUID），不接受使用者自訂
- **MIME 白名單**：PNG / JPEG / WebP / GIF；支援 `Content-Type` 含 charset 附加參數
- **大小上限 5MB**，邊讀邊累計（超限即中斷流，不讀完才判斷）
- **路徑穿越防禦雙道**：白名單正規 + `path.resolve` 後前綴比對
- **server.host = 'localhost'**，禁止對外暴露

### H. 測試策略

- **純函數優先**：所有判定邏輯（evaluateMapClick / evaluateChoice / calculateRating / normalizeRect / distance ...）抽 export，單元測試直接套用
- **元件測試**：
  - ArenaMap / ResultView / ReviewView 等走 jsdom + @vue/test-utils
  - 用 stub 元件攔截 props 驗證（例：ReviewView 測試用 ArenaMap stub 把 props 寫成 data-* 屬性）
  - 邊界情境必測：`bossFacing === 0` 合法值防 truthy 誤判、未作答防 crash
- **Editor 互動測試**：避開 jsdom 不實作 CTM API 的限制，繪圖互動改用人工驗證；store 的資料路徑 100% 單元測試覆蓋

### I. 語言與命名

- 繁體中文（台灣用語）：介面 / 專案 / Callback / 模組 / 記憶體 / 資料庫
- FFXIV 術語：機制、滅團、巨集、站位、詠唱條、散開、分擔、坦克分擔
- 職能命名：MT / ST / H1 / H2 / D1~D4（社群慣例）

### J. 動態場地與多實體系統 - 開發鐵律（Phase 1-3）

本節列出「未來 AI 修改 codebase 時不可違反」的硬性契約。違反任何一條都會破壞已驗證的測試或讓 player 無法載入既有題庫。

**J.1 實體位置採 Point2D，連線採 ID 引用**
- `Question.boss.position?` 與 `EnemyEntity.position` 一律 `Point2D`（左上原點邏輯座標），未提供 boss.position 時 fallback 至 `arena.center`
- `Tether.sourceId` / `targetId` **必須**是 ID 引用（`'boss'` | `enemy.id` | `WaymarkId`），**禁止**改成存死座標
- 理由：實體拖曳後連線端點要能自動跟著動，存座標會在資料層失同步
- Editor 端 RoleId 端點 fallback 規則：解析至 `arena.center` + `stroke-dasharray="8 4"` + `opacity=0.5` 淡虛線，明確告知出題者「練習時才定位玩家」

**J.2 arenaMask 採 1D row-major index，且 schema 強制 grid 必備**
- 索引公式（**全專案唯一真實來源在 [`packages/shared/src/types/question.ts`](./packages/shared/src/types/question.ts) 的 `arenaMask` 註解**）：
  - 正向：`index = row * cols + col`
  - 反向：`row = Math.floor(index / cols)`、`col = index % cols`
- 採 1D `number[]` 而非 2D `boolean[][]`：稀疏資料下 JSON 體積小、toggle 邏輯直接
- **Schema 契約**：非空 `arenaMask` → `Arena.grid` 必須存在；validator 在 [`packages/shared/src/utils/validateDataset.ts`](./packages/shared/src/utils/validateDataset.ts) 強制檢查越界 index，禁止繞過
- 邊界 floor 溢位防護：`Math.min(col, cols - 1)`（畫布點擊命中右/下邊界時 floor 會給出 cols 而非 cols-1，必須 clamp）

**J.3 跨題清掃契約 - updateArenaGrid 縮小時的全副本掃描**
- `updateArenaGrid(rows, cols)` **必須**掃 *全部 questions* 的 `arenaMask`，過濾 `>= rows * cols` 的越界 index
- 不只清當前題：grid 是 Instance 全副本共用設定，縮小尺寸後所有題目都可能有越界 mask；任何只清當前題的實作都會讓非法資料潛伏到下次 save，被 player validator 拒絕
- 套用後 `isDirty = true`（即使沒任何題被清也算），讓使用者明確知道 schema 已變動
- UI 端必須在縮小且現有題目有破碎格時 `window.confirm` 警告，不可靜默清掃

**J.4 孤兒資料防護 - removeEnemy 連動清 tethers**
- `removeEnemy(id)` **必須**同時 filter 掉 `q.tethers` 中 `sourceId === id || targetId === id` 的條目
- 理由：保留孤兒 tether 雖然 player 端會優雅降級不渲染（`resolveEntityPosition` 回 null），但會殘留在 JSON 裡讓未來修改困惑
- 同精神：`removeQuestionOption` 也清各職能 `correctOptionIds` 中對該 option 的引用

**J.5 questions 子模式事件嚴格隔離**
- `questionSubMode: 'safe-area' | 'entity' | 'grid-mask'`，預設 `'safe-area'`
- 自動重置：切題（`selectQuestion`）/ 離開 questions 主模式（`setMode`）/ `reset` → 一律回 `'safe-area'`
- 切換子模式時 `setQuestionSubMode` **必須**清 `drawingPoints` / `selectedSafeAreaId` / `activeDrawingTool`
- 畫布事件分流：safe-area 走 `mousedown`、entity 走實體 hitbox 自身 `mousedown` + `stopPropagation`、grid-mask 走 SVG `@click`（非 mousedown，避免被拖曳手勢截走）
- 雙保險：`isDrawing` computed 強制 `sub-mode === 'safe-area'`

**J.6 Tether v-for 必須用複合 key**
- Tether schema 沒 id 欄位（同 source/target 可能合法重複），**禁止**用 `:key="idx"`
- 標準寫法：``:key="`${t.sourceId}-${t.targetId}-${idx}`"``
- 違反會在刪中段條目時 Vue in-place patch 把後續 select.value 推給上一個 DOM 節點，造成下拉錯位

**J.7 拖曳期間用本地 transient state，mouseup 才寫 store**
- 適用範圍：waymark 拖曳（`dragPosition`）、entity 拖曳（`entityDragPosition`）、arena 畫線（`draftLine`）
- 違反會：每幀寫 store → 觸發整個 reactive 鏈（panel 重渲染）→ 拖曳卡頓；dirty flag 也會跳很多次

