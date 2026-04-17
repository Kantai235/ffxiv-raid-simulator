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

### D. 計時器與生命週期

- **讀條倒數用 RAF + `performance.now()` delta**，不靠 setInterval（避免背景分頁累積、掉幀失準）
- **RAF 由 view 層持有**，store 只接受 `tick(deltaMs)`；單元測試不需 mock RAF
- **首幀邊界**：`lastFrameTimestamp === 0` 時 delta 設 0，避免 mount 到首幀間的大躍進
- **cleanup 三道防線**：startTimer 內先 stopTimer、watch 切題時清 timeout、onBeforeUnmount 統一清

### E. SVG 圖層（Z-index = DOM 順序）

Player ArenaMap 從底到頂：
1. background（場地形狀 + 背景圖）
2. lines（arena.lines 輔助線）
3. waymarks
4. safe-areas（僅 review 模式，interactive 模式必須隱藏以防洩漏答案）
5. boss（面嚮指示器）
6. user-clicks

Editor EditableArenaMap：
1. background
2. lines（依 mode 決定可選/唯讀）
3. safe-areas（questions 模式 + pointer-events=all 允許點擊選取）
4. draft-safe-area（繪圖中暫態）
5. waymarks（依 mode 可拖/唯讀/隱藏）
6. boss（questions 模式）

- **`pointer-events="none"`** 用於「視覺參考但不應擋點擊」的圖層（arena.lines、safeAreas 在 player interactive）
- **Waymarks 在 arena 模式必須隱藏**，避免畫線時誤拖到 waymark 命中熱區

### F. Editor 拖曳與繪圖互動

- **Waymark 拖曳**：mousedown on waymark → window.mousemove/mouseup
- **Arena 畫線**：mousedown 分支（點到既有線 = 選取 / 點空白 = 開始畫）、過短線（< 5 單位）過濾
- **SafeArea 繪圖狀態機**：統一「雙擊定義」模式
  - Circle: 點 1 = 圓心 / 點 2 = 圓周
  - Rect: 點 1 = 一角 / 點 2 = 對角（`normalizeRect` 處理 4 象限）
  - Polygon: 連續點 + 磁吸閉合（3+ 點 + 距起點 ≤ 15 單位）
- **暫態用本地 ref，commit 走 store**：`dragPosition` / `draftLine` / `draftCircle` 等不污染 store reactivity
- **連續繪製 UX**：commit 後保留工具、清 drawingPoints
- **clamp 統一策略**：方形場地軸對齊 clamp、圓形場地沿向徑投影回圓周

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

