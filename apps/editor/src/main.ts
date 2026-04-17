import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import './styles/main.css';

/**
 * Editor 本機出題工具入口。
 * 不使用 vue-router（編輯器是單頁面 dashboard 結構）。
 */
const app = createApp(App);
app.use(createPinia());
app.mount('#app');
