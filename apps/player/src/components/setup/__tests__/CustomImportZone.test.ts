import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CustomImportZone from '../CustomImportZone.vue';
import { useSettingsStore } from '@/stores/settings';

/**
 * CustomImportZone 元件測試 - 重點覆蓋：
 *   1. 模擬檔案上傳 → 呼叫 store.loadCustomDataset
 *   2. JSON 解析失敗 → 顯示錯誤提示
 *   3. 拖放事件處理
 *   4. 匯入成功後切換為「已載入」banner
 *
 * jsdom 的 File 有 text() 方法但需要構造；直接傳 Blob 含 File 介面即可。
 */

/**
 * 產生 File 測試物件。
 *
 * jsdom 的 File 繼承自 Blob，但 Blob.text() 在舊版 jsdom 並未完整實作，
 * 導致 `file.text()` 拋出 `file.text is not a function`。
 * 明確掛上 `text()` 方法回傳原內容的 Promise，測試環境才能模擬真實瀏覽器行為。
 */
function makeJsonFile(content: string, name = 'm1s.json'): File {
  const file = new File([content], name, { type: 'application/json' });
  // 覆寫 text() 確保測試環境可靠
  Object.defineProperty(file, 'text', {
    value: () => Promise.resolve(content),
    configurable: true,
  });
  return file;
}

function validDatasetJson(): string {
  return JSON.stringify({
    schemaVersion: '1.0',
    instance: {
      id: 'custom-m1s',
      name: '自訂 M1S',
      shortName: 'M1S',
      arena: {
        shape: 'square',
        backgroundImage: '',
        size: { width: 1000, height: 1000 },
        center: { x: 500, y: 500 },
      },
    },
    strategies: [],
    questions: [],
    debuffLibrary: [],
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('CustomImportZone - 初始渲染', () => {
  it('未匯入時：顯示拖放區 + file input', () => {
    const wrapper = mount(CustomImportZone);
    expect(wrapper.find('[data-testid="custom-import-dropzone"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="custom-import-file-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="custom-active-banner"]').exists()).toBe(false);
  });
});

describe('CustomImportZone - file input 上傳', () => {
  it('合法 JSON → 呼叫 store.loadCustomDataset + 切換為 banner', async () => {
    const wrapper = mount(CustomImportZone);
    const store = useSettingsStore();
    const spy = vi.spyOn(store, 'loadCustomDataset');

    // 模擬 file input change
    const file = makeJsonFile(validDatasetJson());
    const input = wrapper.find('[data-testid="custom-import-file-input"]')
      .element as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [file],
      configurable: true,
    });
    await wrapper.find('[data-testid="custom-import-file-input"]').trigger('change');
    await flushPromises();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe(validDatasetJson());

    // 重新渲染後應顯示 banner（store 狀態已更新）
    expect(wrapper.find('[data-testid="custom-active-banner"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="custom-import-dropzone"]').exists()).toBe(false);
  });

  it('JSON 解析失敗 → 顯示錯誤提示（不切換 banner）', async () => {
    const wrapper = mount(CustomImportZone);
    const file = makeJsonFile('{ invalid json }');
    const input = wrapper.find('[data-testid="custom-import-file-input"]')
      .element as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await wrapper.find('[data-testid="custom-import-file-input"]').trigger('change');
    await flushPromises();

    expect(wrapper.find('[data-testid="custom-import-error"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="custom-active-banner"]').exists()).toBe(false);
  });

  it('非 .json 副檔名 → 本地錯誤（未呼叫 store）', async () => {
    const wrapper = mount(CustomImportZone);
    const store = useSettingsStore();
    const spy = vi.spyOn(store, 'loadCustomDataset');

    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const input = wrapper.find('[data-testid="custom-import-file-input"]')
      .element as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await wrapper.find('[data-testid="custom-import-file-input"]').trigger('change');
    await flushPromises();

    expect(spy).not.toHaveBeenCalled();
    const errorEl = wrapper.find('[data-testid="custom-import-error"]');
    expect(errorEl.exists()).toBe(true);
    expect(errorEl.text()).toContain('.json');
  });

  it('schema 版本不符 → 顯示 store 提供的錯誤訊息', async () => {
    const wrapper = mount(CustomImportZone);
    const badJson = JSON.stringify({
      schemaVersion: '0.5',
      instance: {
        id: 'x',
        name: 'x',
        arena: {
          shape: 'square',
          size: { width: 100, height: 100 },
          center: { x: 50, y: 50 },
        },
      },
      strategies: [],
      questions: [],
      debuffLibrary: [],
    });
    const file = makeJsonFile(badJson);
    const input = wrapper.find('[data-testid="custom-import-file-input"]')
      .element as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await wrapper.find('[data-testid="custom-import-file-input"]').trigger('change');
    await flushPromises();

    const errorEl = wrapper.find('[data-testid="custom-import-error"]');
    expect(errorEl.exists()).toBe(true);
    expect(errorEl.text()).toContain('0.5');
  });
});

describe('CustomImportZone - 拖放事件', () => {
  it('dragover → preventDefault（讓後續 drop 可觸發）', async () => {
    const wrapper = mount(CustomImportZone);
    const dropzone = wrapper.find('[data-testid="custom-import-dropzone"]');
    // trigger 會產生 Event，用 preventDefault spy 無法直接驗證
    // 改為驗證 isDragOver 視覺狀態（游標進入後 class 改變）
    await dropzone.trigger('dragenter');
    expect(dropzone.classes()).toContain('border-ffxiv-accent');
  });

  it('dragleave → 取消高亮', async () => {
    const wrapper = mount(CustomImportZone);
    const dropzone = wrapper.find('[data-testid="custom-import-dropzone"]');
    await dropzone.trigger('dragenter');
    await dropzone.trigger('dragleave');
    // dragenter 後 hover 色；dragleave 後回預設色（未 hover）
    // 只需驗證狀態不包含 active class 即可
    expect(dropzone.classes()).not.toContain('bg-ffxiv-accent/10');
  });

  it('drop 合法 JSON → 呼叫 store.loadCustomDataset', async () => {
    const wrapper = mount(CustomImportZone);
    const store = useSettingsStore();
    const spy = vi.spyOn(store, 'loadCustomDataset');

    const file = makeJsonFile(validDatasetJson());
    const dropzone = wrapper.find('[data-testid="custom-import-dropzone"]').element;

    // Vue Test Utils 的 trigger(eventName, init) 只能傳 EventInit，不支援塞 DataTransfer，
    // 而 jsdom 沒有可用的 DataTransfer 建構子，因此改為手動派發一個帶 dataTransfer 的 Event。
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: { files: [file] },
      configurable: true,
    });
    dropzone.dispatchEvent(event);
    await flushPromises();

    expect(spy).toHaveBeenCalled();
  });
});

describe('CustomImportZone - 已載入 banner', () => {
  it('顯示當前 dataset 資訊與清除按鈕', async () => {
    const store = useSettingsStore();
    store.loadCustomDataset(validDatasetJson());
    const wrapper = mount(CustomImportZone);

    const banner = wrapper.find('[data-testid="custom-active-banner"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain('自訂 M1S');
    expect(wrapper.find('[data-testid="clear-custom-button"]').exists()).toBe(true);
  });

  it('點擊清除按鈕 → 呼叫 store.clearCustomDataset', async () => {
    const store = useSettingsStore();
    store.loadCustomDataset(validDatasetJson());
    const clearSpy = vi.spyOn(store, 'clearCustomDataset').mockResolvedValue();

    const wrapper = mount(CustomImportZone);
    await wrapper.find('[data-testid="clear-custom-button"]').trigger('click');

    expect(clearSpy).toHaveBeenCalled();
  });
});
