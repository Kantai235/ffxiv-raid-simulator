<script setup lang="ts">
/**
 * CustomImportZone - 自訂 JSON 題庫匯入區塊（Player 設定畫面專用）。
 *
 * 放在 SetupView 的 InstanceSelector 上方，讓玩家：
 *   - 拖放 .json 檔到虛線區域
 *   - 或點擊「選擇檔案」按鈕
 *
 * 成功匯入後，整個設定畫面會自然切換到「此題庫下的攻略/職能選擇」，
 * 上方持續顯示「自訂題庫：xxx」與「清除並回到官方題庫」按鈕。
 *
 * 錯誤（JSON 解析失敗 / schema 不符 / 檔案過大）在此元件內顯示紅色提示，
 * 不會污染整個應用的全域 error 狀態。
 */
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useSettingsStore } from '@/stores/settings';

/** 檔案大小上限：5 MB。dataset JSON 理論上 < 100KB，給足緩衝 */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const store = useSettingsStore();
const { isCustomDataset, dataset, customImportError } = storeToRefs(store);

const fileInputRef = ref<HTMLInputElement | null>(null);

/** 拖放狀態 - 游標進入區塊時加強邊框色 */
const isDragOver = ref(false);

/** 本地錯誤（檔案層級，例如「非 JSON 檔」「過大」）- 與 store 的 schema 錯誤分開 */
const localError = ref<string | null>(null);

/** 當前顯示錯誤：本地優先，store 次之 */
const displayError = computed(() => localError.value ?? customImportError.value);

// ----------------------------------------------------------------------
// 檔案 → 文字 → store
// ----------------------------------------------------------------------

/**
 * 共用的檔案處理流程（拖放與 input change 共用）。
 *
 * 檢查：
 *   1. 必須為 .json 副檔名或 application/json MIME（有些瀏覽器 MIME 會空）
 *   2. 檔案大小 ≤ MAX_IMPORT_BYTES
 *   3. file.text() 解碼為 UTF-8 字串（Safari 13+/所有現代瀏覽器支援）
 *
 * 之後交給 store.loadCustomDataset 做 JSON 解析與 schema 驗證。
 */
async function handleFile(file: File): Promise<void> {
  localError.value = null;

  const isJsonByName = file.name.toLowerCase().endsWith('.json');
  const isJsonByMime = file.type === 'application/json' || file.type === '';
  if (!isJsonByName && !isJsonByMime) {
    localError.value = `請選擇 .json 檔案（收到：${file.name}）`;
    return;
  }

  if (file.size > MAX_IMPORT_BYTES) {
    localError.value = `檔案過大（${(file.size / 1024 / 1024).toFixed(1)}MB，上限 ${MAX_IMPORT_BYTES / 1024 / 1024}MB）`;
    return;
  }

  let text: string;
  try {
    text = await file.text();
  } catch (err) {
    localError.value = `讀取檔案失敗：${err instanceof Error ? err.message : '未知錯誤'}`;
    return;
  }

  // 交給 store 做 JSON parse + schema 驗證
  // 失敗時 store 會設 customImportError，UI 透過 displayError 自動反映
  store.loadCustomDataset(text);
}

// ----------------------------------------------------------------------
// Event handlers
// ----------------------------------------------------------------------

function onFileInputChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) void handleFile(file);
  // 重置 input value 讓使用者可以連續匯入同一個檔案（若再次修改後再拖回來）
  input.value = '';
}

function onDragEnter(event: DragEvent): void {
  event.preventDefault();
  isDragOver.value = true;
}

function onDragOver(event: DragEvent): void {
  // 必須 preventDefault 才能讓 drop event 觸發（HTML5 規範）
  event.preventDefault();
  isDragOver.value = true;
}

function onDragLeave(event: DragEvent): void {
  event.preventDefault();
  isDragOver.value = false;
}

async function onDrop(event: DragEvent): Promise<void> {
  event.preventDefault();
  isDragOver.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file) await handleFile(file);
}

function triggerFileInput(): void {
  fileInputRef.value?.click();
}

function onClearCustom(): void {
  void store.clearCustomDataset();
}
</script>

<template>
  <section data-testid="custom-import-zone">
    <!-- 已載入自訂題庫時：顯示標示 + 清除按鈕 -->
    <div
      v-if="isCustomDataset && dataset"
      class="bg-ffxiv-panel/40 border border-ffxiv-accent/60 rounded-lg p-4 flex items-center gap-3"
      data-testid="custom-active-banner"
    >
      <div class="flex-1">
        <div class="text-xs text-ffxiv-accent font-bold">● 已載入自訂題庫</div>
        <div class="font-medium mt-0.5">{{ dataset.instance.name }}</div>
        <div class="text-xs text-gray-400">
          {{ dataset.strategies.length }} 組攻略 · {{ dataset.questions.length }} 題
        </div>
      </div>
      <button
        type="button"
        data-testid="clear-custom-button"
        class="text-xs px-3 py-1.5 bg-ffxiv-panel hover:bg-ffxiv-panel/70 rounded whitespace-nowrap"
        @click="onClearCustom"
      >
        ← 清除並回到官方題庫
      </button>
    </div>

    <!-- 未載入自訂題庫：顯示拖放區 -->
    <div v-else>
      <input
        ref="fileInputRef"
        type="file"
        accept=".json,application/json"
        class="hidden"
        data-testid="custom-import-file-input"
        @change="onFileInputChange"
      />

      <div
        class="border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer"
        :class="
          isDragOver
            ? 'border-ffxiv-accent bg-ffxiv-accent/10'
            : 'border-gray-600 hover:border-ffxiv-accent/60 bg-ffxiv-panel/20'
        "
        data-testid="custom-import-dropzone"
        @dragenter="onDragEnter"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
        @click="triggerFileInput"
      >
        <div class="text-sm text-gray-300">
          拖放自訂題庫 <code class="text-ffxiv-accent">.json</code> 到此，
          或 <span class="text-ffxiv-accent underline">點擊選擇檔案</span>
        </div>
        <div class="text-xs text-gray-500 mt-1.5">
          從朋友/固定團分享的題庫？這裡匯入即可直接練習，無須部署。
        </div>
      </div>

      <!-- 錯誤提示 -->
      <div
        v-if="displayError"
        data-testid="custom-import-error"
        class="mt-3 bg-ffxiv-danger/20 border border-ffxiv-danger/60 rounded px-3 py-2"
        role="alert"
      >
        <p class="text-sm text-ffxiv-danger font-bold">匯入失敗</p>
        <p class="text-xs text-gray-200 mt-0.5">{{ displayError }}</p>
      </div>
    </div>
  </section>
</template>
