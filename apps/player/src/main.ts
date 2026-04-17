import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import './styles/main.css';

/**
 * Player 前台應用程式入口。
 *
 * Vue 3 + Pinia + Vue Router 4。
 * 整體採 SPA 結構，路由切換不會重新載入頁面。
 */
const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
