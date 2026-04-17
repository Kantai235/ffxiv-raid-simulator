<script setup lang="ts">
/**
 * EditorView - 視覺化編輯器主畫面（含模式切換）。
 *
 * Layout：
 *   ┌────────────────────────────────────────┐
 *   │ Header（檔案 + 模式切換 + Save + 狀態）  │
 *   ├──────────────┬─────────────────────────┤
 *   │ Control      │  Canvas                 │
 *   │ - Strategy   │  EditableArenaMap       │
 *   │ - Waymark/   │  （waymarks 拖曳         │
 *   │   Arena      │   或 arena 畫線）       │
 *   │   Panel      │                         │
 *   └──────────────┴─────────────────────────┘
 */
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import type { ArenaLine, Point2D, WaymarkId } from '@ffxiv-sim/shared';
import { useEditorStore, type EditorMode } from '@/stores/editor';
import EditableArenaMap from '@/components/EditableArenaMap.vue';
import WaymarkToolbar from '@/components/WaymarkToolbar.vue';
import ArenaSettingsPanel from '@/components/ArenaSettingsPanel.vue';
import QuestionsPanel from '@/components/QuestionsPanel.vue';
import RoleSolutionPanel from '@/components/RoleSolutionPanel.vue';

const store = useEditorStore();
const {
  dataset,
  currentFilename,
  selectedStrategyId,
  selectedStrategy,
  selectedQuestion,
  selectedRoleSolution,
  availableFiles,
  publishedIndex,
  isLoading,
  isLoadingPublished,
  isSaving,
  error,
  isDirty,
  mode,
  selectedLineId,
  isLocalApiAvailable,
} = storeToRefs(store);

/**
 * 圖片 cache busting token - 上傳成功時 bump，連動 EditableArenaMap
 * 在 image href 後加 ?t=token 強制重抓。
 *
 * Why 在 view 層而非 store：純 UI 暫態，與 dataset 無關，
 *      不該污染 dataset/dirty 邏輯。
 */
const imageCacheToken = ref(0);

onMounted(async () => {
  // 先探測環境：有本機 API 才需要 refreshFileList（從 dev server 取檔案列表）
  // 靜態 GH Pages 模式下沒 API，改為 fetch 發佈版 index.json 讓出題者
  // 可直接從官方題庫下拉選擇載入（省去「先下載再上傳」的麻煩）
  await store.detectLocalApiAvailability();
  if (store.isLocalApiAvailable) {
    void store.refreshFileList();
  } else if (store.isLocalApiAvailable === false) {
    void store.loadPublishedIndex();
  }
  window.addEventListener('keydown', onKeyDown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
});

// ----------------------------------------------------------------------
// 鍵盤：Delete 移除選取的線
// ----------------------------------------------------------------------

/**
 * 全域鍵盤監聽 - Delete/Backspace 移除選取的輔助線。
 *
 * 防護：若使用者正在輸入框內按 Delete（如修改 size），不該觸發刪除線。
 * 用 `target instanceof HTMLInputElement / HTMLTextAreaElement / HTMLSelectElement`
 * 過濾。
 */
function onKeyDown(event: KeyboardEvent): void {
  // ----- Esc：questions 模式取消當前繪製 -----
  // 不過濾表單元素 - 出題者輸入到一半可能想取消畫布上的繪圖暫態
  if (event.key === 'Escape') {
    if (mode.value === 'questions' && store.drawingPoints.length > 0) {
      store.cancelDrawing();
      event.preventDefault();
    }
    return;
  }

  // ----- Delete / Backspace：arena 模式刪線、questions 模式刪選定 SafeArea -----
  if (event.key !== 'Delete' && event.key !== 'Backspace') return;
  const target = event.target;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return; // 表單元素內，讓瀏覽器處理（避免修改題目名稱時按 Delete 誤刪 SafeArea）
  }
  if (mode.value === 'arena' && selectedLineId.value) {
    store.removeArenaLine(selectedLineId.value);
    event.preventDefault();
    return;
  }
  if (mode.value === 'questions' && store.selectedSafeAreaId) {
    store.removeSafeAreaById(store.selectedSafeAreaId);
    event.preventDefault();
  }
}

// ----------------------------------------------------------------------
// 檔案/攻略選擇
// ----------------------------------------------------------------------

function onLoadFile(event: Event): void {
  const target = event.target as HTMLSelectElement;
  if (!target.value) return;
  if (isDirty.value) {
    const ok = window.confirm('當前有未儲存的變更，確定要切換檔案嗎？');
    if (!ok) {
      target.value = currentFilename.value ?? '';
      return;
    }
  }
  void store.loadDataset(target.value);
}

function onStrategyChange(event: Event): void {
  const target = event.target as HTMLSelectElement;
  store.selectStrategy(target.value);
}

// ----------------------------------------------------------------------
// 模式切換
// ----------------------------------------------------------------------

function setMode(next: EditorMode): void {
  store.setMode(next);
}

// ----------------------------------------------------------------------
// 畫布事件 → store
// ----------------------------------------------------------------------

function onWaymarkDragEnd(id: WaymarkId, point: Point2D): void {
  if (!selectedStrategyId.value) return;
  store.updateWaymark(selectedStrategyId.value, id, point);
}

function onLineCreate(line: ArenaLine): void {
  store.addArenaLine(line);
}

function onLineSelect(id: string | null): void {
  store.selectLine(id);
}

/**
 * questions 模式下的畫布點擊 - 目前僅 log，下一階段接 polygon/circle/rect 繪製狀態機。
 */
function onCanvasClick(point: Point2D): void {
  // TODO: 將在此處理 Circle/Rect/Polygon 的繪製邏輯（下一階段）
  void point;
}

// 給 EditableArenaMap 的 questions 模式 props
const bossStateForCanvas = computed(() =>
  mode.value === 'questions' ? selectedQuestion.value?.boss ?? null : null,
);
const safeAreasForCanvas = computed(() => {
  if (mode.value !== 'questions') return [];
  const sol = selectedRoleSolution.value;
  if (!sol || !('safeAreas' in sol)) return [];
  return sol.safeAreas;
});

// ----------------------------------------------------------------------
// Save / 下載 / 上傳 - 依環境分流
// ----------------------------------------------------------------------

/**
 * 「儲存」按鈕的行為：
 *   - 本機 dev（有 local API）→ 寫回 player 資料夾
 *   - 靜態 GH Pages → 觸發瀏覽器下載 JSON 檔
 */
async function onSave(): Promise<void> {
  if (isLocalApiAvailable.value === true) {
    await store.saveDataset();
  } else {
    // 靜態模式：下載
    store.downloadDataset();
  }
}

/**
 * 「上傳 JSON 檔」- 靜態模式下，朋友從本地選取現有題庫 JSON 載入繼續編輯。
 * 這個流程在本機 dev 模式也可用（可當作「從外部來源載入」），但既有 UI 以下拉選單為主。
 */
const jsonFileInputRef = ref<HTMLInputElement | null>(null);

function triggerJsonFileInput(): void {
  jsonFileInputRef.value?.click();
}

/**
 * 「從官方題庫載入」下拉選擇 - 靜態模式下直接 fetch player 發佈目錄下的 JSON。
 *
 * dirty 防呆：若當前有未儲存變更，先 confirm。使用者取消時 reset select 回原值。
 */
async function onLoadPublished(event: Event): Promise<void> {
  const target = event.target as HTMLSelectElement;
  const instanceId = target.value;
  if (!instanceId) return;
  if (isDirty.value) {
    const ok = window.confirm('當前有未儲存的變更，確定要切換副本嗎？');
    if (!ok) {
      target.value = '';
      return;
    }
  }
  const entry = publishedIndex.value?.instances.find((i) => i.id === instanceId);
  if (!entry) return;
  await store.loadPublishedDataset(entry);
  // 載入後重置 select 為空，避免「重載同一副本」時 change 事件不觸發
  target.value = '';
}

async function onUploadJsonFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (isDirty.value) {
    const ok = window.confirm('當前有未儲存的變更，確定要載入新檔案嗎？');
    if (!ok) {
      input.value = '';
      return;
    }
  }
  try {
    const text = await file.text();
    store.loadDatasetFromJson(text, file.name);
  } catch (err) {
    store.error = err instanceof Error ? err.message : '讀取檔案失敗';
  } finally {
    // 重設 input 讓使用者可以連續上傳同一個檔案（修改後再匯入）
    input.value = '';
  }
}

// 監聽 backgroundImage 變化 - 上傳成功（路徑更新）時 bump cache token
// 用完整 optional chain 防禦：若 dataset 為非法結構（例如使用者塞了壞檔），
// 此 watcher 不會崩潰導致整個 view 炸掉。store 層已有結構驗證，此處為雙保險。
watch(
  () => dataset.value?.instance?.arena?.backgroundImage,
  (newPath, oldPath) => {
    // 路徑變動（含初次設定）→ bump token 強制 EditableArenaMap 重抓圖
    if (newPath !== oldPath) {
      imageCacheToken.value = Date.now();
    }
  },
);
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- ===== Header ===== -->
    <header class="bg-editor-panel border-b border-editor-accent/40 px-6 py-3 shrink-0">
      <div class="flex flex-wrap items-center gap-4">
        <h1 class="text-lg font-bold text-editor-accent">
          FFXIV Raid Simulator - 出題工具
        </h1>

        <!-- 檔案選擇器 - 依環境分流 -->
        <!-- 【本機 dev 模式】有 local API：從 dev server 取得 dataset 清單下拉選 -->
        <div v-if="isLocalApiAvailable === true" class="flex items-center gap-2">
          <label class="text-xs text-gray-400">檔案：</label>
          <select
            data-testid="file-selector"
            :value="currentFilename ?? ''"
            class="bg-editor-bg border border-gray-600 rounded px-2 py-1 text-sm"
            @change="onLoadFile"
          >
            <option value="" disabled>—— 選擇 dataset ——</option>
            <option v-for="f in availableFiles" :key="f" :value="f">{{ f }}</option>
          </select>
          <button
            type="button"
            class="text-xs px-2 py-1 bg-editor-bg hover:bg-editor-panel/60 rounded"
            @click="store.refreshFileList()"
          >
            ⟳
          </button>
        </div>

        <!-- 【靜態 GH Pages 模式】無 local API：改為從官方題庫選擇 或 上傳 JSON 檔載入 -->
        <div v-else-if="isLocalApiAvailable === false" class="flex items-center gap-2 flex-wrap">
          <!-- 官方題庫下拉 - fetch 自 player 發佈目錄 -->
          <label class="text-xs text-gray-400">官方題庫：</label>
          <select
            data-testid="published-selector"
            :disabled="isLoadingPublished || !publishedIndex"
            class="bg-editor-bg border border-gray-600 rounded px-2 py-1 text-sm disabled:opacity-50"
            @change="onLoadPublished"
          >
            <option value="">
              <template v-if="isLoadingPublished">載入中…</template>
              <template v-else-if="!publishedIndex">（未能載入索引）</template>
              <template v-else>—— 選擇官方副本 ——</template>
            </option>
            <option
              v-for="entry in publishedIndex?.instances ?? []"
              :key="entry.id"
              :value="entry.id"
            >
              {{ entry.name }}
            </option>
          </select>
          <button
            type="button"
            data-testid="published-refresh"
            class="text-xs px-2 py-1 bg-editor-bg hover:bg-editor-panel/60 rounded"
            :disabled="isLoadingPublished"
            title="重新載入索引"
            @click="store.loadPublishedIndex()"
          >
            ⟳
          </button>

          <span class="text-gray-500 text-xs">或</span>

          <input
            ref="jsonFileInputRef"
            type="file"
            accept=".json,application/json"
            class="hidden"
            data-testid="json-file-input"
            @change="onUploadJsonFile"
          />
          <button
            type="button"
            data-testid="load-json-button"
            class="text-xs px-3 py-1 bg-editor-bg hover:bg-editor-panel/60 rounded border border-editor-accent/60"
            @click="triggerJsonFileInput"
          >
            📂 載入本機 JSON
          </button>
          <span v-if="currentFilename" class="text-xs text-gray-400 truncate max-w-[160px]">
            {{ currentFilename }}
          </span>
        </div>

        <!-- 模式切換（兩段式按鈕） -->
        <div v-if="dataset" class="flex bg-editor-bg rounded overflow-hidden border border-gray-600">
          <button
            type="button"
            data-testid="mode-waymarks"
            class="px-3 py-1 text-sm transition-colors"
            :class="mode === 'waymarks' ? 'bg-editor-accent text-editor-bg font-bold' : 'hover:bg-editor-panel/60'"
            @click="setMode('waymarks')"
          >
            場地標記
          </button>
          <button
            type="button"
            data-testid="mode-arena"
            class="px-3 py-1 text-sm transition-colors"
            :class="mode === 'arena' ? 'bg-editor-accent text-editor-bg font-bold' : 'hover:bg-editor-panel/60'"
            @click="setMode('arena')"
          >
            場地設定
          </button>
          <button
            type="button"
            data-testid="mode-questions"
            class="px-3 py-1 text-sm transition-colors"
            :class="mode === 'questions' ? 'bg-editor-accent text-editor-bg font-bold' : 'hover:bg-editor-panel/60'"
            @click="setMode('questions')"
          >
            題目編輯
          </button>
        </div>

        <!-- 狀態 -->
        <div class="text-xs text-gray-400 flex items-center gap-3">
          <span v-if="isLoading">載入中…</span>
          <span v-else-if="isSaving">儲存中…</span>
          <span v-else-if="isDirty" class="text-yellow-400">● 未儲存變更</span>
          <span v-else-if="currentFilename" class="text-editor-accent">● 已儲存</span>
        </div>

        <div class="flex-1" />

        <!-- Save 按鈕 - 文字依環境分流：本機 dev 顯示「儲存」、靜態模式顯示「📥 下載 JSON」 -->
        <button
          type="button"
          data-testid="save-button"
          :disabled="!dataset || isSaving"
          class="px-4 py-1.5 rounded font-bold transition-colors
                 disabled:opacity-50 disabled:cursor-not-allowed
                 bg-editor-accent text-editor-bg hover:bg-emerald-400"
          @click="onSave"
        >
          <template v-if="isLocalApiAvailable === false">📥 下載 JSON</template>
          <template v-else>儲存</template>
        </button>
      </div>

      <!-- 靜態模式提示橫幅 - 讓朋友清楚知道目前環境的操作邏輯 -->
      <div
        v-if="isLocalApiAvailable === false"
        data-testid="static-mode-banner"
        class="mt-2 text-xs bg-editor-accent/15 border border-editor-accent/40 rounded px-3 py-1.5 text-gray-200"
      >
        <span class="font-bold text-editor-accent">出題者模式</span>
        ：可從上方「官方題庫」下拉選擇既有副本開始編輯，或上傳本機 JSON 檔。
        編輯完成後按右上「下載 JSON」，將檔案傳給管理員即可。
        <span class="text-gray-400">（場地圖上傳功能僅在本機模式可用）</span>
      </div>

      <!-- 錯誤訊息 -->
      <div
        v-if="error"
        data-testid="error-banner"
        class="mt-2 text-sm bg-red-500/20 border border-red-500/60 text-red-300 rounded px-3 py-2"
      >
        {{ error }}
      </div>
    </header>

    <!-- ===== Body ===== -->
    <div v-if="dataset" class="flex-1 flex overflow-hidden">
      <!-- 左側 Control Panel - 依模式切換內容 -->
      <aside class="w-80 bg-editor-panel/40 border-r border-editor-accent/20 p-4 overflow-y-auto shrink-0">
        <!-- 副本資訊（兩模式共用） -->
        <section class="mb-6">
          <div class="text-xs text-gray-400 mb-1">副本</div>
          <div class="font-bold">{{ dataset.instance.name }}</div>
          <div class="text-xs text-gray-500">{{ dataset.instance.shortName }}</div>
        </section>

        <!-- Waymarks 模式 -->
        <template v-if="mode === 'waymarks'">
          <section class="mb-6">
            <label class="text-xs text-gray-400 block mb-1">攻略組</label>
            <select
              data-testid="strategy-selector"
              :value="selectedStrategyId ?? ''"
              class="w-full bg-editor-bg border border-gray-600 rounded px-2 py-1.5 text-sm"
              @change="onStrategyChange"
            >
              <option value="" disabled>—— 選擇攻略 ——</option>
              <option v-for="s in dataset.strategies" :key="s.id" :value="s.id">
                {{ s.name }}
              </option>
            </select>
            <div v-if="selectedStrategy?.author" class="text-xs text-gray-500 mt-1">
              作者：{{ selectedStrategy.author }}
            </div>
          </section>

          <section class="mb-6">
            <div class="text-xs text-gray-400 mb-2">場地標記（點擊新增/移除，可拖曳定位）</div>
            <WaymarkToolbar />
          </section>

          <section class="text-xs text-gray-500 leading-relaxed">
            <div class="text-editor-accent font-bold mb-1">操作說明</div>
            <ul class="list-disc list-inside space-y-0.5">
              <li>點擊上方按鈕啟用標記</li>
              <li>於畫布拖曳標記調整座標</li>
              <li>完成後按右上「儲存」</li>
            </ul>
          </section>
        </template>

        <!-- Arena 模式 -->
        <template v-else-if="mode === 'arena'">
          <section class="mb-6">
            <div class="text-xs text-editor-accent font-bold mb-3">場地設定</div>
            <ArenaSettingsPanel />
          </section>

          <section class="text-xs text-gray-500 leading-relaxed">
            <div class="text-editor-accent font-bold mb-1">操作說明</div>
            <ul class="list-disc list-inside space-y-0.5">
              <li>調整左側場地基本屬性</li>
              <li>於畫布空白處拖曳繪製輔助線</li>
              <li>點擊既有線可選取</li>
              <li>選取後按 Delete 移除</li>
            </ul>
          </section>
        </template>

        <!-- Questions 模式：題目清單 + 解答編輯（兩個 panel 直向疊放） -->
        <template v-else>
          <section class="mb-6">
            <QuestionsPanel />
          </section>
          <section class="border-t border-gray-700 pt-4">
            <RoleSolutionPanel />
          </section>
        </template>
      </aside>

      <!-- 中央畫布 -->
      <main class="flex-1 p-6 overflow-auto">
        <div class="aspect-square max-w-[720px] mx-auto bg-editor-bg rounded-lg border border-editor-accent/30 overflow-hidden">
          <EditableArenaMap
            :arena="dataset.instance.arena"
            :waymarks="selectedStrategy?.waymarks ?? {}"
            :mode="mode"
            :selected-line-id="selectedLineId"
            :image-cache-token="imageCacheToken"
            :boss-state="bossStateForCanvas"
            :safe-areas="safeAreasForCanvas"
            @waymark-drag-end="onWaymarkDragEnd"
            @line-create="onLineCreate"
            @line-select="onLineSelect"
            @canvas-click="onCanvasClick"
          />
        </div>
      </main>
    </div>

    <!-- 未載入任何檔的引導 -->
    <div v-else class="flex-1 flex items-center justify-center text-gray-500">
      <div class="text-center">
        <p class="mb-2">請從上方下拉選單選擇要編輯的 dataset 檔。</p>
        <p class="text-xs">檔案位於 apps/player/public/assets/data/</p>
      </div>
    </div>
  </div>
</template>
