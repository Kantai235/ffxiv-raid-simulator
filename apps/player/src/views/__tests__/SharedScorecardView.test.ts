import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SharedScorecardView from '../SharedScorecardView.vue';
import { encodeScorecard } from '@/utils/share';
import { createTestRouter } from './helpers';

/**
 * SharedScorecardView 測試 - 重點：
 *   1. 合法 data → 渲染成績卡片
 *   2. 無 data → redirect /setup
 *   3. 損毀 data → redirect /setup（靜默）
 *   4. 版本不相容 → 顯示錯誤訊息不 redirect
 *   5. CTA 按鈕 → push /setup
 */

function makeEncodedResult(overrides: {
  correctCount?: number;
  totalCount?: number;
  finishedAt?: number;
  roleId?: 'MT' | 'H1' | 'D3';
  instanceName?: string;
  strategyName?: string;
} = {}): string {
  return encodeScorecard(
    {
      roleId: overrides.roleId ?? 'MT',
      correctCount: overrides.correctCount ?? 8,
      totalCount: overrides.totalCount ?? 10,
      finishedAt: overrides.finishedAt ?? 1700000000000,
    },
    overrides.instanceName ?? '阿卡迪亞零式輕量級 M1S',
    overrides.strategyName ?? 'Game8 攻略',
  );
}

beforeEach(() => {
  setActivePinia(createPinia());
});

async function mountWithData(data: string | null): Promise<ReturnType<typeof mount>> {
  const router = createTestRouter();
  const path = data !== null ? `/scorecard?data=${data}` : '/scorecard';
  await router.push(path);
  return mount(SharedScorecardView, { global: { plugins: [router] } });
}

describe('SharedScorecardView - 合法 data', () => {
  it('渲染成績卡片與分享者資訊', async () => {
    const encoded = makeEncodedResult();
    const wrapper = await mountWithData(encoded);
    await flushPromises();

    expect(wrapper.find('[data-testid="shared-scorecard-board"]').exists()).toBe(true);
    const text = wrapper.text();
    expect(text).toContain('阿卡迪亞零式輕量級 M1S');
    expect(text).toContain('Game8 攻略');
    expect(text).toContain('80%'); // 8/10
    expect(text).toContain('8');
    expect(text).toContain('10');
  });

  it('百分比評價為 complete（80%）', async () => {
    const encoded = makeEncodedResult({ correctCount: 8, totalCount: 10 });
    const wrapper = await mountWithData(encoded);
    await flushPromises();
    expect(wrapper.find('[data-testid="rating-label"]').text()).toContain('Duty Complete');
  });

  it('百分比評價為 perfect（100%）', async () => {
    const encoded = makeEncodedResult({ correctCount: 5, totalCount: 5 });
    const wrapper = await mountWithData(encoded);
    await flushPromises();
    expect(wrapper.find('[data-testid="rating-label"]').text()).toContain('Perfect');
  });

  it('百分比評價為 wipe（<80%）', async () => {
    const encoded = makeEncodedResult({ correctCount: 1, totalCount: 10 });
    const wrapper = await mountWithData(encoded);
    await flushPromises();
    expect(wrapper.find('[data-testid="rating-label"]').text()).toContain('Wipe');
  });

  it('中文副本/攻略名稱顯示正確（無亂碼）', async () => {
    const encoded = makeEncodedResult({
      instanceName: '絕奧米茄狂詩曲',
      strategyName: '蘇帕醬流派 - P5 戰術',
    });
    const wrapper = await mountWithData(encoded);
    await flushPromises();
    expect(wrapper.text()).toContain('絕奧米茄狂詩曲');
    expect(wrapper.text()).toContain('蘇帕醬流派 - P5 戰術');
  });

  it('CTA 按鈕 → push /setup', async () => {
    const encoded = makeEncodedResult();
    const router = createTestRouter();
    await router.push(`/scorecard?data=${encoded}`);
    const pushSpy = vi.spyOn(router, 'push');
    const wrapper = mount(SharedScorecardView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.find('[data-testid="try-it-button"]').trigger('click');
    expect(pushSpy).toHaveBeenCalledWith('/setup');
  });
});

describe('SharedScorecardView - 錯誤情境', () => {
  it('無 data query → redirect /setup', async () => {
    const router = createTestRouter();
    await router.push('/scorecard');
    const replaceSpy = vi.spyOn(router, 'replace');
    mount(SharedScorecardView, { global: { plugins: [router] } });
    await flushPromises();

    expect(replaceSpy).toHaveBeenCalledWith('/setup');
  });

  it('data 為亂碼 → redirect /setup（不顯示錯誤）', async () => {
    const router = createTestRouter();
    await router.push('/scorecard?data=!!!not-valid!!!');
    const replaceSpy = vi.spyOn(router, 'replace');
    const wrapper = mount(SharedScorecardView, { global: { plugins: [router] } });
    await flushPromises();

    expect(replaceSpy).toHaveBeenCalledWith('/setup');
    // 不應顯示錯誤區塊（避免引導 debug）
    expect(wrapper.find('[data-testid="scorecard-error"]').exists()).toBe(false);
  });

  it('版本過新 → 顯示錯誤訊息 + 不 redirect', async () => {
    // 手動產生 v=999 的 payload
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        v: 999,
        i: 'x',
        s: 'y',
        r: 'MT',
        c: 1,
        t: 1,
        d: 0,
      }),
    );
    const bin = String.fromCharCode(...bytes);
    const encoded = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const router = createTestRouter();
    await router.push(`/scorecard?data=${encoded}`);
    const replaceSpy = vi.spyOn(router, 'replace');
    const wrapper = mount(SharedScorecardView, { global: { plugins: [router] } });
    await flushPromises();

    expect(replaceSpy).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="scorecard-error"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('999');
  });
});
