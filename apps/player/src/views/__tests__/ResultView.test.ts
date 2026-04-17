import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapClickQuestion, MapClickRoleSolution, RoleId } from '@ffxiv-sim/shared';
import ResultView from '../ResultView.vue';
import { useSessionStore } from '@/stores/session';
import { useSettingsStore } from '@/stores/settings';
import { createTestRouter } from './helpers';

/**
 * ========================================================================
 * ResultView 測試
 * ========================================================================
 * 重點驗證：
 *   1. 防呆：無作答紀錄 → redirect /setup
 *   2. 評價分類正確顯示（perfect / complete / wipe）
 *   3. 逐題清單渲染（題數、對錯標籤）
 *   4. 點擊題目列 → push /review/:index
 *   5. Retry 按鈕 → restartSession + push /practice
 * ========================================================================
 */

function makeRoleSolutions<T>(spec: T): Record<RoleId, T> {
  return { MT: spec, ST: spec, H1: spec, H2: spec, D1: spec, D2: spec, D3: spec, D4: spec };
}

function makeMapClickQuestion(id: string, name: string): MapClickQuestion {
  return {
    id,
    instanceId: 'm1s',
    strategyId: 's',
    name,
    type: 'map-click',
    clickCount: 1,
    boss: { skillName: 's', castTime: 8, facing: 0 },
    roleSolutions: makeRoleSolutions<MapClickRoleSolution>({
      debuffs: [],
      safeAreas: [{ shape: 'circle', center: { x: 0, y: 0 }, radius: 10 }],
    }),
  };
}

/**
 * 建立一個跑完的 session 狀態 - 指定每題對錯。
 */
function setupCompletedSession(
  outcomes: { name: string; correct: boolean }[],
): void {
  const session = useSessionStore();
  const questions = outcomes.map((o, i) => makeMapClickQuestion(`q${i}`, o.name));
  session.startSession({
    questions,
    instanceId: 'm1s',
    strategyId: 's',
    roleId: 'MT',
  });
  for (const o of outcomes) {
    if (o.correct) session.recordClick({ x: 0, y: 0 });
    session.evaluateCurrentQuestion();
    session.nextQuestion();
  }
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('ResultView - 防呆', () => {
  it('無作答紀錄 → redirect /setup', async () => {
    const router = createTestRouter();
    await router.push('/result');
    const replaceSpy = vi.spyOn(router, 'replace');

    mount(ResultView, { global: { plugins: [router] } });
    await flushPromises();

    expect(replaceSpy).toHaveBeenCalledWith('/setup');
  });
});

describe('ResultView - 評價分類', () => {
  it('全對 (3/3) → perfect 標籤', async () => {
    setupCompletedSession([
      { name: 'A', correct: true },
      { name: 'B', correct: true },
      { name: 'C', correct: true },
    ]);
    const router = createTestRouter();
    await router.push('/result');
    const wrapper = mount(ResultView, { global: { plugins: [router] } });

    expect(wrapper.find('[data-testid="rating-label"]').text()).toContain('Perfect');
  });

  it('80% (4/5) → complete 標籤', async () => {
    setupCompletedSession([
      { name: 'A', correct: true },
      { name: 'B', correct: true },
      { name: 'C', correct: true },
      { name: 'D', correct: true },
      { name: 'E', correct: false },
    ]);
    const router = createTestRouter();
    await router.push('/result');
    const wrapper = mount(ResultView, { global: { plugins: [router] } });

    expect(wrapper.find('[data-testid="rating-label"]').text()).toContain('Duty Complete');
  });

  it('低於 80% → wipe 標籤', async () => {
    setupCompletedSession([
      { name: 'A', correct: true },
      { name: 'B', correct: false },
      { name: 'C', correct: false },
    ]);
    const router = createTestRouter();
    await router.push('/result');
    const wrapper = mount(ResultView, { global: { plugins: [router] } });

    expect(wrapper.find('[data-testid="rating-label"]').text()).toContain('Wipe');
  });
});

describe('ResultView - 逐題清單', () => {
  it('渲染所有題目 + 對錯標記', async () => {
    setupCompletedSession([
      { name: '題一', correct: true },
      { name: '題二', correct: false },
    ]);
    const router = createTestRouter();
    await router.push('/result');
    const wrapper = mount(ResultView, { global: { plugins: [router] } });

    const rows = wrapper.findAll('[data-question-row]');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain('題一');
    expect(rows[1].text()).toContain('題二');
    expect(wrapper.findAll('[data-testid="mark-correct"]')).toHaveLength(1);
    expect(wrapper.findAll('[data-testid="mark-wrong"]')).toHaveLength(1);
  });

  it('點擊題目列 → push /review/:index', async () => {
    setupCompletedSession([
      { name: 'A', correct: true },
      { name: 'B', correct: true },
    ]);
    const router = createTestRouter();
    await router.push('/result');
    const pushSpy = vi.spyOn(router, 'push');

    const wrapper = mount(ResultView, { global: { plugins: [router] } });
    await wrapper.find('[data-question-row="1"]').trigger('click');

    expect(pushSpy).toHaveBeenCalledWith('/review/1');
  });
});

describe('ResultView - Actions', () => {
  it('Retry → restartSession + push /practice', async () => {
    setupCompletedSession([
      { name: 'A', correct: false },
      { name: 'B', correct: false },
    ]);
    const session = useSessionStore();
    const restartSpy = vi.spyOn(session, 'restartSession');
    const router = createTestRouter();
    await router.push('/result');
    const pushSpy = vi.spyOn(router, 'push');

    const wrapper = mount(ResultView, { global: { plugins: [router] } });
    await wrapper.find('[data-testid="retry-button"]').trigger('click');

    expect(restartSpy).toHaveBeenCalled();
    expect(pushSpy).toHaveBeenCalledWith('/practice');
  });

  it('Back to Setup → reset + push /setup', async () => {
    setupCompletedSession([{ name: 'A', correct: true }]);
    const session = useSessionStore();
    const resetSpy = vi.spyOn(session, 'reset');
    const router = createTestRouter();
    await router.push('/result');
    const pushSpy = vi.spyOn(router, 'push');

    const wrapper = mount(ResultView, { global: { plugins: [router] } });
    await wrapper.find('[data-testid="back-setup-button"]').trigger('click');

    expect(resetSpy).toHaveBeenCalled();
    expect(pushSpy).toHaveBeenCalledWith('/setup');
  });
});

// ========================================================================
// 分享成績單
// ========================================================================

describe('ResultView - 分享成績單', () => {
  /**
   * 設定 settings store 讓 ResultView 能取到副本/攻略顯示名稱。
   * 測試直接寫 store state，繞過 fetch 流程。
   */
  function setupSettingsForShare(): void {
    const settings = useSettingsStore();
    settings.index = {
      schemaVersion: '1.0',
      instances: [
        {
          id: 'm1s',
          name: '阿卡迪亞零式輕量級 M1S',
          shortName: 'M1S',
          dataPath: 'x',
          schemaVersion: '1.0',
        },
      ],
    };
    settings.dataset = {
      schemaVersion: '1.0',
      instance: {
        id: 'm1s',
        name: '阿卡迪亞零式輕量級 M1S',
        shortName: 'M1S',
        arena: {
          shape: 'square',
          backgroundImage: '',
          size: { width: 1000, height: 1000 },
          center: { x: 500, y: 500 },
        },
      },
      strategies: [{ id: 'game8', instanceId: 'm1s', name: 'Game8 攻略', waymarks: {} }],
      questions: [],
      debuffLibrary: [],
    };
    settings.selectedInstanceId = 'm1s';
    settings.selectedStrategyId = 'game8';
  }

  beforeEach(() => {
    // 預設 mock navigator.clipboard 為成功
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
      writable: true,
    });
  });

  it('顯示分享按鈕', async () => {
    setupCompletedSession([{ name: 'A', correct: true }]);
    setupSettingsForShare();
    const router = createTestRouter();
    await router.push('/result');
    const wrapper = mount(ResultView, { global: { plugins: [router] } });

    expect(wrapper.find('[data-testid="share-button"]').exists()).toBe(true);
  });

  it('點擊 → 呼叫 clipboard.writeText 並顯示「已複製」toast', async () => {
    setupCompletedSession([{ name: 'A', correct: true }]);
    setupSettingsForShare();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });

    const router = createTestRouter();
    await router.push('/result');
    const wrapper = mount(ResultView, { global: { plugins: [router] } });

    await wrapper.find('[data-testid="share-button"]').trigger('click');
    await flushPromises();

    expect(writeText).toHaveBeenCalledTimes(1);
    const url = writeText.mock.calls[0][0] as string;
    expect(url).toContain('#/scorecard?data=');

    // 「已複製」toast 顯示
    expect(wrapper.find('[data-testid="copy-toast-copied"]').exists()).toBe(true);
  });

  it('Clipboard API 不可用 → 使用 execCommand fallback', async () => {
    setupCompletedSession([{ name: 'A', correct: true }]);
    setupSettingsForShare();
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    // jsdom 沒有內建 document.execCommand，用 defineProperty 直接掛上 mock
    const execMock = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', {
      value: execMock,
      configurable: true,
      writable: true,
    });

    const router = createTestRouter();
    await router.push('/result');
    const wrapper = mount(ResultView, { global: { plugins: [router] } });

    await wrapper.find('[data-testid="share-button"]').trigger('click');
    await flushPromises();

    expect(execMock).toHaveBeenCalledWith('copy');
    expect(wrapper.find('[data-testid="copy-toast-copied"]').exists()).toBe(true);
  });

  it('兩層 fallback 都失敗 → 顯示「複製失敗」並提供手動複製 input', async () => {
    setupCompletedSession([{ name: 'A', correct: true }]);
    setupSettingsForShare();
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn().mockReturnValue(false),
      configurable: true,
      writable: true,
    });

    const router = createTestRouter();
    await router.push('/result');
    const wrapper = mount(ResultView, { global: { plugins: [router] } });

    await wrapper.find('[data-testid="share-button"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="copy-toast-failed"]').exists()).toBe(true);
    const fallback = wrapper.find('[data-testid="manual-copy-fallback"]');
    expect(fallback.exists()).toBe(true);
    // input 內應該有完整 share URL 讓使用者手動 Ctrl+C
    const input = fallback.find('input').element as HTMLInputElement;
    expect(input.value).toContain('#/scorecard?data=');
  });
});
