import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ChoiceQuestion,
  ChoiceRoleSolution,
  MapClickQuestion,
  MapClickRoleSolution,
  Question,
  RoleId,
} from '@ffxiv-sim/shared';
import ReviewView from '../ReviewView.vue';
import { useSessionStore } from '@/stores/session';
import { useSettingsStore } from '@/stores/settings';
import { createTestRouter } from './helpers';

/**
 * ========================================================================
 * ReviewView 測試
 * ========================================================================
 * 重點驗證（依需求文件）：
 *   1. 防呆：無作答紀錄 → redirect /setup
 *   2. 正確從 store 提取對應 index 的資料
 *   3. userClicks 與 safeAreas 正確傳給 <ArenaMap>
 *   4. 上/下一題導覽（含邊界 disabled）
 *
 * 【ArenaMap stub】
 *   ArenaMap 在 jsdom 內可掛載但 SVG 無實際渲染意義。為精準驗證 props 傳遞，
 *   我們用 defineComponent 替身攔截 props，避免測 ReviewView 時意外被
 *   ArenaMap 內部 bug 干擾，也便於斷言。
 * ========================================================================
 */

function makeRoleSolutions<T>(spec: T): Record<RoleId, T> {
  return { MT: spec, ST: spec, H1: spec, H2: spec, D1: spec, D2: spec, D3: spec, D4: spec };
}

const sampleSafeArea = { shape: 'circle' as const, center: { x: 100, y: 100 }, radius: 50 };

function makeQuestion(id: string, name: string): MapClickQuestion {
  return {
    id,
    instanceId: 'm1s',
    strategyId: 'game8',
    name,
    type: 'map-click',
    clickCount: 1,
    boss: { skillName: '範例技能', castTime: 8, facing: 90, position: { x: 500, y: 500 } },
    roleSolutions: makeRoleSolutions<MapClickRoleSolution>({
      debuffs: [],
      safeAreas: [sampleSafeArea],
      note: `題目 ${id} 的解析`,
    }),
  };
}

const mockArena = {
  shape: 'square' as const,
  backgroundImage: '',
  size: { width: 1000, height: 1000 },
  center: { x: 500, y: 500 },
};

/**
 * 建立 ArenaMap stub - 把所有 props 攤開到 data 屬性方便斷言。
 * Why 用 JSON.stringify：jsdom 對複雜物件 attribute 序列化能正確還原，
 *      測試時 parse 回 JS 物件比對最直觀。
 */
const ArenaMapStub = defineComponent({
  name: 'ArenaMap',
  props: ['mode', 'arena', 'waymarks', 'bossFacing', 'bossPosition', 'userClicks', 'safeAreas'],
  template: `
    <div
      data-testid="arena-map-stub"
      :data-mode="mode"
      :data-boss-facing="bossFacing"
      :data-user-clicks="JSON.stringify(userClicks)"
      :data-safe-areas="JSON.stringify(safeAreas)"
    />
  `,
});

/** 設定一個跑完的 session 與對應的 settings store */
function setupCompletedSession(
  outcomes: { name: string; clicks: { x: number; y: number }[] }[],
): void {
  const session = useSessionStore();
  const settings = useSettingsStore();

  // 模擬 settings 已完成 wizard
  settings.dataset = {
    schemaVersion: '1.0',
    instance: {
      id: 'm1s',
      name: 'M1S',
      shortName: 'M1S',
      arena: mockArena,
    },
    strategies: [
      { id: 'game8', instanceId: 'm1s', name: 'Game8', waymarks: { A: { x: 100, y: 100 } } },
    ],
    questions: [],
    debuffLibrary: [],
  };
  settings.selectedInstanceId = 'm1s';
  settings.selectedStrategyId = 'game8';
  settings.selectedRoleId = 'MT';

  const questions = outcomes.map((o, i) => makeQuestion(`q${i}`, o.name));
  session.startSession({
    questions,
    instanceId: 'm1s',
    strategyId: 'game8',
    roleId: 'MT',
  });

  for (const o of outcomes) {
    for (const c of o.clicks) {
      session.recordClick(c);
    }
    session.evaluateCurrentQuestion();
    session.nextQuestion();
  }
}

beforeEach(() => {
  setActivePinia(createPinia());
});

function mountReview(index: string, router = createTestRouter()) {
  return mount(ReviewView, {
    props: { index },
    global: {
      plugins: [router],
      stubs: { ArenaMap: ArenaMapStub },
    },
  });
}

describe('ReviewView - 防呆', () => {
  it('無作答紀錄 → redirect /setup', async () => {
    const router = createTestRouter();
    await router.push('/review/0');
    const replaceSpy = vi.spyOn(router, 'replace');

    mountReview('0', router);
    await flushPromises();

    expect(replaceSpy).toHaveBeenCalledWith('/setup');
  });

  it('index 越界 → 顯示載入中（不渲染主內容）', async () => {
    setupCompletedSession([{ name: 'A', clicks: [{ x: 100, y: 100 }] }]);
    const wrapper = mountReview('999');
    expect(wrapper.find('[data-testid="arena-map-stub"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('載入中');
  });

  it('index 為非數字字串 → 不渲染主內容', async () => {
    setupCompletedSession([{ name: 'A', clicks: [{ x: 100, y: 100 }] }]);
    const wrapper = mountReview('abc');
    expect(wrapper.find('[data-testid="arena-map-stub"]').exists()).toBe(false);
  });
});

describe('ReviewView - 資料提取與 ArenaMap props', () => {
  beforeEach(() => {
    // 第 0 題玩家點 (100, 100)（命中安全區），第 1 題點 (999, 999)（沒命中）
    setupCompletedSession([
      { name: '第 0 題', clicks: [{ x: 100, y: 100 }] },
      { name: '第 1 題', clicks: [{ x: 999, y: 999 }] },
    ]);
  });

  it('正確從 store 提取對應 index 的題目', () => {
    const wrapper = mountReview('1');
    expect(wrapper.text()).toContain('第 1 題');
    expect(wrapper.text()).toContain('範例技能');
  });

  it('userClicks 正確傳給 ArenaMap（從 AnswerRecord 萃取座標）', () => {
    const wrapper = mountReview('1');
    const stub = wrapper.find('[data-testid="arena-map-stub"]');
    const clicks = JSON.parse(stub.attributes('data-user-clicks') ?? '[]');
    expect(clicks).toEqual([{ x: 999, y: 999 }]);
  });

  it('safeAreas 正確傳給 ArenaMap（從該職能的 RoleSolution 取）', () => {
    const wrapper = mountReview('0');
    const stub = wrapper.find('[data-testid="arena-map-stub"]');
    const areas = JSON.parse(stub.attributes('data-safe-areas') ?? '[]');
    expect(areas).toHaveLength(1);
    expect(areas[0]).toMatchObject({ shape: 'circle', radius: 50 });
  });

  it('ArenaMap 模式為 review', () => {
    const wrapper = mountReview('0');
    expect(wrapper.find('[data-testid="arena-map-stub"]').attributes('data-mode')).toBe('review');
  });

  it('bossFacing 從題目傳入', () => {
    const wrapper = mountReview('0');
    expect(wrapper.find('[data-testid="arena-map-stub"]').attributes('data-boss-facing')).toBe('90');
  });

  it('解析文字（note）顯示在 explanation 區塊', () => {
    const wrapper = mountReview('0');
    expect(wrapper.find('[data-testid="explanation"]').text()).toContain('題目 q0 的解析');
  });

  it('對錯標記正確顯示', () => {
    // 第 0 題對；第 1 題錯
    const w0 = mountReview('0');
    expect(w0.find('[data-testid="result-badge"]').text()).toContain('正確');
    const w1 = mountReview('1');
    expect(w1.find('[data-testid="result-badge"]').text()).toContain('失誤');
  });
});

describe('ReviewView - 上/下一題導覽', () => {
  beforeEach(() => {
    setupCompletedSession([
      { name: 'A', clicks: [{ x: 100, y: 100 }] },
      { name: 'B', clicks: [{ x: 100, y: 100 }] },
      { name: 'C', clicks: [{ x: 100, y: 100 }] },
    ]);
  });

  it('第一題：上一題按鈕 disabled', () => {
    const wrapper = mountReview('0');
    expect(wrapper.find('[data-testid="prev-button"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="next-button"]').attributes('disabled')).toBeUndefined();
  });

  it('最後一題：下一題按鈕 disabled', () => {
    const wrapper = mountReview('2');
    expect(wrapper.find('[data-testid="prev-button"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.find('[data-testid="next-button"]').attributes('disabled')).toBeDefined();
  });

  it('中間題：兩個按鈕都可用，點擊後 push 對應路由', async () => {
    const router = createTestRouter();
    await router.push('/review/1');
    const pushSpy = vi.spyOn(router, 'push');
    const wrapper = mountReview('1', router);

    await wrapper.find('[data-testid="prev-button"]').trigger('click');
    expect(pushSpy).toHaveBeenCalledWith('/review/0');

    await wrapper.find('[data-testid="next-button"]').trigger('click');
    expect(pushSpy).toHaveBeenCalledWith('/review/2');
  });

  it('回到結算按鈕 → push /result', async () => {
    const router = createTestRouter();
    await router.push('/review/0');
    const pushSpy = vi.spyOn(router, 'push');
    const wrapper = mountReview('0', router);

    await wrapper.find('[data-testid="back-results-button"]').trigger('click');
    expect(pushSpy).toHaveBeenCalledWith('/result');
  });
});

// ========================================================================
// 非地圖題（選擇/排序）的渲染測試
// ========================================================================

/**
 * 建立 ChoiceQuestion 測試資料 - 與 ReviewView 用的型別一致。
 */
function makeChoiceQuestion(
  id: string,
  type: 'single-choice' | 'multi-choice' | 'ordering',
  optionLabels: string[],
  correctOptionIds: string[],
  note?: string,
): ChoiceQuestion {
  const options = optionLabels.map((label, i) => ({ id: `opt${i}`, label }));
  return {
    id,
    instanceId: 'm1s',
    strategyId: 'game8',
    name: `${type} ${id}`,
    type,
    options,
    boss: { skillName: '範例技能', castTime: 8, facing: 0 },
    roleSolutions: makeRoleSolutions<ChoiceRoleSolution>({
      debuffs: [],
      correctOptionIds,
      ...(note ? { note } : {}),
    }),
  };
}

/**
 * 設定 choice 題完整 session - 玩家可控制最終答案 ID 陣列。
 * 與 setupCompletedSession（map-click 版）等價但走 setSelectedOptions / moveOption 路徑。
 */
function setupChoiceSession(items: { question: ChoiceQuestion; playerIds: string[] }[]): void {
  const session = useSessionStore();
  const settings = useSettingsStore();
  settings.dataset = {
    schemaVersion: '1.0',
    instance: { id: 'm1s', name: 'M1S', shortName: 'M1S', arena: mockArena },
    strategies: [{ id: 'game8', instanceId: 'm1s', name: 'Game8', waymarks: {} }],
    questions: [],
    debuffLibrary: [],
  };
  settings.selectedInstanceId = 'm1s';
  settings.selectedStrategyId = 'game8';
  settings.selectedRoleId = 'MT';

  const questions: Question[] = items.map((i) => i.question);
  session.startSession({ questions, instanceId: 'm1s', strategyId: 'game8', roleId: 'MT' });

  for (const item of items) {
    if (item.question.type === 'ordering') {
      // 強制玩家從預填順序走到指定順序：用 setSelectedOptions 簡化（測試專用）
      // 注意：generic store 不允許這條路徑，但測試直接動 store state 不繞 action
      session.currentSelectedOptionIds = [...item.playerIds];
    } else {
      session.setSelectedOptions(item.playerIds);
    }
    session.evaluateCurrentQuestion();
    session.nextQuestion();
  }
}

describe('ReviewView - 選擇題回顧', () => {
  it('single-choice 答對：顯示文字對照而非 ArenaMap', () => {
    setupChoiceSession([
      {
        question: makeChoiceQuestion('q', 'single-choice', ['A', 'B', 'C'], ['opt1'], '解析 X'),
        playerIds: ['opt1'],
      },
    ]);
    const wrapper = mountReview('0');
    // 不渲染地圖
    expect(wrapper.find('[data-testid="visual-diff-map"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="arena-map-stub"]').exists()).toBe(false);
    // 渲染文字對照
    expect(wrapper.find('[data-testid="visual-diff-choice"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="choice-review-panel"]').exists()).toBe(true);
    // 答對的視覺標記
    expect(wrapper.findAll('[data-testid="player-right-item"]')).toHaveLength(1);
    expect(wrapper.findAll('[data-testid="player-wrong-item"]')).toHaveLength(0);
    // note 仍顯示
    expect(wrapper.find('[data-testid="explanation"]').text()).toContain('解析 X');
  });

  it('single-choice 答錯：玩家選的選項標紅', () => {
    setupChoiceSession([
      {
        question: makeChoiceQuestion('q', 'single-choice', ['A', 'B'], ['opt1']),
        playerIds: ['opt0'], // 選錯
      },
    ]);
    const wrapper = mountReview('0');
    expect(wrapper.findAll('[data-testid="player-wrong-item"]')).toHaveLength(1);
    expect(wrapper.findAll('[data-testid="player-right-item"]')).toHaveLength(0);
    // header 對錯標籤
    expect(wrapper.find('[data-testid="result-badge"]').text()).toContain('失誤');
  });

  it('multi-choice 部分對部分錯：對的綠、錯的紅、漏選提示', () => {
    setupChoiceSession([
      {
        question: makeChoiceQuestion('q', 'multi-choice', ['A', 'B', 'C', 'D'], ['opt0', 'opt2']),
        playerIds: ['opt0', 'opt3'], // opt0 對、opt3 錯、漏選 opt2
      },
    ]);
    const wrapper = mountReview('0');
    expect(wrapper.findAll('[data-testid="player-right-item"]')).toHaveLength(1);
    expect(wrapper.findAll('[data-testid="player-wrong-item"]')).toHaveLength(1);
    // 漏選 opt2（label = 'C'）
    expect(wrapper.find('[data-testid="missed-hint"]').text()).toContain('C');
  });

  it('ordering 部分位置錯：錯位的標紅', () => {
    setupChoiceSession([
      {
        question: makeChoiceQuestion('q', 'ordering', ['A', 'B', 'C'], ['opt2', 'opt0', 'opt1']),
        playerIds: ['opt0', 'opt2', 'opt1'], // index 0 錯（應 opt2 卻是 opt0）、index 1 錯（應 opt0 卻是 opt2）、index 2 對
      },
    ]);
    const wrapper = mountReview('0');
    expect(wrapper.findAll('[data-testid="player-wrong-item"]')).toHaveLength(2);
    expect(wrapper.findAll('[data-testid="player-right-item"]')).toHaveLength(1);
  });

  it('未作答（空陣列）：顯示「未作答」提示', () => {
    setupChoiceSession([
      {
        question: makeChoiceQuestion('q', 'single-choice', ['A', 'B'], ['opt0']),
        playerIds: [], // 完全未選
      },
    ]);
    const wrapper = mountReview('0');
    expect(wrapper.find('[data-testid="player-empty"]').exists()).toBe(true);
  });

  it('正解清單永遠完整顯示（不論玩家對錯）', () => {
    setupChoiceSession([
      {
        question: makeChoiceQuestion('q', 'multi-choice', ['A', 'B', 'C'], ['opt0', 'opt1']),
        playerIds: ['opt2'], // 全錯
      },
    ]);
    const wrapper = mountReview('0');
    const correctList = wrapper.find('[data-testid="correct-list"]');
    expect(correctList.exists()).toBe(true);
    // 正解 2 項
    expect(correctList.findAll('li')).toHaveLength(2);
  });
});
