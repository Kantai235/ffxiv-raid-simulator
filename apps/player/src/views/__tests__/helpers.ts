import { createRouter, createMemoryHistory, type Router } from 'vue-router';

/**
 * 測試用 router 工廠 - 採 memory history（無 URL hash 殘留）。
 *
 * 提供與生產 router 相同的路徑骨架，但不掛載真正的 view component
 * （測試只關心目標元件，跳轉的目標頁不需實際渲染）。
 */
export function createTestRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', redirect: '/setup' },
      { path: '/setup', name: 'setup', component: { template: '<div>setup</div>' } },
      { path: '/practice', name: 'practice', component: { template: '<div>practice</div>' } },
      { path: '/result', name: 'result', component: { template: '<div>result</div>' } },
      {
        path: '/review/:index',
        name: 'review',
        component: { template: '<div>review</div>' },
        props: true,
      },
      { path: '/scorecard', name: 'scorecard', component: { template: '<div>scorecard</div>' } },
    ],
  });
}
