import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Arena, SafeArea } from '@ffxiv-sim/shared';
import ArenaMap from '../ArenaMap.vue';

/**
 * ========================================================================
 * <ArenaMap /> 元件測試
 * ========================================================================
 * 測試重點（依需求文件）：
 *   1. 不同 mode 下的圖層顯示差異（safeAreas 不應在 interactive 顯示）
 *   2. 點擊事件的座標轉換（DOM 像素 → 邏輯座標）
 *   3. Waymark / 王面嚮 / 玩家點擊等圖層基本渲染
 *
 * 【jsdom 環境注意事項】
 *   jsdom 不會真正排版，getBoundingClientRect 預設回傳 0×0。
 *   為測試座標轉換，我們在掛載後 stub svg 的 getBoundingClientRect 回傳已知數值。
 * ========================================================================
 */

const mockArena: Arena = {
  shape: 'square',
  backgroundImage: '',
  size: { width: 1000, height: 1000 },
  center: { x: 500, y: 500 },
};

/**
 * 替 mount 的 svg 元素 stub getBoundingClientRect。
 *
 * 預設模擬 SVG 在畫面上佔 500×500 像素、左上角位於 (100, 50)。
 * 即「邏輯 1000 像素 = DOM 500 像素」→ 比例 = 2。
 */
function stubSvgRect(
  wrapper: ReturnType<typeof mount>,
  rect = { left: 100, top: 50, width: 500, height: 500 },
): void {
  const svg = wrapper.find('[data-testid="arena-map"]').element as SVGSVGElement;
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  } as DOMRect);
}

describe('ArenaMap - 模式差異', () => {
  const safeAreas: SafeArea[] = [
    { shape: 'circle', center: { x: 500, y: 500 }, radius: 100 },
  ];

  it('readonly 模式：不應渲染安全區，cursor 不應為 crosshair', () => {
    const wrapper = mount(ArenaMap, {
      props: { mode: 'readonly', arena: mockArena, safeAreas },
    });
    expect(wrapper.find('[data-layer="safe-areas"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="arena-map"]').classes()).not.toContain('cursor-crosshair');
  });

  it('interactive 模式：即使傳入 safeAreas 也不應渲染（避免洩漏答案）', () => {
    const wrapper = mount(ArenaMap, {
      props: { mode: 'interactive', arena: mockArena, safeAreas },
    });
    expect(wrapper.find('[data-layer="safe-areas"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="arena-map"]').classes()).toContain('cursor-crosshair');
  });

  it('review 模式：應渲染安全區', () => {
    const wrapper = mount(ArenaMap, {
      props: { mode: 'review', arena: mockArena, safeAreas },
    });
    const layer = wrapper.find('[data-layer="safe-areas"]');
    expect(layer.exists()).toBe(true);
    expect(layer.findAll('[data-safe-area-shape="circle"]')).toHaveLength(1);
  });

  it('review 模式：能同時渲染圓 / 矩形 / 多邊形三種安全區', () => {
    const mixed: SafeArea[] = [
      { shape: 'circle', center: { x: 100, y: 100 }, radius: 50 },
      { shape: 'rect', x: 200, y: 200, width: 100, height: 100 },
      {
        shape: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 25, y: 50 },
        ],
      },
    ];
    const wrapper = mount(ArenaMap, {
      props: { mode: 'review', arena: mockArena, safeAreas: mixed },
    });
    const layer = wrapper.find('[data-layer="safe-areas"]');
    expect(layer.find('[data-safe-area-shape="circle"]').exists()).toBe(true);
    expect(layer.find('[data-safe-area-shape="rect"]').exists()).toBe(true);
    expect(layer.find('[data-safe-area-shape="polygon"]').exists()).toBe(true);
  });
});

describe('ArenaMap - 點擊座標轉換', () => {
  let wrapper: ReturnType<typeof mount>;

  beforeEach(() => {
    wrapper = mount(ArenaMap, {
      props: { mode: 'interactive', arena: mockArena },
      attachTo: document.body,
    });
    stubSvgRect(wrapper);
  });

  it('interactive 模式：點擊應 emit 出邏輯座標', async () => {
    /**
     * 模擬點擊位置：DOM 客戶端座標 (350, 300)
     *   - svg 在 (left=100, top=50)，寬高 500×500
     *   - 點擊相對 svg：(350-100, 300-50) = (250, 250) 像素
     *   - 比例 = 1000/500 = 2
     *   - 預期邏輯座標：(500, 500) — 即場地正中心
     */
    const svg = wrapper.find('[data-testid="arena-map"]');
    await svg.trigger('click', { clientX: 350, clientY: 300 });

    const events = wrapper.emitted('click');
    expect(events).toHaveLength(1);
    const point = events![0][0] as { x: number; y: number };
    expect(point.x).toBeCloseTo(500);
    expect(point.y).toBeCloseTo(500);
  });

  it('點擊 DOM 左上角應對應邏輯原點 (0, 0)', async () => {
    const svg = wrapper.find('[data-testid="arena-map"]');
    await svg.trigger('click', { clientX: 100, clientY: 50 });
    const point = wrapper.emitted('click')![0][0] as { x: number; y: number };
    expect(point.x).toBeCloseTo(0);
    expect(point.y).toBeCloseTo(0);
  });

  it('點擊 DOM 右下角應對應邏輯尺寸 (1000, 1000)', async () => {
    const svg = wrapper.find('[data-testid="arena-map"]');
    await svg.trigger('click', { clientX: 600, clientY: 550 });
    const point = wrapper.emitted('click')![0][0] as { x: number; y: number };
    expect(point.x).toBeCloseTo(1000);
    expect(point.y).toBeCloseTo(1000);
  });

  it('readonly 模式：點擊不應 emit', async () => {
    const w = mount(ArenaMap, {
      props: { mode: 'readonly', arena: mockArena },
    });
    stubSvgRect(w);
    await w.find('[data-testid="arena-map"]').trigger('click', { clientX: 200, clientY: 200 });
    expect(w.emitted('click')).toBeUndefined();
  });

  it('review 模式：點擊不應 emit', async () => {
    const w = mount(ArenaMap, {
      props: { mode: 'review', arena: mockArena },
    });
    stubSvgRect(w);
    await w.find('[data-testid="arena-map"]').trigger('click', { clientX: 200, clientY: 200 });
    expect(w.emitted('click')).toBeUndefined();
  });
});

describe('ArenaMap - Waymark 渲染', () => {
  it('未提供 waymarks 時不渲染任何標記', () => {
    const wrapper = mount(ArenaMap, { props: { arena: mockArena } });
    const layer = wrapper.find('[data-layer="waymarks"]');
    expect(layer.findAll('[data-waymark]')).toHaveLength(0);
  });

  it('提供部分 waymarks 時只渲染有座標者', () => {
    const wrapper = mount(ArenaMap, {
      props: {
        arena: mockArena,
        waymarks: {
          A: { x: 100, y: 100 },
          '1': { x: 500, y: 500 },
          // B/C/D/2/3/4 未提供
        },
      },
    });
    const layer = wrapper.find('[data-layer="waymarks"]');
    expect(layer.find('[data-waymark="A"]').exists()).toBe(true);
    expect(layer.find('[data-waymark="1"]').exists()).toBe(true);
    expect(layer.find('[data-waymark="B"]').exists()).toBe(false);
    expect(layer.find('[data-waymark="2"]').exists()).toBe(false);
  });
});

describe('ArenaMap - 王面嚮指示器', () => {
  it('未提供 bossFacing 時不渲染指示器', () => {
    const wrapper = mount(ArenaMap, { props: { arena: mockArena } });
    expect(wrapper.find('[data-layer="boss"]').exists()).toBe(false);
  });

  it('bossFacing = 0（正北）為合法值，必須渲染', () => {
    // 防呆：bossFacing === 0 不能被 truthy 判斷誤吃掉
    const wrapper = mount(ArenaMap, {
      props: { arena: mockArena, bossFacing: 0 },
    });
    expect(wrapper.find('[data-layer="boss"]').exists()).toBe(true);
  });

  it('bossFacing = 90 時，旋轉 transform 應為 rotate(90 ...)', () => {
    const wrapper = mount(ArenaMap, {
      props: { arena: mockArena, bossFacing: 90 },
    });
    const facingGroup = wrapper.find('[data-testid="boss-facing"]');
    expect(facingGroup.exists()).toBe(true);
    const transform = facingGroup.attributes('transform');
    expect(transform).toMatch(/^rotate\(90 /);
  });

  it('bossFacing = -90（合法，將 normalize 為 270）', () => {
    const wrapper = mount(ArenaMap, {
      props: { arena: mockArena, bossFacing: -90 },
    });
    const transform = wrapper.find('[data-testid="boss-facing"]').attributes('transform');
    expect(transform).toMatch(/^rotate\(270 /);
  });
});

describe('ArenaMap - 場地輔助線（arena.lines）', () => {
  it('未提供 lines 時，lines 圖層為空（不渲染任何 line）', () => {
    const wrapper = mount(ArenaMap, { props: { arena: mockArena } });
    const layer = wrapper.find('[data-layer="lines"]');
    expect(layer.exists()).toBe(true);
    expect(layer.findAll('line')).toHaveLength(0);
  });

  it('提供 N 條 lines → 渲染對應數量的 <line>', () => {
    const arenaWithLines = {
      ...mockArena,
      lines: [
        { id: 'l1', start: { x: 0, y: 0 }, end: { x: 1000, y: 1000 } },
        { id: 'l2', start: { x: 0, y: 1000 }, end: { x: 1000, y: 0 } },
        { id: 'l3', start: { x: 500, y: 0 }, end: { x: 500, y: 1000 } },
      ],
    };
    const wrapper = mount(ArenaMap, { props: { arena: arenaWithLines } });
    const layer = wrapper.find('[data-layer="lines"]');
    expect(layer.findAll('line')).toHaveLength(3);
  });

  it('line 套用 JSON 中的 color / thickness', () => {
    const arenaWithLines = {
      ...mockArena,
      lines: [
        {
          id: 'custom',
          start: { x: 0, y: 0 },
          end: { x: 100, y: 100 },
          color: '#FF00AA',
          thickness: 5,
        },
      ],
    };
    const wrapper = mount(ArenaMap, { props: { arena: arenaWithLines } });
    const line = wrapper.find('[data-line-id="custom"]');
    expect(line.attributes('stroke')).toBe('#FF00AA');
    expect(line.attributes('stroke-width')).toBe('5');
    // 端點座標也正確
    expect(line.attributes('x1')).toBe('0');
    expect(line.attributes('y1')).toBe('0');
    expect(line.attributes('x2')).toBe('100');
    expect(line.attributes('y2')).toBe('100');
  });

  it('line 未指定 color / thickness 時套用預設值', () => {
    const arenaWithLines = {
      ...mockArena,
      lines: [{ id: 'default', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } }],
    };
    const wrapper = mount(ArenaMap, { props: { arena: arenaWithLines } });
    const line = wrapper.find('[data-line-id="default"]');
    // 預設色帶有透明度（rgba 開頭）；預設粗細為 2
    expect(line.attributes('stroke')).toMatch(/rgba/);
    expect(line.attributes('stroke-width')).toBe('2');
  });

  it('lines 圖層在 DOM 順序上介於 background 與 waymarks 之間', () => {
    const arenaWithLines = {
      ...mockArena,
      lines: [{ id: 'l', start: { x: 0, y: 0 }, end: { x: 10, y: 10 } }],
    };
    const wrapper = mount(ArenaMap, {
      props: {
        arena: arenaWithLines,
        waymarks: { A: { x: 100, y: 100 } },
      },
    });
    // 取所有 [data-layer] 子節點，依 DOM 順序排列
    const layers = wrapper.findAll('[data-layer]').map((w) => w.attributes('data-layer'));
    const bgIdx = layers.indexOf('background');
    const linesIdx = layers.indexOf('lines');
    const wmIdx = layers.indexOf('waymarks');
    expect(bgIdx).toBeGreaterThanOrEqual(0);
    expect(linesIdx).toBeGreaterThan(bgIdx);
    expect(wmIdx).toBeGreaterThan(linesIdx);
  });

  it('lines 圖層 pointer-events=none，不擋玩家點擊', () => {
    const arenaWithLines = {
      ...mockArena,
      lines: [{ id: 'l', start: { x: 0, y: 0 }, end: { x: 1000, y: 1000 } }],
    };
    const wrapper = mount(ArenaMap, { props: { arena: arenaWithLines } });
    expect(wrapper.find('[data-layer="lines"]').attributes('pointer-events')).toBe('none');
  });
});

describe('ArenaMap - 玩家點擊軌跡', () => {
  it('單一點擊：渲染 1 個圓點，不顯示序號', () => {
    const wrapper = mount(ArenaMap, {
      props: { arena: mockArena, userClicks: [{ x: 500, y: 500 }] },
    });
    const layer = wrapper.find('[data-layer="user-clicks"]');
    expect(layer.findAll('[data-click-index]')).toHaveLength(1);
    expect(layer.find('text').exists()).toBe(false);
  });

  it('多個點擊：每個都渲染 + 顯示序號 1, 2, 3...', () => {
    const wrapper = mount(ArenaMap, {
      props: {
        arena: mockArena,
        userClicks: [
          { x: 100, y: 100 },
          { x: 500, y: 500 },
          { x: 900, y: 900 },
        ],
      },
    });
    const layer = wrapper.find('[data-layer="user-clicks"]');
    expect(layer.findAll('[data-click-index]')).toHaveLength(3);
    const texts = layer.findAll('text').map((t) => t.text());
    expect(texts).toEqual(['1', '2', '3']);
  });
});
