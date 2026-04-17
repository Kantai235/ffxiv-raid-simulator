import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type {
  AnswerRecord,
  ChoiceQuestion,
  ChoiceRoleSolution,
  MapClickQuestion,
  MapClickRoleSolution,
  PlayerAnswer,
  Point2D,
  Question,
  RoleId,
  RoleSolution,
  SessionResult,
} from '@ffxiv-sim/shared';
import { isPointInSafeArea } from '@ffxiv-sim/shared';

/**
 * ========================================================================
 * Session Store - 練習進度核心狀態
 * ========================================================================
 *
 * 此 store 負責：
 *   1. 持有當前 session 的題目陣列、進度指標、作答歷程
 *   2. 玩家點擊軌跡的累積（單點覆蓋 / 多點累加 兩種模式）
 *   3. 倒數計時數值（純資料；實際 RAF tick 由 view 層驅動，見下）
 *   4. 核心結算：呼叫 shared 的 isPointInSafeArea 比對玩家點擊與安全區
 *   5. 進入下一題或結束 session 並組裝出 SessionResult
 *
 * 【架構切割 - 為何計時器不在 store 內】
 *   倒數本身的「剩餘時間數值」屬於 session 狀態，必須在 store。
 *   但驅動倒數的 requestAnimationFrame 屬於瀏覽器資源，由 view 層管理：
 *     - view 用 RAF 取 performance.now() 算 delta，呼叫 store.tick(deltaMs)
 *     - view unmount / 題目切換時清掉 RAF handle
 *   Why: store 保持純資料邏輯，單元測試無需 mock RAF；view 也能控制
 *        「載入畫面期間先暫停倒數」「結算時凍結倒數」等場景。
 *
 * 【連續走位的點擊累積規則】
 *   - clickCount === 1：每次點擊【覆蓋】前次（單點題玩家可改變主意）
 *   - clickCount > 1： 點擊【追加】到陣列，達到 clickCount 後再點則覆蓋最後一個
 *     Why: 避免玩家手抖多點造成滿出；最後一點可改才符合直覺
 *   - 選擇題/排序題：目前 recordClick 不處理，由 view 層另呼叫對應 action
 *
 * 【超時自動結算】
 *   tick(delta) 將剩餘時間扣到 ≤ 0 時，自動呼叫 evaluateCurrentQuestion。
 *   evaluate 只執行一次（用 isCurrentEvaluated 旗標保護），避免重複觸發。
 * ========================================================================
 */

/** 工具：產生 session id - 不依賴 crypto.randomUUID（測試環境不一定有） */
function generateSessionId(): string {
  return `session-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export const useSessionStore = defineStore('session', () => {
  // ----------------------------------------------------------------------
  // State
  // ----------------------------------------------------------------------

  /** 本次 session 的題目陣列（startSession 時帶入，session 結束前不變） */
  const questions = ref<Question[]>([]);

  /** 當前題目索引（0-based） */
  const currentIndex = ref(0);

  /** 已完成題目的作答紀錄（順序 = questions 順序） */
  const answers = ref<AnswerRecord[]>([]);

  /** 玩家在當前題目的點擊軌跡（map-click 題用） */
  const currentClicks = ref<Point2D[]>([]);

  /**
   * 玩家在當前選擇/排序題的選項 ID 集合。
   *
   * - 單選：長度 0 或 1（玩家可改變主意）
   * - 多選：任意長度，順序不重要（evaluate 時用 Set 比對）
   * - 排序：長度等於 options.length，順序即玩家排出的順序
   *
   * Why 與 currentClicks 分離：兩者語意不同（座標 vs 選項 ID），
   *      合併會讓型別與 actions 變得彆扭。題型彼此互斥，不會同時用到兩者。
   */
  const currentSelectedOptionIds = ref<string[]>([]);

  /** 當前題目剩餘讀條時間（秒） */
  const timeRemaining = ref(0);

  /** session 是否進行中（false = 未開始 或 已結束） */
  const isPracticing = ref(false);

  /** 當前題目開始作答的時間戳（ms），用於計算耗時 */
  const currentStartedAt = ref<number>(0);

  /**
   * 當前題目是否已結算過。
   * 防呆：超時觸發 evaluate 與玩家手動提交 evaluate 不能重複跑。
   */
  const isCurrentEvaluated = ref(false);

  // 玩家在 session 開始時固定的設定（從 settings store 帶入並冗餘儲存，
  // 方便組裝 SessionResult，且 session 進行中即使 settings 被改也不影響）
  const sessionMeta = ref<{
    sessionId: string;
    instanceId: string;
    strategyId: string;
    roleId: RoleId;
    startedAt: number;
  } | null>(null);

  // ----------------------------------------------------------------------
  // Getters
  // ----------------------------------------------------------------------

  /** 當前題目（若超出範圍則為 null） */
  const currentQuestion = computed<Question | null>(
    () => questions.value[currentIndex.value] ?? null,
  );

  /**
   * 當前題目對應玩家職能的解答資料。
   * 包含 debuffs（給 view 渲染狀態列）與 safeAreas/correctOptionIds（給 evaluate 用）。
   */
  const currentRoleSolution = computed<RoleSolution | null>(() => {
    const q = currentQuestion.value;
    const meta = sessionMeta.value;
    if (!q || !meta) return null;
    return q.roleSolutions[meta.roleId] ?? null;
  });

  /** 是否為最後一題（用於 view 顯示「最後一題」字樣或調整按鈕文字） */
  const isLastQuestion = computed(
    () => questions.value.length > 0 && currentIndex.value === questions.value.length - 1,
  );

  /** 進度百分比（0~100），給讀條視覺用 */
  const progressPercent = computed(() => {
    const q = currentQuestion.value;
    if (!q) return 0;
    const total = q.boss.castTime;
    if (total <= 0) return 100;
    // 倒數：剩餘時間越少進度越滿
    return Math.min(100, Math.max(0, ((total - timeRemaining.value) / total) * 100));
  });

  // ----------------------------------------------------------------------
  // Actions
  // ----------------------------------------------------------------------

  /**
   * 開始 session - 初始化所有狀態並載入第一題。
   *
   * 【schema 1.1+ 題目綁攻略】
   * 呼叫端通常傳入 dataset.questions（含該副本所有攻略的題目），
   * 此處【內部過濾】只保留 q.strategyId === payload.strategyId 的題目。
   * 這樣 PracticeView 不需要關心過濾邏輯，store 保證玩家不會看到別組攻略的題目。
   *
   * 不在 dataset 中存在的攻略 ID（孤兒題目）也會被自動排除。
   *
   * @param payload  從 settings store 取得的當前設定 + dataset.questions
   */
  function startSession(payload: {
    questions: Question[];
    instanceId: string;
    strategyId: string;
    roleId: RoleId;
  }): void {
    const now = Date.now();
    sessionMeta.value = {
      sessionId: generateSessionId(),
      instanceId: payload.instanceId,
      strategyId: payload.strategyId,
      roleId: payload.roleId,
      startedAt: now,
    };
    // 過濾：只保留屬於當前攻略的題目
    questions.value = payload.questions.filter((q) => q.strategyId === payload.strategyId);
    currentIndex.value = 0;
    answers.value = [];
    isPracticing.value = true;
    loadCurrentQuestion(now);
  }

  /**
   * 載入當前 currentIndex 指向的題目 - 重設點擊、選項、計時、結算旗標。
   * 內部使用，不對外暴露。
   *
   * 排序題特殊處理：預填 options 順序為玩家初始排列。
   *   Why: 排序題玩家是「調整現有順序」而非「從零組裝」，預填讓 UI 直接呈現
   *        待調整列表；題目作者應在 options 陣列中刻意排成需要調整的初始順序。
   */
  function loadCurrentQuestion(startTimestamp: number): void {
    const q = currentQuestion.value;
    currentClicks.value = [];
    if (q && q.type === 'ordering') {
      currentSelectedOptionIds.value = q.options.map((o) => o.id);
    } else {
      currentSelectedOptionIds.value = [];
    }
    isCurrentEvaluated.value = false;
    currentStartedAt.value = startTimestamp;
    timeRemaining.value = q ? q.boss.castTime : 0;
  }

  /**
   * 紀錄玩家點擊。
   *
   * 行為依題型分流：
   *   - map-click + clickCount > 1：追加，超過上限時覆蓋最後一點
   *   - map-click + clickCount === 1：覆蓋（玩家可改變主意）
   *   - 其他題型：忽略（view 層應呼叫專屬 action，未來補）
   *
   * 已結算的題目（isCurrentEvaluated）不再接受點擊。
   */
  function recordClick(point: Point2D): void {
    if (isCurrentEvaluated.value) return;
    const q = currentQuestion.value;
    if (!q || q.type !== 'map-click') return;

    if (q.clickCount === 1) {
      // 單點題：覆蓋
      currentClicks.value = [point];
      return;
    }

    // 連續走位：追加；達到上限後覆蓋最後一點
    if (currentClicks.value.length < q.clickCount) {
      currentClicks.value = [...currentClicks.value, point];
    } else {
      currentClicks.value = [...currentClicks.value.slice(0, -1), point];
    }
  }

  /**
   * 設定玩家當前選擇/排序題的作答（全量覆寫）。
   *
   * View 層算好完整的 ID 陣列後呼叫此 action：
   *   - 單選題：view 傳 [選中的 ID] 或 [] 表未選
   *   - 多選題：view 傳目前勾選的所有 ID 陣列
   *   - 排序題：一般不用此 action，改用 moveOption 調整順序
   *
   * Why 全量覆寫而非 toggle：
   *   view 層用 v-model 綁 checkbox/radio 時自然就能拿到全量陣列，
   *   store 不需要知道「是新增還是移除」這個差異，介面最簡單。
   *
   * 已結算的題目會忽略後續寫入，避免幽靈輸入變更答案。
   */
  function setSelectedOptions(ids: string[]): void {
    if (isCurrentEvaluated.value) return;
    const q = currentQuestion.value;
    if (!q || q.type === 'map-click') return;
    // 複製一份避免外部持有相同陣列 reference 造成意外共享
    currentSelectedOptionIds.value = [...ids];
  }

  /**
   * 排序題 - 將指定 ID 上移或下移一格。
   *
   * 邊界：已在最上（最下）時 moveUp（moveDown）是 no-op，不拋錯。
   * Why: UI 按鈕可用 disabled 擋掉邊界，但 store 層仍做防禦性檢查，
   *      避免測試或未來外部呼叫時打進意外狀態。
   */
  function moveOption(optionId: string, direction: 'up' | 'down'): void {
    if (isCurrentEvaluated.value) return;
    const q = currentQuestion.value;
    if (!q || q.type !== 'ordering') return;

    const ids = currentSelectedOptionIds.value;
    const idx = ids.indexOf(optionId);
    if (idx === -1) return;

    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= ids.length) return;

    // 交換兩個位置，用新陣列避免 Vue 檢測不到變更
    const next = [...ids];
    [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
    currentSelectedOptionIds.value = next;
  }

  /**
   * 結算當前題目 - 比對 currentClicks 與 currentRoleSolution.safeAreas。
   *
   * 判定規則（map-click）：
   *   1. 點數需等於 clickCount，否則直接判錯（含超時點數不足）
   *   2. 每個點需依序落在對應 index 的 safeArea 內
   *   3. 任何一點不命中 → 整題判錯
   *
   * 結算後將 AnswerRecord 推入 answers，並設 isCurrentEvaluated=true。
   *
   * @param options.timedOut  是否為超時觸發（影響 AnswerRecord.timedOut）
   */
  function evaluateCurrentQuestion(options: { timedOut?: boolean } = {}): void {
    if (isCurrentEvaluated.value) return;
    const q = currentQuestion.value;
    const meta = sessionMeta.value;
    const sol = currentRoleSolution.value;
    if (!q || !meta || !sol) return;

    let answer: PlayerAnswer;
    let isCorrect = false;

    if (q.type === 'map-click') {
      // sol 必為 MapClickRoleSolution（受 Question.type 判別）
      const mapSol = sol as MapClickRoleSolution;
      const clicks = currentClicks.value;
      answer = {
        type: 'map-click',
        clicks: clicks.map((p) => ({ position: p, timestamp: Date.now() })),
      };
      isCorrect = evaluateMapClick(q, mapSol, clicks);
    } else {
      // 選擇/多選/排序：sol 必為 ChoiceRoleSolution
      const choiceSol = sol as ChoiceRoleSolution;
      const selected = currentSelectedOptionIds.value;
      answer = {
        type: q.type,
        selectedOptionIds: [...selected],
      };
      isCorrect = evaluateChoice(q, choiceSol, selected);
    }

    answers.value = [
      ...answers.value,
      {
        questionId: q.id,
        roleId: meta.roleId,
        answer,
        isCorrect,
        startedAt: currentStartedAt.value,
        finishedAt: Date.now(),
        timedOut: options.timedOut ?? false,
      },
    ];
    isCurrentEvaluated.value = true;
  }

  /**
   * 進入下一題；若已是最後一題則結束 session。
   *
   * Why 不在此呼叫 router：保持 store 與路由解耦，view 層觀察
   *      isPracticing 變化決定何時導向 /result。
   *
   * @returns 是否成功進入下一題（false = session 已結束）
   */
  function nextQuestion(): boolean {
    if (currentIndex.value >= questions.value.length - 1) {
      // 已是最後一題 → 結束 session
      isPracticing.value = false;
      return false;
    }
    currentIndex.value += 1;
    loadCurrentQuestion(Date.now());
    return true;
  }

  /**
   * RAF tick - 由 view 層每幀呼叫，扣減剩餘時間並在歸零時自動結算。
   *
   * @param deltaMs  距上次 tick 的真實時間差（毫秒）
   */
  function tick(deltaMs: number): void {
    if (!isPracticing.value || isCurrentEvaluated.value) return;
    timeRemaining.value = Math.max(0, timeRemaining.value - deltaMs / 1000);
    if (timeRemaining.value <= 0) {
      evaluateCurrentQuestion({ timedOut: true });
    }
  }

  /**
   * 取得結算結果 - 給 ResultView 顯示用。
   * 必須在 isPracticing === false 後才呼叫，否則資料未完成。
   */
  function getResult(): SessionResult | null {
    const meta = sessionMeta.value;
    if (!meta) return null;
    return {
      sessionId: meta.sessionId,
      instanceId: meta.instanceId,
      strategyId: meta.strategyId,
      roleId: meta.roleId,
      startedAt: meta.startedAt,
      finishedAt: Date.now(),
      answers: answers.value,
      totalCount: questions.value.length,
      correctCount: answers.value.filter((a) => a.isCorrect).length,
    };
  }

  /** 完整重置 - 給「再試一次」或測試使用 */
  function reset(): void {
    questions.value = [];
    currentIndex.value = 0;
    answers.value = [];
    currentClicks.value = [];
    currentSelectedOptionIds.value = [];
    timeRemaining.value = 0;
    isPracticing.value = false;
    currentStartedAt.value = 0;
    isCurrentEvaluated.value = false;
    sessionMeta.value = null;
  }

  /**
   * 重新練習 - 沿用相同設定（副本/攻略/職能/題目）但清空答案與進度。
   *
   * Why 不直接呼叫 reset() 後重新 startSession：
   *   呼叫端（ResultView）已沒有 settings store 的 dataset 引用，
   *   讓 store 自己 in-place 重啟最簡單，也避免 view 層需要重新組裝 payload。
   *
   * @returns 是否成功重啟（false = 沒有可重啟的 session）
   */
  function restartSession(): boolean {
    const meta = sessionMeta.value;
    if (!meta || questions.value.length === 0) return false;
    // 重新生成 sessionId 表示這是新一輪，但保留 instance/strategy/role
    const now = Date.now();
    sessionMeta.value = { ...meta, sessionId: generateSessionId(), startedAt: now };
    currentIndex.value = 0;
    answers.value = [];
    isPracticing.value = true;
    loadCurrentQuestion(now);
    return true;
  }

  /**
   * 依 index 取得對應題目與作答的組合，給 ReviewView 使用。
   *
   * @returns null 表 index 越界或對應 answer/question 不存在
   */
  function getReviewItem(index: number): {
    question: Question;
    answer: AnswerRecord;
    solution: RoleSolution | null;
  } | null {
    if (index < 0 || index >= answers.value.length) return null;
    const answer = answers.value[index];
    const question = questions.value[index];
    const meta = sessionMeta.value;
    if (!question || !meta) return null;
    // answer.questionId 與 question.id 應該一致；不一致代表資料錯亂
    if (answer.questionId !== question.id) return null;
    return {
      question,
      answer,
      solution: question.roleSolutions[meta.roleId] ?? null,
    };
  }

  /** 是否有可供結算/回顧的資料（給 view 防呆 redirect 用） */
  const hasRecordedAnswers = computed(() => answers.value.length > 0);

  return {
    // state
    questions,
    currentIndex,
    answers,
    currentClicks,
    currentSelectedOptionIds,
    timeRemaining,
    isPracticing,
    isCurrentEvaluated,
    sessionMeta,
    // getters
    currentQuestion,
    currentRoleSolution,
    isLastQuestion,
    progressPercent,
    hasRecordedAnswers,
    // actions
    startSession,
    recordClick,
    setSelectedOptions,
    moveOption,
    evaluateCurrentQuestion,
    nextQuestion,
    tick,
    getResult,
    reset,
    restartSession,
    getReviewItem,
  };
});

// ========================================================================
// 純函數 - 結算邏輯（抽出方便測試與未來重用）
// ========================================================================

/**
 * 判定 map-click 題的玩家作答是否正確。
 *
 * 純函數，不依賴 store；單元測試可直接呼叫。
 *
 * 規則：
 *   1. clicks.length 需等於 question.clickCount（不足或超過皆判錯）
 *   2. 每個 clicks[i] 需落在 solution.safeAreas[i] 內（含邊界，沿用 isPointInSafeArea 政策）
 *   3. 任一點不命中 → 整題錯
 *
 * Why 嚴格依序比對：連續走位機制是「第幾步該到哪」的順序敏感題，
 *      若改成「集合對集合」可能誤判（例如先去 A 再去 B vs 先去 B 再去 A 結果完全不同）。
 */
export function evaluateMapClick(
  question: MapClickQuestion,
  solution: MapClickRoleSolution,
  clicks: Point2D[],
): boolean {
  if (clicks.length !== question.clickCount) return false;
  if (solution.safeAreas.length !== question.clickCount) {
    // 資料完整性問題：題目宣告 N 步但解答只給了 M 個安全區。
    // 視為判錯比 throw 安全（不會中斷整場練習）。
    return false;
  }
  return clicks.every((click, i) => isPointInSafeArea(click, solution.safeAreas[i]));
}

/**
 * 判定選擇/排序題的玩家作答是否正確。
 *
 * 純函數，依 question.type 採不同比對策略：
 *
 *   - single-choice：玩家應只選 1 個，且該 ID 須等於 correctOptionIds[0]。
 *                    若解答有多個 correctOptionId（資料錯誤），保險起見要求玩家
 *                    選的那個必須在解答集合內。
 *   - multi-choice ：無序集合比對 - 玩家集合須與解答集合「完全相等」
 *                    （長度相同 + 每個 ID 雙向包含），少選或多選皆錯。
 *   - ordering     ：嚴格依序比對 - 兩陣列長度與每個 index 都需相同。
 *
 * 邊界：
 *   - 玩家選空陣列：multi/ordering 直接判錯（除非解答也是空，極端情況保險判對）
 *   - 解答為空陣列：資料應視為錯誤；玩家也選空時為對，否則為錯
 */
export function evaluateChoice(
  question: ChoiceQuestion,
  solution: ChoiceRoleSolution,
  selected: string[],
): boolean {
  const correct = solution.correctOptionIds;

  switch (question.type) {
    case 'single-choice': {
      if (selected.length !== 1) return false;
      // 嚴格 - 只認解答的第一個（單選題的解答慣例只有 1 個）
      // 但若資料給了多個，玩家選中其一也視為對（容錯，避免題目資料錯誤直接讓玩家全錯）
      return correct.includes(selected[0]);
    }

    case 'multi-choice': {
      if (selected.length !== correct.length) return false;
      // 雙向包含 = 集合相等。用 Set 處理 O(n) 而非雙層 every O(n²)
      const correctSet = new Set(correct);
      // 同時擋掉玩家「重複勾選同一 ID」的情境（理論上 UI 不會發生但仍防禦）
      const selectedSet = new Set(selected);
      if (selectedSet.size !== selected.length) return false;
      return selected.every((id) => correctSet.has(id));
    }

    case 'ordering': {
      if (selected.length !== correct.length) return false;
      return selected.every((id, i) => id === correct[i]);
    }
  }
}
