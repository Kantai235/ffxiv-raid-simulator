import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';

/**
 * Player 前台路由。
 *
 * 使用 hash history（# 路由）：
 *   Why: 部署於 GitHub Pages 時，server 不認識 SPA 子路徑，
 *        若用 history mode 重新整理會 404。hash 模式由瀏覽器自行處理，最穩定。
 */
const routes: RouteRecordRaw[] = [
  {
    // 根路徑直接導向設定畫面 - 不另設 home 頁面避免概念冗餘
    path: '/',
    redirect: '/setup',
  },
  {
    path: '/setup',
    name: 'setup',
    component: () => import('@/views/SetupView.vue'),
  },
  {
    path: '/practice',
    name: 'practice',
    component: () => import('@/views/PracticeView.vue'),
  },
  {
    path: '/result',
    name: 'result',
    component: () => import('@/views/ResultView.vue'),
  },
  {
    // index = 該題在 session.answers 陣列中的位置（0-based）
    // Why 用 index 而非 questionId：上/下一題導覽用 index 計算為 O(1)，
    //                              且即使未來題目允許重複也不會撞名
    path: '/review/:index',
    name: 'review',
    component: () => import('@/views/ReviewView.vue'),
    props: true,
  },
  {
    // 分享成績單 - 純讀 URL query（?data=Base64URL），不依賴任何 store
    // 任何人打連結都能看到分享者的成績 + CTA 按鈕導去 /setup
    path: '/scorecard',
    name: 'scorecard',
    component: () => import('@/views/SharedScorecardView.vue'),
  },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});
