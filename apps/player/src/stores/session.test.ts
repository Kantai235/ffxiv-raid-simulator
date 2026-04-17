import { setActivePinia, createPinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  ChoiceQuestion,
  ChoiceRoleSolution,
  MapClickQuestion,
  MapClickRoleSolution,
  Question,
  RoleId,
} from '@ffxiv-sim/shared';
import { evaluateChoice, evaluateMapClick, useSessionStore } from './session';

/**
 * ========================================================================
 * Session Store 測試 - 重點：evaluateCurrentQuestion 與連續走位邏輯
 * ========================================================================
 *
 * 涵蓋：
 *   1. 純函數 evaluateMapClick：點數不符 / 全對 / 部分錯 / 邊界命中
 *   2. recordClick：單點覆蓋 vs 多點累加 vs 達上限後覆蓋
 *   3. evaluateCurrentQuestion：寫入 AnswerRecord、isCorrect 正確、防重複結算
 *   4. tick 倒數歸零自動結算 + timedOut 旗標
 *   5. nextQuestion 切題 + 結束 session
 * ========================================================================
 */

// ----------------------------------------------------------------------
// 測試資料工廠
// ----------------------------------------------------------------------

/**
 * 建立一個 8 職能 RoleSolutions，所有職能共用同一份 spec。
 * 簡化測試 - 不關心職能差異時只要塞同一份。
 */
function makeRoleSolutions<T>(spec: T): Record<RoleId, T> {
  return {
    MT: spec,
    ST: spec,
    H1: spec,
    H2: spec,
    D1: spec,
    D2: spec,
    D3: spec,
    D4: spec,
  };
}

/** 建立 map-click 題的 helper */
/**
 * 預設測試攻略 ID。所有測試題目都歸屬此攻略；startSession 傳相同值即可通過過濾。
 */
const TEST_STRATEGY_ID = 's';

function makeMapClickQuestion(
  id: string,
  clickCount: number,
  safeAreas: MapClickRoleSolution['safeAreas'],
  castTime = 8,
): MapClickQuestion {
  return {
    id,
    instanceId: 'm1s',
    strategyId: TEST_STRATEGY_ID,
    name: `題 ${id}`,
    type: 'map-click',
    clickCount,
    boss: { skillName: '技能', castTime, facing: 0 },
    roleSolutions: makeRoleSolutions<MapClickRoleSolution>({
      debuffs: [],
      safeAreas,
    }),
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

// ========================================================================
// 純函數 evaluateMapClick
// ========================================================================

describe('evaluateMapClick (純函數)', () => {
  const singleCircleArea: MapClickRoleSolution['safeAreas'] = [
    { shape: 'circle', center: { x: 100, y: 100 }, radius: 50 },
  ];

  it('點數不符 (玩家少點) → 判錯', () => {
    const q = makeMapClickQuestion('q', 2, [
      { shape: 'circle', center: { x: 0, y: 0 }, radius: 10 },
      { shape: 'circle', center: { x: 100, y: 0 }, radius: 10 },
    ]);
    const sol = q.roleSolutions.MT;
    expect(evaluateMapClick(q, sol, [{ x: 0, y: 0 }])).toBe(false);
  });

  it('點數不符 (玩家多點) → 判錯', () => {
    const q = makeMapClickQuestion('q', 1, singleCircleArea);
    const sol = q.roleSolutions.MT;
    expect(
      evaluateMapClick(q, sol, [
        { x: 100, y: 100 },
        { x: 100, y: 100 },
      ]),
    ).toBe(false);
  });

  it('單點題：點在安全區內 → 對', () => {
    const q = makeMapClickQuestion('q', 1, singleCircleArea);
    expect(evaluateMapClick(q, q.roleSolutions.MT, [{ x: 110, y: 110 }])).toBe(true);
  });

  it('單點題：點在邊界上 → 對（沿用 isPointInSafeArea 邊界政策）', () => {
    const q = makeMapClickQuestion('q', 1, singleCircleArea);
    // 距圓心剛好 50（半徑）
    expect(evaluateMapClick(q, q.roleSolutions.MT, [{ x: 150, y: 100 }])).toBe(true);
  });

  it('單點題：點在外面 → 錯', () => {
    const q = makeMapClickQuestion('q', 1, singleCircleArea);
    expect(evaluateMapClick(q, q.roleSolutions.MT, [{ x: 200, y: 100 }])).toBe(false);
  });

  it('連續走位 (clickCount=3)：三點全對應安全區 → 對', () => {
    const q = makeMapClickQuestion('q', 3, [
      { shape: 'circle', center: { x: 0, y: 0 }, radius: 10 },
      { shape: 'circle', center: { x: 100, y: 0 }, radius: 10 },
      { shape: 'rect', x: 200, y: 0, width: 20, height: 20 },
    ]);
    const clicks = [
      { x: 5, y: 5 },
      { x: 100, y: 0 },
      { x: 210, y: 10 },
    ];
    expect(evaluateMapClick(q, q.roleSolutions.MT, clicks)).toBe(true);
  });

  it('連續走位：第二點錯地方 → 整題判錯', () => {
    const q = makeMapClickQuestion('q', 3, [
      { shape: 'circle', center: { x: 0, y: 0 }, radius: 10 },
      { shape: 'circle', center: { x: 100, y: 0 }, radius: 10 },
      { shape: 'circle', center: { x: 200, y: 0 }, radius: 10 },
    ]);
    const clicks = [
      { x: 0, y: 0 },
      { x: 999, y: 999 }, // 第二點錯
      { x: 200, y: 0 },
    ];
    expect(evaluateMapClick(q, q.roleSolutions.MT, clicks)).toBe(false);
  });

  it('連續走位：順序敏感 - 點對位置但順序錯 → 判錯', () => {
    // safeArea 順序 A → B；玩家點 B → A，點數對、位置都在安全區內，但順序錯
    const q = makeMapClickQuestion('q', 2, [
      { shape: 'circle', center: { x: 0, y: 0 }, radius: 10 },
      { shape: 'circle', center: { x: 100, y: 0 }, radius: 10 },
    ]);
    const clicks = [
      { x: 100, y: 0 }, // 第一點落在第二個安全區
      { x: 0, y: 0 }, // 第二點落在第一個安全區
    ];
    expect(evaluateMapClick(q, q.roleSolutions.MT, clicks)).toBe(false);
  });

  it('資料完整性：safeAreas 數量與 clickCount 不符 → 判錯（防護性）', () => {
    const q = makeMapClickQuestion('q', 3, [
      { shape: 'circle', center: { x: 0, y: 0 }, radius: 10 },
      // 只給 1 個安全區但 clickCount 宣告 3
    ]);
    const clicks = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];
    expect(evaluateMapClick(q, q.roleSolutions.MT, clicks)).toBe(false);
  });
});

// ========================================================================
// Store 行為：recordClick
// ========================================================================

describe('recordClick - 點擊累積規則', () => {
  it('單點題：每次點擊覆蓋前次', () => {
    const store = useSessionStore();
    const q = makeMapClickQuestion('q', 1, [
      { shape: 'circle', center: { x: 0, y: 0 }, radius: 10 },
    ]);
    store.startSession({
      questions: [q],
      instanceId: 'm1s',
      strategyId: 's',
      roleId: 'MT',
    });

    store.recordClick({ x: 1, y: 1 });
    store.recordClick({ x: 2, y: 2 });
    store.recordClick({ x: 3, y: 3 });
    expect(store.currentClicks).toEqual([{ x: 3, y: 3 }]);
  });

  it('連續走位：未滿時追加', () => {
    const store = useSessionStore();
    const q = makeMapClickQuestion('q', 3, [
      { shape: 'circle', center: { x: 0, y: 0 }, radius: 10 },
      { shape: 'circle', center: { x: 100, y: 0 }, radius: 10 },
      { shape: 'circle', center: { x: 200, y: 0 }, radius: 10 },
    ]);
    store.startSession({ questions: [q], instanceId: 'm1s', strategyId: 's', roleId: 'MT' });

    store.recordClick({ x: 1, y: 1 });
    store.recordClick({ x: 2, y: 2 });
    expect(store.currentClicks).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
  });

  it('連續走位：達上限後覆蓋最後一點（避免滿出 + 允許改最後一點）', () => {
    const store = useSessionStore();
    const q = makeMapClickQuestion('q', 2, [
      { shape: 'circle', center: { x: 0, y: 0 }, radius: 10 },
      { shape: 'circle', center: { x: 100, y: 0 }, radius: 10 },
    ]);
    store.startSession({ questions: [q], instanceId: 'm1s', strategyId: 's', roleId: 'MT' });

    store.recordClick({ x: 1, y: 1 });
    store.recordClick({ x: 2, y: 2 });
    store.recordClick({ x: 3, y: 3 }); // 滿了 → 覆蓋第二點
    store.recordClick({ x: 4, y: 4 }); // 仍覆蓋第二點
    expect(store.currentClicks).toEqual([
      { x: 1, y: 1 },
      { x: 4, y: 4 },
    ]);
  });

  it('已結算後再點擊 → 忽略', () => {
    const store = useSessionStore();
    const q = makeMapClickQuestion('q', 1, [
      { shape: 'circle', center: { x: 0, y: 0 }, radius: 10 },
    ]);
    store.startSession({ questions: [q], instanceId: 'm1s', strategyId: 's', roleId: 'MT' });

    store.recordClick({ x: 0, y: 0 });
    store.evaluateCurrentQuestion();
    const before = [...store.currentClicks];
    store.recordClick({ x: 999, y: 999 });
    expect(store.currentClicks).toEqual(before);
  });
});

// ========================================================================
// Store 行為：evaluateCurrentQuestion
// ========================================================================

describe('evaluateCurrentQuestion', () => {
  it('成功結算 → 寫入 AnswerRecord + isCorrect 正確 + 防重複', () => {
    const store = useSessionStore();
    const q = makeMapClickQuestion('q', 1, [
      { shape: 'circle', center: { x: 100, y: 100 }, radius: 50 },
    ]);
    store.startSession({ questions: [q], instanceId: 'm1s', strategyId: 's', roleId: 'MT' });

    store.recordClick({ x: 100, y: 100 });
    store.evaluateCurrentQuestion();

    expect(store.answers).toHaveLength(1);
    expect(store.answers[0].isCorrect).toBe(true);
    expect(store.answers[0].questionId).toBe('q');
    expect(store.answers[0].roleId).toBe('MT');
    expect(store.answers[0].timedOut).toBe(false);
    expect(store.isCurrentEvaluated).toBe(true);

    // 重複呼叫不應追加
    store.evaluateCurrentQuestion();
    expect(store.answers).toHaveLength(1);
  });

  it('未點擊就結算 (例如超時) → 判錯 + timedOut=true', () => {
    const store = useSessionStore();
    const q = makeMapClickQuestion('q', 1, [
      { shape: 'circle', center: { x: 100, y: 100 }, radius: 50 },
    ]);
    store.startSession({ questions: [q], instanceId: 'm1s', strategyId: 's', roleId: 'MT' });

    store.evaluateCurrentQuestion({ timedOut: true });

    expect(store.answers[0].isCorrect).toBe(false);
    expect(store.answers[0].timedOut).toBe(true);
  });

  it('使用對應職能的 RoleSolution（不同職能 debuff/safeArea 不同）', () => {
    const store = useSessionStore();
    const q: MapClickQuestion = {
      id: 'q',
      instanceId: 'm1s',
      strategyId: TEST_STRATEGY_ID,
      name: 'q',
      type: 'map-click',
      clickCount: 1,
      boss: { skillName: 's', castTime: 8, facing: 0 },
      roleSolutions: {
        ...makeRoleSolutions<MapClickRoleSolution>({
          debuffs: [],
          safeAreas: [{ shape: 'circle', center: { x: 999, y: 999 }, radius: 1 }],
        }),
        // MT 的安全區明顯不同
        MT: {
          debuffs: ['x'],
          safeAreas: [{ shape: 'circle', center: { x: 0, y: 0 }, radius: 10 }],
        },
      },
    };
    store.startSession({ questions: [q], instanceId: 'm1s', strategyId: 's', roleId: 'MT' });

    // 點 (0,0) 對 MT 是對；對其他職能是錯
    store.recordClick({ x: 0, y: 0 });
    store.evaluateCurrentQuestion();
    expect(store.answers[0].isCorrect).toBe(true);
  });
});

// ========================================================================
// Store 行為：tick 倒數
// ========================================================================

describe('tick 倒數計時', () => {
  it('扣減 timeRemaining，未歸零不結算', () => {
    const store = useSessionStore();
    const q = makeMapClickQuestion('q', 1, [
      { shape: 'circle', center: { x: 0, y: 0 }, radius: 10 },
    ], 8);
    store.startSession({ questions: [q], instanceId: 'm1s', strategyId: 's', roleId: 'MT' });

    store.tick(1000); // 扣 1 秒
    expect(store.timeRemaining).toBeCloseTo(7);
    expect(store.isCurrentEvaluated).toBe(false);
  });

  it('歸零時自動結算且帶 timedOut=true', () => {
    const store = useSessionStore();
    const q = makeMapClickQuestion('q', 1, [
      { shape: 'circle', center: { x: 0, y: 0 }, radius: 10 },
    ], 2);
    store.startSession({ questions: [q], instanceId: 'm1s', strategyId: 's', roleId: 'MT' });

    store.tick(2500); // 扣超過 castTime
    expect(store.timeRemaining).toBe(0);
    expect(store.isCurrentEvaluated).toBe(true);
    expect(store.answers[0].timedOut).toBe(true);
  });

  it('已結算後 tick 不再扣時間（避免覆蓋玩家視覺）', () => {
    const store = useSessionStore();
    const q = makeMapClickQuestion('q', 1, [
      { shape: 'circle', center: { x: 0, y: 0 }, radius: 10 },
    ], 8);
    store.startSession({ questions: [q], instanceId: 'm1s', strategyId: 's', roleId: 'MT' });

    store.recordClick({ x: 0, y: 0 });
    store.evaluateCurrentQuestion();
    const beforeTime = store.timeRemaining;
    store.tick(500);
    expect(store.timeRemaining).toBe(beforeTime);
  });
});

// ========================================================================
// Store 行為：題目流程
// ========================================================================

describe('nextQuestion 與 session 結束', () => {
  function makeMultiQuestionSession() {
    const store = useSessionStore();
    const qs: Question[] = [
      makeMapClickQuestion('q1', 1, [{ shape: 'circle', center: { x: 0, y: 0 }, radius: 10 }]),
      makeMapClickQuestion('q2', 1, [{ shape: 'circle', center: { x: 0, y: 0 }, radius: 10 }]),
      makeMapClickQuestion('q3', 1, [{ shape: 'circle', center: { x: 0, y: 0 }, radius: 10 }]),
    ];
    store.startSession({ questions: qs, instanceId: 'm1s', strategyId: 's', roleId: 'MT' });
    return store;
  }

  it('nextQuestion 切換時重置 currentClicks / timeRemaining / isCurrentEvaluated', () => {
    const store = makeMultiQuestionSession();
    store.recordClick({ x: 0, y: 0 });
    store.evaluateCurrentQuestion();
    expect(store.isCurrentEvaluated).toBe(true);

    const advanced = store.nextQuestion();
    expect(advanced).toBe(true);
    expect(store.currentIndex).toBe(1);
    expect(store.currentClicks).toEqual([]);
    expect(store.isCurrentEvaluated).toBe(false);
    expect(store.timeRemaining).toBeGreaterThan(0);
  });

  it('最後一題後再呼叫 nextQuestion → 結束 session', () => {
    const store = makeMultiQuestionSession();
    // 跑到最後一題
    store.nextQuestion();
    store.nextQuestion();
    expect(store.currentIndex).toBe(2);
    expect(store.isLastQuestion).toBe(true);
    expect(store.isPracticing).toBe(true);

    const advanced = store.nextQuestion();
    expect(advanced).toBe(false);
    expect(store.isPracticing).toBe(false);
  });

  it('getResult 計算正確率', () => {
    const store = makeMultiQuestionSession();

    store.recordClick({ x: 0, y: 0 }); // q1 對
    store.evaluateCurrentQuestion();
    store.nextQuestion();

    store.evaluateCurrentQuestion(); // q2 沒點 → 錯
    store.nextQuestion();

    store.recordClick({ x: 0, y: 0 }); // q3 對
    store.evaluateCurrentQuestion();
    store.nextQuestion(); // 結束

    const result = store.getResult();
    expect(result?.totalCount).toBe(3);
    expect(result?.correctCount).toBe(2);
  });
});

// ========================================================================
// restartSession 與 getReviewItem
// ========================================================================

describe('restartSession', () => {
  it('沿用相同設定 + 清空 answers + currentIndex 歸零 + isPracticing=true', () => {
    const store = useSessionStore();
    const qs = [
      makeMapClickQuestion('q1', 1, [{ shape: 'circle', center: { x: 0, y: 0 }, radius: 10 }]),
      makeMapClickQuestion('q2', 1, [{ shape: 'circle', center: { x: 0, y: 0 }, radius: 10 }]),
    ];
    store.startSession({ questions: qs, instanceId: 'm1s', strategyId: 's', roleId: 'MT' });
    const originalSessionId = store.sessionMeta?.sessionId;

    store.evaluateCurrentQuestion();
    store.nextQuestion();
    store.evaluateCurrentQuestion();
    store.nextQuestion(); // session 結束
    expect(store.isPracticing).toBe(false);
    expect(store.answers).toHaveLength(2);

    const ok = store.restartSession();
    expect(ok).toBe(true);
    expect(store.answers).toHaveLength(0);
    expect(store.currentIndex).toBe(0);
    expect(store.isPracticing).toBe(true);
    expect(store.questions).toHaveLength(2); // 題目沿用
    expect(store.sessionMeta?.roleId).toBe('MT'); // 設定沿用
    expect(store.sessionMeta?.sessionId).not.toBe(originalSessionId); // 但生成新 sessionId
  });

  it('未開始過 session → 回傳 false 且不變動狀態', () => {
    const store = useSessionStore();
    expect(store.restartSession()).toBe(false);
    expect(store.isPracticing).toBe(false);
  });
});

describe('getReviewItem', () => {
  it('回傳指定 index 的題目 + answer + solution', () => {
    const store = useSessionStore();
    const qs = [
      makeMapClickQuestion('q1', 1, [{ shape: 'circle', center: { x: 0, y: 0 }, radius: 10 }]),
      makeMapClickQuestion('q2', 1, [{ shape: 'circle', center: { x: 100, y: 100 }, radius: 10 }]),
    ];
    store.startSession({ questions: qs, instanceId: 'm1s', strategyId: 's', roleId: 'MT' });
    store.recordClick({ x: 0, y: 0 });
    store.evaluateCurrentQuestion();
    store.nextQuestion();
    store.evaluateCurrentQuestion();

    const item0 = store.getReviewItem(0);
    expect(item0?.question.id).toBe('q1');
    expect(item0?.answer.isCorrect).toBe(true);
    expect(item0?.solution).not.toBeNull();

    const item1 = store.getReviewItem(1);
    expect(item1?.question.id).toBe('q2');
    expect(item1?.answer.isCorrect).toBe(false);
  });

  it('index 越界 → null', () => {
    const store = useSessionStore();
    const qs = [makeMapClickQuestion('q1', 1, [{ shape: 'circle', center: { x: 0, y: 0 }, radius: 10 }])];
    store.startSession({ questions: qs, instanceId: 'm1s', strategyId: 's', roleId: 'MT' });
    store.evaluateCurrentQuestion();

    expect(store.getReviewItem(-1)).toBeNull();
    expect(store.getReviewItem(99)).toBeNull();
  });

  it('未開始過 session → null', () => {
    const store = useSessionStore();
    expect(store.getReviewItem(0)).toBeNull();
  });
});

describe('hasRecordedAnswers getter', () => {
  it('未答任何題 → false', () => {
    const store = useSessionStore();
    expect(store.hasRecordedAnswers).toBe(false);
  });

  it('答完至少一題 → true', () => {
    const store = useSessionStore();
    const qs = [makeMapClickQuestion('q1', 1, [{ shape: 'circle', center: { x: 0, y: 0 }, radius: 10 }])];
    store.startSession({ questions: qs, instanceId: 'm1s', strategyId: 's', roleId: 'MT' });
    store.evaluateCurrentQuestion();
    expect(store.hasRecordedAnswers).toBe(true);
  });
});

// ========================================================================
// 選擇/排序題系列 - 純函數 evaluateChoice
// ========================================================================

/** 建立 choice 系列題的 helper */
function makeChoiceQuestion(
  type: 'single-choice' | 'multi-choice' | 'ordering',
  optionLabels: string[],
  correctOptionIds: string[],
): ChoiceQuestion {
  const options = optionLabels.map((label, i) => ({ id: `opt${i}`, label }));
  return {
    id: `q-${type}`,
    instanceId: 'm1s',
    strategyId: TEST_STRATEGY_ID,
    name: `${type} 題`,
    type,
    options,
    boss: { skillName: '技能', castTime: 8, facing: 0 },
    roleSolutions: makeRoleSolutions<ChoiceRoleSolution>({
      debuffs: [],
      correctOptionIds,
    }),
  };
}

describe('evaluateChoice - single-choice', () => {
  const q = makeChoiceQuestion('single-choice', ['A', 'B', 'C'], ['opt1']);
  const sol = q.roleSolutions.MT;

  it('選對 → true', () => {
    expect(evaluateChoice(q, sol, ['opt1'])).toBe(true);
  });
  it('選錯 → false', () => {
    expect(evaluateChoice(q, sol, ['opt0'])).toBe(false);
  });
  it('未選 → false', () => {
    expect(evaluateChoice(q, sol, [])).toBe(false);
  });
  it('選了多個 → false（單選不該有多選）', () => {
    expect(evaluateChoice(q, sol, ['opt0', 'opt1'])).toBe(false);
  });
});

describe('evaluateChoice - multi-choice', () => {
  const q = makeChoiceQuestion('multi-choice', ['A', 'B', 'C', 'D'], ['opt0', 'opt2']);
  const sol = q.roleSolutions.MT;

  it('完全相同集合 → true', () => {
    expect(evaluateChoice(q, sol, ['opt0', 'opt2'])).toBe(true);
  });
  it('順序不同但內容相同 → true（無序比對）', () => {
    expect(evaluateChoice(q, sol, ['opt2', 'opt0'])).toBe(true);
  });
  it('少選 → false', () => {
    expect(evaluateChoice(q, sol, ['opt0'])).toBe(false);
  });
  it('多選（選對的 + 多選一個錯的） → false', () => {
    expect(evaluateChoice(q, sol, ['opt0', 'opt2', 'opt3'])).toBe(false);
  });
  it('全錯 → false', () => {
    expect(evaluateChoice(q, sol, ['opt1', 'opt3'])).toBe(false);
  });
  it('未選 → false', () => {
    expect(evaluateChoice(q, sol, [])).toBe(false);
  });
  it('重複勾選同一 ID（防禦性） → false', () => {
    // selected.length=2 但 set.size=1，視為作答資料異常判錯
    expect(evaluateChoice(q, sol, ['opt0', 'opt0'])).toBe(false);
  });
});

describe('evaluateChoice - ordering', () => {
  const q = makeChoiceQuestion('ordering', ['A', 'B', 'C'], ['opt2', 'opt0', 'opt1']);
  const sol = q.roleSolutions.MT;

  it('順序完全相同 → true', () => {
    expect(evaluateChoice(q, sol, ['opt2', 'opt0', 'opt1'])).toBe(true);
  });
  it('內容相同但順序不同 → false（嚴格依序）', () => {
    expect(evaluateChoice(q, sol, ['opt0', 'opt2', 'opt1'])).toBe(false);
  });
  it('長度不符 → false', () => {
    expect(evaluateChoice(q, sol, ['opt2', 'opt0'])).toBe(false);
  });
});

// ========================================================================
// Store 行為：選擇/排序題的 actions 與 evaluateCurrentQuestion 整合
// ========================================================================

describe('setSelectedOptions + evaluate (single-choice)', () => {
  it('整合：選對的 → answers[0].isCorrect = true', () => {
    const store = useSessionStore();
    const q = makeChoiceQuestion('single-choice', ['A', 'B'], ['opt1']);
    store.startSession({ questions: [q], instanceId: 'm1s', strategyId: 's', roleId: 'MT' });
    store.setSelectedOptions(['opt1']);
    store.evaluateCurrentQuestion();
    expect(store.answers[0].isCorrect).toBe(true);
    // PlayerAnswer 應記錄玩家選的 ID
    const ans = store.answers[0].answer;
    if (ans.type !== 'map-click') {
      expect(ans.selectedOptionIds).toEqual(['opt1']);
    }
  });

  it('已結算後 setSelectedOptions 應被忽略', () => {
    const store = useSessionStore();
    const q = makeChoiceQuestion('single-choice', ['A', 'B'], ['opt1']);
    store.startSession({ questions: [q], instanceId: 'm1s', strategyId: 's', roleId: 'MT' });
    store.setSelectedOptions(['opt0']);
    store.evaluateCurrentQuestion();
    store.setSelectedOptions(['opt1']);
    // 仍是 opt0（不會被改）
    expect(store.currentSelectedOptionIds).toEqual(['opt0']);
  });
});

describe('moveOption (ordering)', () => {
  it('startSession 後預填 options 順序', () => {
    const store = useSessionStore();
    const q = makeChoiceQuestion('ordering', ['A', 'B', 'C'], ['opt2', 'opt1', 'opt0']);
    store.startSession({ questions: [q], instanceId: 'm1s', strategyId: 's', roleId: 'MT' });
    expect(store.currentSelectedOptionIds).toEqual(['opt0', 'opt1', 'opt2']);
  });

  it('上移：與前一個交換', () => {
    const store = useSessionStore();
    const q = makeChoiceQuestion('ordering', ['A', 'B', 'C'], ['opt0', 'opt1', 'opt2']);
    store.startSession({ questions: [q], instanceId: 'm1s', strategyId: 's', roleId: 'MT' });
    store.moveOption('opt1', 'up');
    expect(store.currentSelectedOptionIds).toEqual(['opt1', 'opt0', 'opt2']);
  });

  it('下移：與下一個交換', () => {
    const store = useSessionStore();
    const q = makeChoiceQuestion('ordering', ['A', 'B', 'C'], ['opt0', 'opt1', 'opt2']);
    store.startSession({ questions: [q], instanceId: 'm1s', strategyId: 's', roleId: 'MT' });
    store.moveOption('opt0', 'down');
    expect(store.currentSelectedOptionIds).toEqual(['opt1', 'opt0', 'opt2']);
  });

  it('已在最上仍 moveUp → no-op', () => {
    const store = useSessionStore();
    const q = makeChoiceQuestion('ordering', ['A', 'B'], ['opt0', 'opt1']);
    store.startSession({ questions: [q], instanceId: 'm1s', strategyId: 's', roleId: 'MT' });
    store.moveOption('opt0', 'up');
    expect(store.currentSelectedOptionIds).toEqual(['opt0', 'opt1']);
  });

  it('已在最下仍 moveDown → no-op', () => {
    const store = useSessionStore();
    const q = makeChoiceQuestion('ordering', ['A', 'B'], ['opt0', 'opt1']);
    store.startSession({ questions: [q], instanceId: 'm1s', strategyId: 's', roleId: 'MT' });
    store.moveOption('opt1', 'down');
    expect(store.currentSelectedOptionIds).toEqual(['opt0', 'opt1']);
  });

  it('整合：玩家排出正確順序後評估 → 對', () => {
    const store = useSessionStore();
    const q = makeChoiceQuestion('ordering', ['A', 'B', 'C'], ['opt2', 'opt0', 'opt1']);
    store.startSession({ questions: [q], instanceId: 'm1s', strategyId: 's', roleId: 'MT' });
    // 初始 [opt0, opt1, opt2] → 把 opt2 移到最上
    store.moveOption('opt2', 'up'); // [opt0, opt2, opt1]
    store.moveOption('opt2', 'up'); // [opt2, opt0, opt1]
    store.evaluateCurrentQuestion();
    expect(store.answers[0].isCorrect).toBe(true);
  });
});

describe('multi-choice 整合', () => {
  it('多選：勾選正確兩個 → 對', () => {
    const store = useSessionStore();
    const q = makeChoiceQuestion('multi-choice', ['A', 'B', 'C'], ['opt0', 'opt2']);
    store.startSession({ questions: [q], instanceId: 'm1s', strategyId: 's', roleId: 'MT' });
    store.setSelectedOptions(['opt0', 'opt2']);
    store.evaluateCurrentQuestion();
    expect(store.answers[0].isCorrect).toBe(true);
  });

  it('多選：少選一個 → 錯', () => {
    const store = useSessionStore();
    const q = makeChoiceQuestion('multi-choice', ['A', 'B', 'C'], ['opt0', 'opt2']);
    store.startSession({ questions: [q], instanceId: 'm1s', strategyId: 's', roleId: 'MT' });
    store.setSelectedOptions(['opt0']);
    store.evaluateCurrentQuestion();
    expect(store.answers[0].isCorrect).toBe(false);
  });
});

describe('題目切換時 currentSelectedOptionIds 重設', () => {
  it('切到下一題（map-click）時清空選項', () => {
    const store = useSessionStore();
    const q1 = makeChoiceQuestion('single-choice', ['A', 'B'], ['opt0']);
    const q2 = makeMapClickQuestion('q2', 1, [
      { shape: 'circle', center: { x: 0, y: 0 }, radius: 10 },
    ]);
    store.startSession({ questions: [q1, q2], instanceId: 'm1s', strategyId: 's', roleId: 'MT' });
    store.setSelectedOptions(['opt0']);
    store.evaluateCurrentQuestion();
    store.nextQuestion();
    expect(store.currentSelectedOptionIds).toEqual([]);
  });

  it('切到下一題（ordering）時預填新題的 options 順序', () => {
    const store = useSessionStore();
    const q1 = makeChoiceQuestion('single-choice', ['A'], ['opt0']);
    const q2 = makeChoiceQuestion('ordering', ['X', 'Y'], ['opt1', 'opt0']);
    store.startSession({ questions: [q1, q2], instanceId: 'm1s', strategyId: 's', roleId: 'MT' });
    store.evaluateCurrentQuestion();
    store.nextQuestion();
    expect(store.currentSelectedOptionIds).toEqual(['opt0', 'opt1']);
  });
});
