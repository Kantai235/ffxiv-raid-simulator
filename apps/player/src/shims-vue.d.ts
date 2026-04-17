/**
 * Vue SFC 型別 shim - 讓 TypeScript 認識 .vue 檔案的預設匯出。
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
