import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type {
  AnchorPoint,
  Arena,
  ArenaLine,
  ChoiceQuestion,
  ChoiceRoleSolution,
  DatasetIndex,
  EnemyEntity,
  InstanceDataset,
  InstanceIndexEntry,
  MapClickQuestion,
  MapClickRoleSolution,
  Point2D,
  Question,
  QuestionOption,
  QuestionType,
  RoleId,
  RoleSolution,
  SafeArea,
  Strategy,
  Tether,
  WaymarkId,
} from '@ffxiv-sim/shared';
import {
  DatasetValidationError,
  ROLE_IDS,
  assertValidInstanceDataset,
} from '@ffxiv-sim/shared';

/** 繪圖工具類型 - 與 SafeArea.shape 對齊 */
export type DrawingTool = 'circle' | 'rect' | 'polygon' | null;
import {
  detectLocalApi,
  fetchPublishedDataset,
  fetchPublishedIndex,
  listDatasets,
  readDataset,
  uploadArenaImage,
  writeDataset,
} from '../services/datasetApi';

/** 編輯模式 - 切換不同的 panel 與畫布互動 */
export type EditorMode = 'waymarks' | 'arena' | 'questions';

/**
 * questions 主模式下的子模式 - 切換畫布互動語意。
 *
 * - 'safe-area' : 既有的 SafeArea 繪製狀態機（drawingPoints / activeDrawingTool）
 * - 'entity'    : 拖曳 boss / 分身改變位置；面嚮在側欄 panel 編輯
 * - 'grid-mask' : 點擊網格切換破碎/完好（Phase 1 schema 已支援 arenaMask）
 *
 * Why 用子模式而非展開更多 EditorMode：
 *   三者皆屬「編輯題目當下狀態」的範疇（共用題目選取、職能 tab、解析文字等），
 *   把它們塞回 EditorMode 會讓 waymarks/arena 與 entity/grid-mask 變成同層
 *   選擇，但其實後者只在前者為 'questions' 時才有意義。
 */
export type QuestionSubMode = 'safe-area' | 'entity' | 'grid-mask';

/**
 * ========================================================================
 * Editor Store - 視覺化編輯器的核心狀態
 * ========================================================================
 *
 * 一次只編輯【一個 dataset 檔】（對應一個副本的 *.json）。
 *
 * 職責：
 *   1. 持有當前編輯中的 InstanceDataset（in-memory，未存即丟）
 *   2. 持有當前選定的 strategy id（拖曳 waymark 時要知道改的是哪組攻略）
 *   3. 載入 / 儲存 dataset 檔
 *   4. 提供細粒度 mutation：updateWaymark / addWaymark / removeWaymark
 *   5. 追蹤「未存變更」狀態（dirty flag），給 UI 顯示提示
 *
 * 【為何不在每次 mutation 自動儲存】
 *   出題者通常會連續調整多個 waymark 才覺得滿意；自動存會頻繁寫檔，
 *   也讓「我還在試 → 我滿意了」的階段感消失。改用顯式 Save 按鈕。
 *
 * 【為何 dirty flag 不用深比較而用 mutation 標記】
 *   每次 mutation 後設 dirty=true，save 後設 false。深比較成本高也不必要。
 *
 * 【架構邊界】此 store 僅在 editor app 內使用。Player 嚴禁引用。
 * ========================================================================
 */
export const useEditorStore = defineStore('editor', () => {
  // ----------------------------------------------------------------------
  // State
  // ----------------------------------------------------------------------

  /** 當前編輯中的 dataset。null 表未載入任何檔 */
  const dataset = ref<InstanceDataset | null>(null);

  /** 當前載入的檔名（save 時寫回相同檔） */
  const currentFilename = ref<string | null>(null);

  /** 當前選定的攻略 ID（拖曳 waymark 時依此找目標 strategy） */
  const selectedStrategyId = ref<string | null>(null);

  /** 可選的 dataset 檔列表（呼叫 refreshFileList 時更新） */
  const availableFiles = ref<string[]>([]);

  /** 載入狀態 */
  const isLoading = ref(false);
  const isSaving = ref(false);

  /** 最近一次錯誤訊息，UI 顯示用 */
  const error = ref<string | null>(null);

  /** 自上次 save 以來是否有未保存變更 */
  const isDirty = ref(false);

  /**
   * 當前環境是否有 local file API（由 detectLocalApiAvailability 探測後設定）。
   *
   * - true  → 本機 dev 模式：「儲存」寫回 player 資料夾、支援場地圖上傳
   * - false → 靜態 GH Pages 模式：「儲存」改為下載 JSON、不支援場地圖上傳
   * - null  → 尚未探測（啟動前的初始值）
   *
   * UI 元件應依此旗標分流「儲存／載入／上傳」三組行為。
   */
  const isLocalApiAvailable = ref<boolean | null>(null);

  /**
   * 發佈版官方題庫索引（靜態 GH Pages 模式下用於列出可選副本）。
   *
   * Why 獨立 state：
   *   availableFiles 是本機 dev 模式下「可存取的檔名」; 發佈版索引是靜態模式下
   *   「可線上載入的副本（含 name / tags 等顯示用 metadata）」 - 兩者資料形狀與取得
   *   方式不同（listDatasets 回檔名陣列 vs fetchPublishedIndex 回 DatasetIndex 物件），
   *   放一起反而需要多條件判斷，分開單純。
   */
  const publishedIndex = ref<DatasetIndex | null>(null);

  /** 載入發佈版索引 / dataset 的進行中旗標，UI 顯示 spinner 用 */
  const isLoadingPublished = ref(false);

  /**
   * 當前 dataset 的來源（影響 view 層如何解析相對資源路徑）。
   *
   *   - 'local'     : 透過 listDatasets/readDataset 從 dev server 載入（本機 dev）
   *   - 'published' : 透過 fetchPublishedDataset 從 ../assets/data/ 載入（靜態 GH Pages）
   *   - 'upload'    : 使用者上傳本機 JSON 檔
   *
   * Why 影響 view：editor 部署於 /<repo>/editor/，但 dataset 內 backgroundImage
   *   使用相對 player 根的路徑（如 'assets/arenas/m1s.png'）。published 來源時
   *   view 必須加 '../' 前綴；其餘來源維持原值。
   */
  const datasetSource = ref<'local' | 'published' | 'upload' | null>(null);

  /**
   * 當前編輯模式 - 影響左側 panel 與 EditableArenaMap 的互動行為。
   *
   * - waymarks: 編輯攻略組的 waymark 座標（拖曳）
   * - arena   : 編輯場地本身（尺寸、形狀、背景圖、輔助線）
   */
  const mode = ref<EditorMode>('waymarks');

  /**
   * 當前選取的 arena 輔助線 ID（null 表未選）。
   * 給「按 Delete 刪除選取線」這類操作參考。
   */
  const selectedLineId = ref<string | null>(null);

  /** 圖片上傳狀態，給 UI spinner 顯示 */
  const isUploadingImage = ref(false);

  /**
   * questions 模式下當前選取的題目 ID。
   *
   * 載入新 dataset 時會自動指向第一題（若有）；
   * 刪除當前選取題目時會 fallback 到下一題或上一題。
   */
  const selectedQuestionId = ref<string | null>(null);

  /**
   * questions 模式下當前選取的職能（給 RoleSolutionPanel 用）。
   *
   * 預設 'MT' 而非 null - 進入 questions 模式立即看到 MT 的解答編輯介面，
   * 不需多一步「選職能」的點擊。
   */
  const selectedRoleId = ref<RoleId>('MT');

  /**
   * 當前啟用的繪圖工具。null 表未啟用（畫布點擊不會觸發繪製）。
   *
   * Why 放 store：
   *   1. RoleSolutionPanel 的工具按鈕與 EditableArenaMap 的 mousedown 分派
   *      都依賴此值，放 store 避免跨元件 props 傳遞
   *   2. 切題/切職能/切模式時能統一重置，避免殘留舊工具狀態
   */
  const activeDrawingTool = ref<DrawingTool>(null);

  /**
   * 繪製過程中累積的頂點。語意依工具而異：
   *   - circle  : [圓心, (完成時自動加上)]；長度 1 時在等「第 2 下 mousedown 取半徑」
   *   - rect    : [起點]；長度 1 時在等對角點
   *   - polygon : 累積的多邊形頂點；magnetic snap 或 Enter 結束
   *
   * Why 與 activeDrawingTool 分離：
   *   工具選定後（長度 0）允許使用者慢慢決定起點；commit 後清空但工具保留
   *   （連續繪製多個安全區常見）。
   */
  const drawingPoints = ref<Point2D[]>([]);

  /**
   * 當前選取的 SafeArea ID（給「點擊已存在安全區 → 標記 → Delete 刪除」流程使用）。
   *
   * null 表未選取；非 null 表 EditableArenaMap 應加粗該形狀的邊框。
   *
   * 連動：切題、切職能、啟用工具時自動清空（避免在錯目標上按 Delete）。
   */
  const selectedSafeAreaId = ref<string | null>(null);

  /**
   * questions 主模式下的子模式（Phase 2）。
   *
   * 預設 'safe-area' 維持既有 SafeArea 繪圖行為，舊操作肌肉記憶不受影響。
   * 切題或離開 questions 主模式時自動重置（見 selectQuestion / setMode）。
   */
  const questionSubMode = ref<QuestionSubMode>('safe-area');

  // ----------------------------------------------------------------------
  // Getters
  // ----------------------------------------------------------------------

  /** 當前選定的攻略物件 */
  const selectedStrategy = computed<Strategy | null>(() => {
    if (!dataset.value || !selectedStrategyId.value) return null;
    return dataset.value.strategies.find((s) => s.id === selectedStrategyId.value) ?? null;
  });

  /** 當前選定的題目物件 */
  const selectedQuestion = computed<Question | null>(() => {
    if (!dataset.value || !selectedQuestionId.value) return null;
    return dataset.value.questions.find((q) => q.id === selectedQuestionId.value) ?? null;
  });

  /**
   * 當前題目對應 selectedRoleId 的解答物件。
   *
   * Why 抽 getter：QuestionsPanel/RoleSolutionPanel/EditableArenaMap 三個元件
   *      都需要這份資料，集中於 store 避免各自 computed 的 boilerplate。
   */
  const selectedRoleSolution = computed<RoleSolution | null>(() => {
    const q = selectedQuestion.value;
    if (!q) return null;
    return q.roleSolutions[selectedRoleId.value] ?? null;
  });

  // ----------------------------------------------------------------------
  // Actions - 檔案操作
  // ----------------------------------------------------------------------

  /**
   * 重新整理可選檔案列表（不影響當前載入的 dataset）。
   *
   * 【過濾規則】
   * 排除 'index.json' - 它是 Player 用的【副本索引】（結構：{schemaVersion, instances: [...]}）
   * 而非單一副本的 InstanceDataset。Editor 不該編輯它；使用者誤選會讓
   * dataset.instance.arena 變 undefined 讓整個畫面崩潰。
   *
   * 若未來 Editor 要支援管理 index.json（新增/移除副本條目），
   * 應走另一個專屬的 mode 與 UI 流程。
   */
  async function refreshFileList(): Promise<void> {
    error.value = null;
    try {
      const files = await listDatasets();
      availableFiles.value = files.filter((f) => f !== 'index.json');
    } catch (err) {
      error.value = err instanceof Error ? err.message : '未知錯誤';
    }
  }

  /**
   * 載入指定檔案。
   *
   * 載入前若有未存變更會被覆蓋；UI 應在呼叫前自行確認（例如 confirm dialog），
   * 此 action 不擋（避免 store 持有 UI 邏輯）。
   */
  async function loadDataset(filename: string): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      const raw = await readDataset(filename);
      // 【結構驗證第二道防線】
      // 即使 refreshFileList 已過濾 index.json，仍有可能使用者手動放入格式錯誤的
      // JSON 到 assets/data/ 目錄。驗證失敗時不覆寫 dataset，讓 UI 保持原狀並顯示錯誤。
      // Why 在此再驗一次：放 store 層最穩固 - 無論 UI 如何變動、檔案來源多複雜
      // （未來若支援拖放等），dataset.value 永遠是合法 InstanceDataset。
      assertValidInstanceDataset(raw);

      dataset.value = raw;
      currentFilename.value = filename;
      datasetSource.value = 'local';
      // 預設選第一個攻略，方便玩家立刻能拖
      selectedStrategyId.value = dataset.value.strategies[0]?.id ?? null;
      // 預設選第一題，方便切到 questions 模式立即可編輯
      selectedQuestionId.value = dataset.value.questions[0]?.id ?? null;
      isDirty.value = false;
    } catch (err) {
      if (err instanceof DatasetValidationError) {
        error.value = `檔案結構錯誤：${err.message}`;
      } else {
        error.value = err instanceof Error ? err.message : '未知錯誤';
      }
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 儲存當前 dataset 回原檔。
   *
   * 必須先載入過檔（currentFilename 非 null）才能 save；無則設定 error。
   * Why: 不支援「另存新檔」(對應另一個副本)，避免使用者在多個副本間
   *      意外混淆。新副本應走另一個流程（後續實作）。
   */
  async function saveDataset(): Promise<boolean> {
    if (!dataset.value || !currentFilename.value) {
      error.value = '尚未載入任何檔案';
      return false;
    }
    isSaving.value = true;
    error.value = null;
    try {
      await writeDataset(currentFilename.value, dataset.value);
      isDirty.value = false;
      return true;
    } catch (err) {
      error.value = err instanceof Error ? err.message : '未知錯誤';
      return false;
    } finally {
      isSaving.value = false;
    }
  }

  // ----------------------------------------------------------------------
  // Actions - 環境偵測 / 匯出匯入（for 靜態部署模式）
  // ----------------------------------------------------------------------

  /**
   * 探測當前環境是否為本機 dev（有 local API）或靜態 GH Pages（無 API）。
   * 結果寫入 isLocalApiAvailable 供 UI 分流。
   * 應在 app mounted 時呼叫一次。
   */
  async function detectLocalApiAvailability(): Promise<void> {
    isLocalApiAvailable.value = await detectLocalApi();
  }

  /**
   * 將當前 dataset 下載為 JSON 檔（給靜態模式的出題者用）。
   *
   * 檔名：`<instanceId>.json`（可直接放入 apps/player/public/assets/data/ commit）。
   * 若尚未載入 dataset 則 no-op。
   *
   * 【下載成功後是否清 dirty？】不清。朋友可能會下載多次（給不同版本），
   * 我們不知道哪份是「最終版」；且朋友也不一定想被 dirty 旗標干擾。
   * 單純觸發瀏覽器下載，不動 state。
   *
   * @returns 是否成功觸發下載
   */
  function downloadDataset(): boolean {
    if (!dataset.value) {
      error.value = '尚未載入任何 dataset，無法下載';
      return false;
    }
    try {
      const filename = `${dataset.value.instance.id}.json`;
      // 保留縮排方便人類 review git diff（與 writeDataset 的格式一致）
      const content = JSON.stringify(dataset.value, null, 2) + '\n';
      const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // 下一個事件循環再釋放 URL，避免某些瀏覽器來不及觸發下載
      setTimeout(() => URL.revokeObjectURL(url), 0);
      return true;
    } catch (err) {
      error.value = err instanceof Error ? err.message : '下載失敗';
      return false;
    }
  }

  /**
   * 從使用者提供的 JSON 字串載入 dataset（給靜態模式的出題者用）。
   *
   * 沿用 loadDataset 的結構驗證邏輯（assertValidInstanceDataset），
   * 但輸入來自使用者檔案而非 API。
   *
   * @param jsonText    使用者上傳檔案的文字內容
   * @param filename    原始檔名（用於 currentFilename；本機「儲存」才有意義）
   * @returns 是否成功
   */
  function loadDatasetFromJson(jsonText: string, filename: string): boolean {
    error.value = null;
    try {
      const raw = JSON.parse(jsonText) as unknown;
      assertValidInstanceDataset(raw);
      dataset.value = raw;
      currentFilename.value = filename;
      datasetSource.value = 'upload';
      selectedStrategyId.value = raw.strategies[0]?.id ?? null;
      selectedQuestionId.value = null;
      selectedRoleId.value = 'MT';
      selectedLineId.value = null;
      selectedSafeAreaId.value = null;
      activeDrawingTool.value = null;
      drawingPoints.value = [];
      isDirty.value = false;
      return true;
    } catch (err) {
      if (err instanceof DatasetValidationError) {
        error.value = `檔案結構錯誤：${err.message}`;
      } else if (err instanceof SyntaxError) {
        error.value = `JSON 解析失敗：${err.message}`;
      } else {
        error.value = err instanceof Error ? err.message : '載入失敗';
      }
      return false;
    }
  }

  // ----------------------------------------------------------------------
  // Actions - 發佈版官方題庫（靜態 GH Pages 模式專用）
  // ----------------------------------------------------------------------

  /**
   * 載入 player 發佈版索引。
   *
   * 靜態模式下供「從官方題庫載入」下拉使用；本機 dev 模式的 UI 不會呼叫此 action
   * （本機用 refreshFileList + loadDataset 即可直接讀寫 player 資料夾）。
   *
   * 失敗時錯誤訊息寫入 error 並清空 publishedIndex，讓 UI 顯示錯誤橫幅。
   */
  async function loadPublishedIndex(): Promise<void> {
    isLoadingPublished.value = true;
    error.value = null;
    try {
      publishedIndex.value = await fetchPublishedIndex();
    } catch (err) {
      publishedIndex.value = null;
      error.value = err instanceof Error ? err.message : '載入官方題庫索引失敗';
    } finally {
      isLoadingPublished.value = false;
    }
  }

  /**
   * 從發佈版索引載入指定副本的 dataset，寫入編輯狀態。
   *
   * 沿用 loadDataset 的結構驗證（assertValidInstanceDataset）- 發佈版 JSON
   * 雖已經過 player 驗證，editor 再驗一次屬於雙保險。
   *
   * currentFilename 以 dataPath 的檔名（如 'm1s.json'）填入，方便下次「下載 JSON」
   * 時檔名與官方原檔一致，便於管理員比對 diff。
   *
   * @param entry 索引中的一筆（含 dataPath 與 schemaVersion）
   * @returns 是否成功
   */
  async function loadPublishedDataset(entry: InstanceIndexEntry): Promise<boolean> {
    isLoading.value = true;
    error.value = null;
    try {
      const raw = await fetchPublishedDataset(entry.dataPath);
      assertValidInstanceDataset(raw);

      dataset.value = raw;
      // 從 'assets/data/m1s.json' 取出 'm1s.json' 作為 currentFilename，
      // 讓 downloadDataset 的預期檔名與原檔對齊
      const filename = entry.dataPath.split('/').pop() ?? `${entry.id}.json`;
      currentFilename.value = filename;
      datasetSource.value = 'published';
      selectedStrategyId.value = raw.strategies[0]?.id ?? null;
      selectedQuestionId.value = raw.questions[0]?.id ?? null;
      selectedRoleId.value = 'MT';
      selectedLineId.value = null;
      selectedSafeAreaId.value = null;
      activeDrawingTool.value = null;
      drawingPoints.value = [];
      isDirty.value = false;
      return true;
    } catch (err) {
      if (err instanceof DatasetValidationError) {
        error.value = `官方題庫結構錯誤：${err.message}`;
      } else {
        error.value = err instanceof Error ? err.message : '載入官方題庫失敗';
      }
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  // ----------------------------------------------------------------------
  // Actions - 細粒度 mutation
  // ----------------------------------------------------------------------

  /**
   * 切換選定攻略。
   *
   * 【Cascading Reset】
   * 切攻略時必須清空 selectedQuestionId，因為題目綁攻略（schema 1.1+）：
   * 原本選取的題目不一定屬於新攻略，留著會在 questions 模式畫面看到「選了一個
   * 不在列表中的題目」這種錯亂狀態。同時連動清掉繪圖暫態。
   */
  function selectStrategy(strategyId: string): void {
    if (!dataset.value) return;
    if (!dataset.value.strategies.some((s) => s.id === strategyId)) return;
    selectedStrategyId.value = strategyId;
    selectedQuestionId.value = null;
    cancelDrawing();
    selectedSafeAreaId.value = null;
  }

  /**
   * 更新指定攻略中某個 waymark 的座標。
   *
   * 規則：
   *   - 若該 waymark 不存在於攻略中 → 一律新增（行為等同 addWaymark）
   *   - 不會自動 clamp 到場地內，由 view 層拖曳邊界處理
   *     Why: store 不應假設場地形狀；clamp 屬於 UI 互動細節
   */
  function updateWaymark(strategyId: string, waymarkId: WaymarkId, point: Point2D): void {
    const strategy = dataset.value?.strategies.find((s) => s.id === strategyId);
    if (!strategy) return;
    // 用 immutable 風格指派新物件，確保 Vue reactivity 偵測到變更
    strategy.waymarks = { ...strategy.waymarks, [waymarkId]: { x: point.x, y: point.y } };
    isDirty.value = true;
  }

  /**
   * 為攻略新增一個 waymark（座標預設為場地中心）。
   *
   * Why: UI 上點擊「啟用」按鈕後立即在場地中央出現一個 waymark，
   *      使用者再拖到正確位置；比要求使用者「先在精確位置點才會出現」更直覺。
   *
   * 已存在則 no-op（避免覆蓋既有座標）。
   */
  function addWaymark(strategyId: string, waymarkId: WaymarkId, defaultPoint: Point2D): void {
    const strategy = dataset.value?.strategies.find((s) => s.id === strategyId);
    if (!strategy) return;
    if (strategy.waymarks[waymarkId]) return; // 已存在，不覆蓋
    strategy.waymarks = { ...strategy.waymarks, [waymarkId]: { ...defaultPoint } };
    isDirty.value = true;
  }

  /**
   * 從攻略中移除一個 waymark。
   * 不存在則 no-op。
   */
  function removeWaymark(strategyId: string, waymarkId: WaymarkId): void {
    const strategy = dataset.value?.strategies.find((s) => s.id === strategyId);
    if (!strategy) return;
    if (!strategy.waymarks[waymarkId]) return;
    // 用 destructure 排除 + 重組，避免 delete operator（Vue reactivity 較不友善）
    const { [waymarkId]: _removed, ...rest } = strategy.waymarks;
    void _removed; // 標記為刻意忽略
    strategy.waymarks = rest;
    isDirty.value = true;
  }

  /** 清空所有狀態（測試或「關閉檔案」用） */
  function reset(): void {
    dataset.value = null;
    currentFilename.value = null;
    selectedStrategyId.value = null;
    selectedQuestionId.value = null;
    selectedRoleId.value = 'MT';
    availableFiles.value = [];
    publishedIndex.value = null;
    datasetSource.value = null;
    isLoading.value = false;
    isSaving.value = false;
    isLoadingPublished.value = false;
    isUploadingImage.value = false;
    error.value = null;
    isDirty.value = false;
    mode.value = 'waymarks';
    selectedLineId.value = null;
    activeDrawingTool.value = null;
    drawingPoints.value = [];
    selectedSafeAreaId.value = null;
    questionSubMode.value = 'safe-area';
  }

  // ----------------------------------------------------------------------
  // Actions - mode / selection
  // ----------------------------------------------------------------------

  function setMode(next: EditorMode): void {
    mode.value = next;
    // 切離 arena 模式時清掉線選取，避免回到 arena 模式還記得舊選取
    if (next !== 'arena') selectedLineId.value = null;
    // 切離 questions 模式時關閉繪圖工具與選取，避免殘留狀態
    if (next !== 'questions') {
      activeDrawingTool.value = null;
      drawingPoints.value = [];
      selectedSafeAreaId.value = null;
      // 子模式回到 'safe-area' 預設，下次再進 questions 不會殘留 entity / grid-mask
      questionSubMode.value = 'safe-area';
    }
  }

  /**
   * 切換 questions 主模式下的子模式。
   * 切換時統一把繪圖暫態清掉（避免半成品 SafeArea 卡在 entity / grid-mask）。
   */
  function setQuestionSubMode(next: QuestionSubMode): void {
    questionSubMode.value = next;
    cancelDrawing();
    selectedSafeAreaId.value = null;
    activeDrawingTool.value = null;
  }

  function selectLine(lineId: string | null): void {
    selectedLineId.value = lineId;
  }

  function selectQuestion(questionId: string | null): void {
    if (questionId === null) {
      selectedQuestionId.value = null;
      cancelDrawing();
      selectedSafeAreaId.value = null;
      // 切題（含切到「無題目」狀態）一律重置子模式
      questionSubMode.value = 'safe-area';
      return;
    }
    if (!dataset.value?.questions.some((q) => q.id === questionId)) return;
    selectedQuestionId.value = questionId;
    // 切題時清掉繪圖暫態與選取（避免在舊題上的 ID 套到新題）
    cancelDrawing();
    selectedSafeAreaId.value = null;
    // 子模式重置 - 出題者每進入新題目都從 SafeArea 開始（最常用情境）
    questionSubMode.value = 'safe-area';
  }

  function selectRole(roleId: RoleId): void {
    selectedRoleId.value = roleId;
    // 切職能同理：避免「在 MT 畫一半按了 D3 tab 結果點擊被寫到 D3」
    cancelDrawing();
    selectedSafeAreaId.value = null;
  }

  // ----------------------------------------------------------------------
  // Actions - 繪圖狀態機
  // ----------------------------------------------------------------------

  /**
   * 啟用繪圖工具。
   *
   * - 傳入同一工具 → toggle 關閉（使用者按兩下同一個按鈕）
   * - 傳入不同工具 → 切換為新工具 + 清空 drawingPoints
   * - 傳入 null    → 關閉
   */
  function startDrawing(tool: DrawingTool): void {
    // 啟用工具時也清掉「點擊選取」狀態，避免邏輯衝突
    // （否則使用者可能誤以為「選定 + 工具啟用」會編輯該形狀，但 UI 行為其實是新增）
    selectedSafeAreaId.value = null;
    if (activeDrawingTool.value === tool) {
      // toggle off
      activeDrawingTool.value = null;
      drawingPoints.value = [];
      return;
    }
    activeDrawingTool.value = tool;
    drawingPoints.value = [];
  }

  /**
   * 取消當前繪製進度（放棄 drawingPoints），但保留 activeDrawingTool。
   *
   * 呼叫情境：
   *   - 使用者按 Esc / 右鍵
   *   - 切題/切職能時自動呼叫（見上方）
   *
   * 保留工具的 Why: 出題者可能只是畫錯一個頂點想重畫，下次點擊還是要走同工具流程。
   * 若要完全關工具，呼叫 startDrawing(null)。
   */
  function cancelDrawing(): void {
    drawingPoints.value = [];
  }

  /**
   * 附加一個繪製頂點。由 EditableArenaMap 的 mousedown handler 呼叫。
   *
   * 不做工具相關的 commit 判斷 - 這是 view 層的狀態機責任
   * （view 才知道「游標是否磁吸到起點」「是否達到 circle 的 2 點門檻」）。
   */
  function appendDrawingPoint(point: Point2D): void {
    drawingPoints.value = [...drawingPoints.value, { ...point }];
  }

  /**
   * 將完成的 SafeArea 寫入當前選取題目的指定職能 RoleSolution。
   *
   * 契約：
   *   - 必須已有 selectedQuestionId 且題目型別為 map-click
   *   - 非 map-click 題型 no-op（UI 不該讓此情境發生，但 store 防禦）
   *   - 成功後清空 drawingPoints（但保留 activeDrawingTool 以便連續繪製）
   *
   * @returns  是否成功寫入
   */
  function commitSafeArea(area: SafeArea): boolean {
    if (!dataset.value || !selectedQuestionId.value) return false;
    const qIdx = dataset.value.questions.findIndex((q) => q.id === selectedQuestionId.value);
    if (qIdx === -1) return false;
    const q = dataset.value.questions[qIdx];
    if (q.type !== 'map-click') return false;

    const role = selectedRoleId.value;
    const currentSol = q.roleSolutions[role] as MapClickRoleSolution;

    // 自動為新形狀分配 id（若呼叫端已給則保留，避免覆寫）
    // Why 自動分配：editor 的「點擊選取/Delete 刪除」流程依賴 id 識別特定形狀，
    //   不能假設呼叫端記得設定。
    const areaWithId: SafeArea = area.id ? area : { ...area, id: generateSafeAreaId() };

    // immutable update - 整條路徑換新物件確保 Vue reactivity 觸發
    const newSol: MapClickRoleSolution = {
      ...currentSol,
      safeAreas: [...currentSol.safeAreas, areaWithId],
    };
    const newQ: MapClickQuestion = {
      ...q,
      roleSolutions: { ...q.roleSolutions, [role]: newSol },
    };
    const nextList = [...dataset.value.questions];
    nextList[qIdx] = newQ;
    dataset.value.questions = nextList;

    // 清暫態但保留工具 - 出題者通常會連續畫多個安全區
    drawingPoints.value = [];
    isDirty.value = true;
    return true;
  }

  /**
   * 移除當前選取題目/職能的第 N 個 SafeArea（從尾開始數最直觀）。
   *
   * 給「剛畫錯想 undo」使用。未寫完整 undo/redo 堆疊（那是獨立功能），
   * 但「刪最後一個 safeArea」是最常見的 undo 情境，先滿足此 80%。
   *
   * 使用 updateRoleSolution 底層實作以保持 reactivity 路徑一致。
   */
  function removeSafeArea(index: number): void {
    if (!selectedQuestionId.value) return;
    const q = selectedQuestion.value;
    if (!q || q.type !== 'map-click') return;
    const sol = q.roleSolutions[selectedRoleId.value] as MapClickRoleSolution;
    if (index < 0 || index >= sol.safeAreas.length) return;
    const removed = sol.safeAreas[index];
    const nextAreas = sol.safeAreas.filter((_, i) => i !== index);
    updateRoleSolution(selectedQuestionId.value, selectedRoleId.value, {
      safeAreas: nextAreas,
    } as Partial<MapClickRoleSolution>);
    // 若刪到目前選取者，清掉選取
    if (removed.id && selectedSafeAreaId.value === removed.id) {
      selectedSafeAreaId.value = null;
    }
  }

  /**
   * 設定當前選取的 SafeArea ID。傳 null 表清除選取。
   *
   * 不檢查 ID 是否存在於當前題目（呼叫端通常從畫布的點擊事件取得；
   * 若 ID 已不存在於題目中，下游 view 找不到也只是不渲染加粗框，無害）。
   */
  function selectSafeArea(safeAreaId: string | null): void {
    selectedSafeAreaId.value = safeAreaId;
  }

  /**
   * 依 ID 移除當前題目/職能的 SafeArea。
   *
   * 比 removeSafeArea(index) 更穩定 - 編輯期 safeAreas 陣列頻繁變動時，
   * 用 ID 找永遠對得上，不會發生「刪錯位置」。
   *
   * @returns  是否成功移除
   */
  function removeSafeAreaById(safeAreaId: string): boolean {
    if (!selectedQuestionId.value) return false;
    const q = selectedQuestion.value;
    if (!q || q.type !== 'map-click') return false;
    const sol = q.roleSolutions[selectedRoleId.value] as MapClickRoleSolution;
    const idx = sol.safeAreas.findIndex((a) => a.id === safeAreaId);
    if (idx === -1) return false;
    const nextAreas = sol.safeAreas.filter((a) => a.id !== safeAreaId);
    updateRoleSolution(selectedQuestionId.value, selectedRoleId.value, {
      safeAreas: nextAreas,
    } as Partial<MapClickRoleSolution>);
    if (selectedSafeAreaId.value === safeAreaId) selectedSafeAreaId.value = null;
    return true;
  }

  // ----------------------------------------------------------------------
  // Actions - QuestionOption CRUD（只用於 choice 系列題型）
  // ----------------------------------------------------------------------

  /**
   * 新增一個 option 到當前題目（必須非 map-click）。
   *
   * @returns  新 option 的 ID（成功）或 null
   */
  function addQuestionOption(label: string): string | null {
    const q = selectedQuestion.value;
    if (!q || q.type === 'map-click') return null;
    const newOpt: QuestionOption = { id: generateOptionId(), label };
    updateQuestion(q.id, {
      options: [...(q as ChoiceQuestion).options, newOpt],
    } as Partial<Question>);
    return newOpt.id;
  }

  /**
   * 更新某個 option 的 label。
   * 不存在則 no-op。
   */
  function updateQuestionOption(optionId: string, label: string): void {
    const q = selectedQuestion.value;
    if (!q || q.type === 'map-click') return;
    const opts = (q as ChoiceQuestion).options;
    const idx = opts.findIndex((o) => o.id === optionId);
    if (idx === -1) return;
    const nextOpts = [...opts];
    nextOpts[idx] = { ...opts[idx], label };
    updateQuestion(q.id, { options: nextOpts } as Partial<Question>);
  }

  /**
   * 移除一個 option。
   *
   * 連動：所有職能 RoleSolution 中 correctOptionIds 含此 ID 者也要移除，
   *      避免殘留指向已刪除選項的孤兒 ID。
   */
  function removeQuestionOption(optionId: string): void {
    const q = selectedQuestion.value;
    if (!q || q.type === 'map-click') return;
    const opts = (q as ChoiceQuestion).options;
    if (!opts.some((o) => o.id === optionId)) return;

    // 同步清掉所有職能 correctOptionIds 中的此 ID
    const newRoleSolutions = {} as Record<RoleId, ChoiceRoleSolution>;
    for (const role of ROLE_IDS) {
      const sol = (q as ChoiceQuestion).roleSolutions[role];
      newRoleSolutions[role] = {
        ...sol,
        correctOptionIds: sol.correctOptionIds.filter((id) => id !== optionId),
      };
    }
    updateQuestion(q.id, {
      options: opts.filter((o) => o.id !== optionId),
      roleSolutions: newRoleSolutions,
    } as Partial<Question>);
  }

  /**
   * 將一個 option 在陣列中上移或下移一格（影響預設顯示順序）。
   * 邊界（已最上/最下）為 no-op。
   */
  function moveQuestionOption(optionId: string, direction: 'up' | 'down'): void {
    const q = selectedQuestion.value;
    if (!q || q.type === 'map-click') return;
    const opts = (q as ChoiceQuestion).options;
    const idx = opts.findIndex((o) => o.id === optionId);
    if (idx === -1) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= opts.length) return;
    const nextOpts = [...opts];
    [nextOpts[idx], nextOpts[targetIdx]] = [nextOpts[targetIdx], nextOpts[idx]];
    updateQuestion(q.id, { options: nextOpts } as Partial<Question>);
  }

  /**
   * 設定指定職能的 correctOptionIds（給「正解設定 UI」用）。
   *
   * 等同 updateRoleSolution 包一層，但語意明確。
   */
  function setCorrectOptionIds(
    questionId: string,
    roleId: RoleId,
    correctOptionIds: string[],
  ): void {
    updateRoleSolution(questionId, roleId, {
      correctOptionIds: [...correctOptionIds],
    } as Partial<ChoiceRoleSolution>);
  }

  // ----------------------------------------------------------------------
  // Actions - Arena 編輯
  // ----------------------------------------------------------------------

  /**
   * 部分更新 Arena 屬性（淺層 merge）。
   *
   * @param patch  要更新的欄位（如 { shape: 'circle' } 或 { size: {...} }）
   *
   * Why patch 風格而非個別 setter：
   *   ArenaSettingsPanel 的多個欄位都是同型操作（shape / size / center），
   *   一個 updateArena 涵蓋所有欄位，UI 端用 v-model 直接寫即可。
   */
  function updateArena(patch: Partial<Arena>): void {
    if (!dataset.value) return;
    dataset.value.instance.arena = {
      ...dataset.value.instance.arena,
      ...patch,
    };
    isDirty.value = true;
  }

  /**
   * 設定 Arena 背景圖路徑。
   *
   * 與 updateArena({ backgroundImage }) 等價，但獨立 action 方便：
   *   1. 上傳成功後 view 端只需呼叫此 action（語意比 updateArena 明確）
   *   2. 未來若需「上傳即覆寫舊圖」邏輯可在此擴充
   */
  function setBackgroundImage(path: string): void {
    if (!dataset.value) return;
    dataset.value.instance.arena = {
      ...dataset.value.instance.arena,
      backgroundImage: path,
    };
    isDirty.value = true;
  }

  /**
   * 上傳場地圖並寫回 backgroundImage。
   *
   * @returns 是否成功
   */
  async function uploadAndSetBackground(file: File): Promise<boolean> {
    if (!dataset.value) {
      error.value = '尚未載入任何 dataset，無法上傳圖片';
      return false;
    }
    isUploadingImage.value = true;
    error.value = null;
    try {
      const { path } = await uploadArenaImage(file);
      setBackgroundImage(path);
      return true;
    } catch (err) {
      error.value = err instanceof Error ? err.message : '上傳失敗';
      return false;
    } finally {
      isUploadingImage.value = false;
    }
  }

  /**
   * 新增一條輔助線。
   *
   * @param line  要新增的線段（id 由呼叫端產生，避免 store 依賴隨機源）
   */
  function addArenaLine(line: ArenaLine): void {
    if (!dataset.value) return;
    const arena = dataset.value.instance.arena;
    const next = [...(arena.lines ?? []), line];
    dataset.value.instance.arena = { ...arena, lines: next };
    isDirty.value = true;
  }

  /**
   * 移除指定 id 的輔助線。若該線正被選取則清除 selectedLineId。
   */
  function removeArenaLine(lineId: string): void {
    if (!dataset.value) return;
    const arena = dataset.value.instance.arena;
    const next = (arena.lines ?? []).filter((l) => l.id !== lineId);
    dataset.value.instance.arena = { ...arena, lines: next };
    if (selectedLineId.value === lineId) selectedLineId.value = null;
    isDirty.value = true;
  }

  /**
   * 部分更新指定輔助線。
   * 不存在則 no-op。
   */
  function updateArenaLine(lineId: string, patch: Partial<Omit<ArenaLine, 'id'>>): void {
    if (!dataset.value) return;
    const arena = dataset.value.instance.arena;
    const lines = arena.lines ?? [];
    const idx = lines.findIndex((l) => l.id === lineId);
    if (idx === -1) return;
    const next = [...lines];
    next[idx] = { ...next[idx], ...patch };
    dataset.value.instance.arena = { ...arena, lines: next };
    isDirty.value = true;
  }

  // ----------------------------------------------------------------------
  // Actions - Question CRUD
  // ----------------------------------------------------------------------

  /**
   * 新增一個題目。預設值見 createBlankQuestion。
   *
   * 【schema 1.1+】題目必須綁定攻略組（strategyId）。
   * 此函數使用 store.selectedStrategyId 作為新題目的歸屬；
   * 若尚未選攻略則回 null（UI 端應預先 disable 新增按鈕）。
   *
   * @param type           題型
   * @param instanceId     所屬副本（通常 = dataset.instance.id）
   * @returns              新建題目的 ID（呼叫端可立即 selectQuestion 切過去）
   */
  function addQuestion(type: QuestionType, instanceId: string): string | null {
    if (!dataset.value) return null;
    if (!selectedStrategyId.value) return null;
    const newQ = createBlankQuestion(type, instanceId, selectedStrategyId.value);
    dataset.value.questions = [...dataset.value.questions, newQ];
    isDirty.value = true;
    return newQ.id;
  }

  /**
   * 部分更新題目欄位。
   *
   * 【關鍵：題型變動時自動重置所有 RoleSolution】
   *   題型決定了 RoleSolution 的 shape（map-click 用 safeAreas / choice 用 correctOptionIds）。
   *   若使用者把題型從 map-click 改成 single-choice 但 RoleSolution 仍保留 safeAreas
   *   就成了孤兒資料；evaluate 時也會型別不符。
   *   所以只要 patch.type 與當前不同，整題的 8 職能 RoleSolution 都重置為新型別的空骨架。
   *
   * @param questionId  目標題目 ID
   * @param patch       要更新的欄位（淺層 merge）
   */
  function updateQuestion(questionId: string, patch: Partial<Question>): void {
    if (!dataset.value) return;
    const idx = dataset.value.questions.findIndex((q) => q.id === questionId);
    if (idx === -1) return;
    const current = dataset.value.questions[idx];

    let merged: Question;
    // 題型變動 → 重置 roleSolutions
    if (patch.type && patch.type !== current.type) {
      merged = mergeWithTypeChange(current, patch);
    } else {
      // 同題型：直接淺層 merge
      // 用斷言告訴 TS：patch 的型別與 current 同源，merge 後仍是合法 Question
      merged = { ...current, ...patch } as Question;
    }
    const next = [...dataset.value.questions];
    next[idx] = merged;
    dataset.value.questions = next;
    isDirty.value = true;
  }

  /**
   * 刪除指定題目。
   * 若刪到當前選取，selectedQuestionId 自動 fallback 到下一題或上一題。
   */
  function deleteQuestion(questionId: string): void {
    if (!dataset.value) return;
    const oldList = dataset.value.questions;
    const idx = oldList.findIndex((q) => q.id === questionId);
    if (idx === -1) return;

    const next = oldList.filter((q) => q.id !== questionId);
    dataset.value.questions = next;

    // 若刪到當前選取，找替代題目
    if (selectedQuestionId.value === questionId) {
      // 優先用同 index 位置（即原本「下一題」的位置）
      // 若已是末尾則指向新末尾；空陣列則 null
      if (next.length === 0) {
        selectedQuestionId.value = null;
      } else if (idx < next.length) {
        selectedQuestionId.value = next[idx].id;
      } else {
        selectedQuestionId.value = next[next.length - 1].id;
      }
    }

    isDirty.value = true;
  }

  /**
   * 複製指定題目，新題附加在原題之後。
   *
   * 深拷貝採 structuredClone（Node 17+/所有現代瀏覽器原生支援）。
   * 新 id = 「原 id」-copy-時間戳，避免衝突。
   *
   * @returns  新題目 ID（成功）或 null
   */
  function duplicateQuestion(questionId: string): string | null {
    if (!dataset.value) return null;
    const oldList = dataset.value.questions;
    const idx = oldList.findIndex((q) => q.id === questionId);
    if (idx === -1) return null;

    const original = oldList[idx];
    // 深拷貝 - 採 JSON parse/stringify。
    // Why 不用 structuredClone：Pinia 把 ref 內的物件包成 Proxy，
    //     structuredClone 對 Proxy 會拋 DataCloneError。
    // Why JSON 序列化安全：Question 結構為純 JSON 可序列化型別
    //     （無 Date / Map / Set / Function），語意 100% 等價於 deep clone。
    const cloned = JSON.parse(JSON.stringify(original)) as Question;
    cloned.id = `${original.id}-copy-${Date.now()}`;
    cloned.name = `${original.name}（副本）`;
    // strategyId 透過深拷貝自動繼承原題 → 複製出來的題目仍歸屬同一攻略（合理預設）

    // 插入到原題之後（不放尾巴，方便連續機制連著看）
    const next = [...oldList.slice(0, idx + 1), cloned, ...oldList.slice(idx + 1)];
    dataset.value.questions = next;
    isDirty.value = true;
    return cloned.id;
  }

  /**
   * 部分更新指定題目某職能的 RoleSolution。
   *
   * 採淺層 merge - debuffs / safeAreas / correctOptionIds / note 都是同層欄位。
   * 若需更動 safeAreas 內單一形狀（如「移除第 2 個 polygon」），呼叫端應傳完整新 safeAreas 陣列。
   */
  function updateRoleSolution(
    questionId: string,
    roleId: RoleId,
    patch: Partial<RoleSolution>,
  ): void {
    if (!dataset.value) return;
    const qIdx = dataset.value.questions.findIndex((q) => q.id === questionId);
    if (qIdx === -1) return;
    const q = dataset.value.questions[qIdx];
    const currentSol = q.roleSolutions[roleId];
    // 用 cast：patch 與 current 同題型，merge 後仍合法
    const merged = { ...currentSol, ...patch } as RoleSolution;

    // 重組 question - 整體換新物件確保 reactivity
    const next: Question = {
      ...q,
      roleSolutions: { ...q.roleSolutions, [roleId]: merged },
    } as Question;
    const nextList = [...dataset.value.questions];
    nextList[qIdx] = next;
    dataset.value.questions = nextList;
    isDirty.value = true;
  }

  // ----------------------------------------------------------------------
  // Actions - Phase 2：實體位置與分身（boss.position / enemies CRUD）
  // ----------------------------------------------------------------------

  /**
   * 私用 helper：對「當前選取題目」套用 patch 並重組 questions 陣列。
   *
   * 把「找 idx → 重組單題 → 重組整列 → 設 dirty」這四步抽出，讓上層
   * action 專注於決定要 patch 什麼欄位即可，避免重複寫 reactivity 樣板。
   *
   * @returns 是否有實際套用（false 表示無 dataset 或無選取題目）
   */
  function patchSelectedQuestion(patch: Partial<Question>): boolean {
    if (!dataset.value || !selectedQuestionId.value) return false;
    const qIdx = dataset.value.questions.findIndex((q) => q.id === selectedQuestionId.value);
    if (qIdx === -1) return false;
    const merged = { ...dataset.value.questions[qIdx], ...patch } as Question;
    const next = [...dataset.value.questions];
    next[qIdx] = merged;
    dataset.value.questions = next;
    isDirty.value = true;
    return true;
  }

  /**
   * 更新當前題目的 boss 位置（對應「貓跳平移」這類機制）。
   * 不檢查座標是否在場地內 - clamp 屬於 view 層拖曳邏輯，store 不假設場地形狀。
   */
  function updateBossPosition(pos: Point2D): void {
    const q = selectedQuestion.value;
    if (!q) return;
    patchSelectedQuestion({ boss: { ...q.boss, position: { ...pos } } });
  }

  /**
   * 更新當前題目的 boss 面嚮（度，與 BossState.facing 同約定）。
   * 抽獨立 action 是因為 entity 子模式下 panel 也會編輯 facing，語意明確。
   */
  function updateBossFacing(facing: number): void {
    const q = selectedQuestion.value;
    if (!q) return;
    patchSelectedQuestion({ boss: { ...q.boss, facing } });
  }

  /**
   * 為當前題目新增一隻分身。
   *
   * 預設值規則：
   *   - id      : 自動產生（題內唯一，與 SafeArea ID 同源策略）
   *   - name    : '分身 N'，N = 現有 enemies.length + 1（給人看的）
   *   - position: arena.center（出題者通常會立刻拖到目標位置）
   *   - facing  : 0（正北 - 與 boss 預設一致）
   *
   * @returns 新分身的 id（成功）或 null
   */
  function addEnemy(): string | null {
    const q = selectedQuestion.value;
    if (!q || !dataset.value) return null;
    const arena = dataset.value.instance.arena;
    const existing = q.enemies ?? [];
    const newEnemy: EnemyEntity = {
      id: generateEnemyId(),
      name: `分身 ${existing.length + 1}`,
      position: { ...arena.center },
      facing: 0,
    };
    patchSelectedQuestion({ enemies: [...existing, newEnemy] });
    return newEnemy.id;
  }

  /**
   * 部分更新指定分身（淺層 merge）。不存在則 no-op。
   * patch 不允許動 id（id 是穩定的引用，改 id 會打斷 tethers 的引用關係）。
   */
  function updateEnemy(id: string, updates: Partial<Omit<EnemyEntity, 'id'>>): void {
    const q = selectedQuestion.value;
    if (!q) return;
    const enemies = q.enemies ?? [];
    const idx = enemies.findIndex((e) => e.id === id);
    if (idx === -1) return;
    const next = [...enemies];
    next[idx] = { ...enemies[idx], ...updates };
    patchSelectedQuestion({ enemies: next });
  }

  /**
   * 移除指定分身。
   *
   * 連動：清掉 tethers 中引用此 id 的條目（避免出現「線連到不存在的實體」），
   *      與 removeQuestionOption 清孤兒 correctOptionIds 同精神。
   */
  function removeEnemy(id: string): void {
    const q = selectedQuestion.value;
    if (!q) return;
    const enemies = q.enemies ?? [];
    if (!enemies.some((e) => e.id === id)) return;
    const nextEnemies = enemies.filter((e) => e.id !== id);
    const nextTethers = (q.tethers ?? []).filter((t) => t.sourceId !== id && t.targetId !== id);
    patchSelectedQuestion({ enemies: nextEnemies, tethers: nextTethers });
  }

  // ----------------------------------------------------------------------
  // Actions - Phase 3.5：自由錨點（anchors CRUD）
  // ----------------------------------------------------------------------

  /**
   * 為當前題目新增一個自由錨點（Tether 端點專用的無圖示座標）。
   *
   * 預設值規則：
   *   - id      : 自動產生
   *   - name    : '錨點 N'，N = 現有 anchors.length + 1（給下拉選單辨識用）
   *   - position: arena.center（出題者通常會立刻拖到目標位置）
   *
   * @returns 新錨點的 id（成功）或 null
   */
  function addAnchor(): string | null {
    const q = selectedQuestion.value;
    if (!q || !dataset.value) return null;
    const existing = q.anchors ?? [];
    const newAnchor: AnchorPoint = {
      id: generateAnchorId(),
      name: `錨點 ${existing.length + 1}`,
      position: { ...dataset.value.instance.arena.center },
    };
    patchSelectedQuestion({ anchors: [...existing, newAnchor] });
    return newAnchor.id;
  }

  /**
   * 部分更新指定錨點（淺層 merge）。不存在則 no-op。
   * patch 不允許動 id（與 enemy 同理：穩定引用，改 id 會打斷 tethers）。
   */
  function updateAnchor(id: string, updates: Partial<Omit<AnchorPoint, 'id'>>): void {
    const q = selectedQuestion.value;
    if (!q) return;
    const anchors = q.anchors ?? [];
    const idx = anchors.findIndex((a) => a.id === id);
    if (idx === -1) return;
    const next = [...anchors];
    next[idx] = { ...anchors[idx], ...updates };
    patchSelectedQuestion({ anchors: next });
  }

  /**
   * 移除指定錨點。
   *
   * 連動清理（與 removeEnemy 同精神）：清掉 tethers 中引用此 id 的條目，
   * 避免殘留「線連到不存在的錨點」這種孤兒引用。
   */
  function removeAnchor(id: string): void {
    const q = selectedQuestion.value;
    if (!q) return;
    const anchors = q.anchors ?? [];
    if (!anchors.some((a) => a.id === id)) return;
    const nextAnchors = anchors.filter((a) => a.id !== id);
    const nextTethers = (q.tethers ?? []).filter((t) => t.sourceId !== id && t.targetId !== id);
    patchSelectedQuestion({ anchors: nextAnchors, tethers: nextTethers });
  }

  // ----------------------------------------------------------------------
  // Actions - Phase 2：場地網格（arena.grid + question.arenaMask）
  // ----------------------------------------------------------------------

  /**
   * 更新副本的 grid 設定（rows × cols）。
   *
   * 【極重要：跨題清掃】
   *   grid 是 Instance 全副本共用的設定，縮小尺寸（例 4×4 → 3×3）會讓
   *   原本合法的 mask index（如 9~15）超出新範圍而變成非法資料。
   *   為避免存檔後 player 載入觸發 validator 拒絕，此 action 必須
   *   主動掃描 *所有題目* 的 arenaMask，移除越界 index。
   *
   * 【為何不直接刪 grid】
   *   傳入 0 / 負數 / 非整數時拒絕（避免 Arena.grid 變成不合法物件，
   *   也避免「不小心打 0」清掉所有破碎設定的災難）。要清空請呼叫 clearArenaGrid。
   *
   * @param rows  正整數
   * @param cols  正整數
   */
  function updateArenaGrid(rows: number, cols: number): void {
    if (!dataset.value) return;
    if (!Number.isInteger(rows) || rows <= 0) return;
    if (!Number.isInteger(cols) || cols <= 0) return;
    const arena = dataset.value.instance.arena;
    dataset.value.instance.arena = { ...arena, grid: { rows, cols } };

    // 跨題清掃 - 過濾 >= total 的越界 index
    const total = rows * cols;
    const nextQuestions = dataset.value.questions.map((q) => {
      if (!q.arenaMask || q.arenaMask.length === 0) return q;
      const filtered = q.arenaMask.filter((idx) => idx >= 0 && idx < total);
      // 沒任何 index 被淘汰 → 直接回傳原物件（避免無謂的 reference 變動）
      if (filtered.length === q.arenaMask.length) return q;
      return { ...q, arenaMask: filtered } as Question;
    });
    dataset.value.questions = nextQuestions;
    isDirty.value = true;
  }

  /**
   * 移除副本的 grid 設定（同步清光所有題目的 arenaMask）。
   *
   * 提供獨立 action 避免 updateArenaGrid 被誤用為清除工具。
   */
  function clearArenaGrid(): void {
    if (!dataset.value) return;
    const arena = dataset.value.instance.arena;
    if (arena.grid === undefined && !dataset.value.questions.some((q) => q.arenaMask?.length)) {
      return; // 本來就沒設定，不必觸發 dirty
    }
    const { grid: _grid, ...rest } = arena;
    void _grid;
    dataset.value.instance.arena = rest;
    dataset.value.questions = dataset.value.questions.map((q) =>
      q.arenaMask?.length ? ({ ...q, arenaMask: [] } as Question) : q,
    );
    isDirty.value = true;
  }

  /**
   * 切換當前題目的某格網格破碎/完好狀態。
   *
   * 行為：
   *   - 已存在於 arenaMask → 移除（恢復完好）
   *   - 不存在 → 加入（變成破碎）
   *
   * 邊界檢查：若副本未設 grid 或 index 越界，no-op
   *  （UI 不該讓此情境發生，但 store 防禦避免存出非法資料）。
   */
  function toggleArenaMask(index: number): void {
    const q = selectedQuestion.value;
    if (!q || !dataset.value) return;
    const grid = dataset.value.instance.arena.grid;
    if (!grid) return;
    const total = grid.rows * grid.cols;
    if (!Number.isInteger(index) || index < 0 || index >= total) return;
    const current = q.arenaMask ?? [];
    const next = current.includes(index)
      ? current.filter((i) => i !== index)
      : [...current, index].sort((a, b) => a - b); // 排序便於 git diff 與人類閱讀
    patchSelectedQuestion({ arenaMask: next });
  }

  /**
   * 清空當前題目的所有破碎格（保留 arena.grid 設定）。
   * 沒任何破碎 → no-op，不誤觸 dirty。
   */
  function clearArenaMask(): void {
    const q = selectedQuestion.value;
    if (!q) return;
    if (!q.arenaMask || q.arenaMask.length === 0) return;
    patchSelectedQuestion({ arenaMask: [] });
  }

  // ----------------------------------------------------------------------
  // Actions - Phase 3：連線（tethers）
  // ----------------------------------------------------------------------

  /**
   * 為當前題目新增一條連線。
   *
   * 預設 sourceId='boss' / targetId='A' / color='red' / kind='tether'：
   *   - 兩端都是 player ArenaMap 能立即解析的 ID（boss + waymark），
   *     新增完即可在畫布上看到視覺回饋，不會出現「加了卻看不到線」的困惑。
   *   - color 用紅是 FFXIV 連線最常見的視覺。
   *   - kind='tether' 是預設語意（牽線），出題者可在 UI 改成 'movement'。
   *     showEndIcon 不主動寫入，讓未明確設定者走 schema 的「依 kind 推導」預設。
   *
   * Why 不檢查「已存在重複連線」：同樣 source/target 同色的連線在出題語意中
   *   可能合理（例：兩條同方向但代表不同階段的牽引），讓出題者自行判斷。
   */
  function addTether(): void {
    const q = selectedQuestion.value;
    if (!q) return;
    const newTether: Tether = {
      sourceId: 'boss',
      targetId: 'A',
      color: 'red',
      kind: 'tether',
    };
    patchSelectedQuestion({ tethers: [...(q.tethers ?? []), newTether] });
  }

  /**
   * 部分更新指定 index 的連線（淺層 merge）。
   *
   * Why 用 index 而非 id：Tether schema 沒有 id 欄位（同樣 source/target
   *   組合可能合法重複，無法從 source/target 推導唯一 key），
   *   editor 端用陣列 index 引用是最直接的方式。
   *
   * 越界 index → no-op（防 UI race 例如「按刪除瞬間又按編輯」）。
   */
  function updateTether(index: number, updates: Partial<Tether>): void {
    const q = selectedQuestion.value;
    if (!q || !q.tethers) return;
    if (!Number.isInteger(index) || index < 0 || index >= q.tethers.length) return;
    const next = [...q.tethers];
    next[index] = { ...next[index], ...updates };
    patchSelectedQuestion({ tethers: next });
  }

  /**
   * 移除指定 index 的連線。越界 → no-op。
   */
  function removeTether(index: number): void {
    const q = selectedQuestion.value;
    if (!q || !q.tethers) return;
    if (!Number.isInteger(index) || index < 0 || index >= q.tethers.length) return;
    const next = q.tethers.filter((_, i) => i !== index);
    patchSelectedQuestion({ tethers: next });
  }

  return {
    // state
    dataset,
    currentFilename,
    selectedStrategyId,
    selectedQuestionId,
    selectedRoleId,
    availableFiles,
    publishedIndex,
    datasetSource,
    isLoading,
    isSaving,
    isLoadingPublished,
    isUploadingImage,
    error,
    isDirty,
    mode,
    selectedLineId,
    activeDrawingTool,
    drawingPoints,
    selectedSafeAreaId,
    questionSubMode,
    isLocalApiAvailable,
    // getters
    selectedStrategy,
    selectedQuestion,
    selectedRoleSolution,
    // actions
    refreshFileList,
    loadDataset,
    saveDataset,
    detectLocalApiAvailability,
    downloadDataset,
    loadDatasetFromJson,
    loadPublishedIndex,
    loadPublishedDataset,
    selectStrategy,
    selectQuestion,
    selectRole,
    updateWaymark,
    addWaymark,
    removeWaymark,
    setMode,
    setQuestionSubMode,
    selectLine,
    updateArena,
    setBackgroundImage,
    uploadAndSetBackground,
    addArenaLine,
    removeArenaLine,
    updateArenaLine,
    addQuestion,
    updateQuestion,
    deleteQuestion,
    duplicateQuestion,
    updateRoleSolution,
    startDrawing,
    cancelDrawing,
    appendDrawingPoint,
    commitSafeArea,
    removeSafeArea,
    selectSafeArea,
    removeSafeAreaById,
    addQuestionOption,
    updateQuestionOption,
    removeQuestionOption,
    moveQuestionOption,
    setCorrectOptionIds,
    // Phase 2 - 實體與場地
    updateBossPosition,
    updateBossFacing,
    addEnemy,
    updateEnemy,
    removeEnemy,
    addAnchor,
    updateAnchor,
    removeAnchor,
    updateArenaGrid,
    clearArenaGrid,
    toggleArenaMask,
    clearArenaMask,
    addTether,
    updateTether,
    removeTether,
    reset,
  };
});

// ========================================================================
// 純函數 helpers - 給 store 與測試共用
// ========================================================================

/**
 * 產生 8 職能空骨架的 RoleSolutions（依題型決定 shape）。
 *
 * Why 預填空骨架而非 undefined：
 *   UI 切到任一職能 tab 都應有可顯示的欄位（debuffs 為空陣列、safeAreas 為空陣列），
 *   避免 `Cannot read properties of undefined` 或 view 條件渲染複雜化。
 */
function createBlankRoleSolutions(
  type: QuestionType,
): Record<RoleId, RoleSolution> {
  const blank: RoleSolution =
    type === 'map-click'
      ? ({ debuffs: [], safeAreas: [] } as MapClickRoleSolution)
      : ({ debuffs: [], correctOptionIds: [] } as ChoiceRoleSolution);

  // structuredClone 確保 8 職能各持有獨立物件副本，
  // 不會發生「改 MT 的 debuffs 結果 ST 也變」的 reference 共享 bug
  const result = {} as Record<RoleId, RoleSolution>;
  for (const role of ROLE_IDS) {
    result[role] = structuredClone(blank);
  }
  return result;
}

/**
 * 建立空白題目骨架 - 依題型給合理預設。
 *
 * 預設值：
 *   - boss: { skillName: '新技能', castTime: 8, facing: 0 }
 *   - map-click: clickCount=1
 *   - choice 系列: 兩個空選項（出題者一定要至少改其一）
 *
 * @param strategyId  schema 1.1+ 必要欄位 - 題目所屬攻略組
 */
export function createBlankQuestion(
  type: QuestionType,
  instanceId: string,
  strategyId: string,
): Question {
  const id = `q-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const baseFields = {
    id,
    instanceId,
    strategyId,
    name: '新題目',
    boss: { skillName: '新技能', castTime: 8, facing: 0 },
    roleSolutions: createBlankRoleSolutions(type),
  };

  if (type === 'map-click') {
    return {
      ...baseFields,
      type: 'map-click',
      clickCount: 1,
      roleSolutions: baseFields.roleSolutions as Record<RoleId, MapClickRoleSolution>,
    } satisfies MapClickQuestion;
  }

  return {
    ...baseFields,
    type,
    options: [
      { id: 'opt-1', label: '選項 1' },
      { id: 'opt-2', label: '選項 2' },
    ],
    roleSolutions: baseFields.roleSolutions as Record<RoleId, ChoiceRoleSolution>,
  } satisfies ChoiceQuestion;
}

/**
 * 處理「題型變動」的 merge 邏輯。
 *
 * 規則：
 *   1. 共用欄位（id / instanceId / name / boss / phase / order）保留
 *   2. roleSolutions 重置為新題型的空骨架（避免殘留錯型別欄位）
 *   3. type 特異欄位用新型別預設
 *      - 切到 map-click: clickCount=1
 *      - 切到 choice 系列: options=兩個空選項
 *   4. 來自 patch 的其他欄位最後覆蓋（讓 patch 可同時帶 type + 其他欄位）
 *
 * Why 抽出獨立函數：邏輯複雜（涉及型別 narrow 與欄位重設），
 *      在 updateQuestion 內 inline 會讓主流程難讀。
 */
function mergeWithTypeChange(current: Question, patch: Partial<Question>): Question {
  const newType = patch.type as QuestionType;
  // 沿用 current.strategyId - 切題型不該動歸屬攻略
  const blank = createBlankQuestion(newType, current.instanceId, current.strategyId);
  // 共用欄位來自 current，但 type 特異欄位（clickCount/options/roleSolutions）來自 blank
  // patch 的其他欄位最後覆蓋
  return {
    ...blank,
    id: current.id,
    strategyId: current.strategyId,
    name: current.name,
    boss: current.boss,
    phase: current.phase,
    order: current.order,
    ...patch,
    // patch.type 已經透過 blank 套用；保險起見再強制一次
    type: newType,
    // roleSolutions 一律用新題型空骨架（即使 patch 帶了也忽略，避免半新半舊型別不符）
    roleSolutions: blank.roleSolutions,
  } as Question;
}

/**
 * 產生 SafeArea 的唯一識別碼。
 *
 * 格式：sa-{時間戳}-{隨機}。不依賴 crypto.randomUUID（測試環境可能無）。
 * 同一毫秒內多次呼叫加上 6 位隨機數，碰撞機率可忽略。
 */
function generateSafeAreaId(): string {
  return `sa-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/**
 * 產生 QuestionOption 的唯一識別碼。
 * 格式：opt-{時間戳}-{隨機}。
 */
function generateOptionId(): string {
  return `opt-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/**
 * 產生 EnemyEntity 的唯一識別碼。
 * 格式：enemy-{時間戳}-{隨機}。
 */
function generateEnemyId(): string {
  return `enemy-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/**
 * 產生 AnchorPoint 的唯一識別碼。
 * 格式：anchor-{時間戳}-{隨機}。
 */
function generateAnchorId(): string {
  return `anchor-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}
