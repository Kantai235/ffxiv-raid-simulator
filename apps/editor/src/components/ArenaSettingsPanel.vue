<script setup lang="ts">
/**
 * ArenaSettingsPanel - 場地設定面板（mode='arena' 時顯示）。
 *
 * 編輯範圍：
 *   - 場地寬高（邏輯尺寸）
 *   - 形狀切換（square / circle）
 *   - 背景圖上傳
 *   - 中心點校正（X/Y）
 *   - 已繪製輔助線清單（含選取/刪除）
 */
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useEditorStore } from '@/stores/editor';

const store = useEditorStore();
const { dataset, isUploadingImage, selectedLineId, isLocalApiAvailable } = storeToRefs(store);

const arena = computed(() => dataset.value?.instance.arena);

/** 隱藏的 file input ref - 給「選擇圖片」按鈕觸發點擊用 */
const fileInputRef = ref<HTMLInputElement | null>(null);

/**
 * 為背景圖路徑加上 cache busting 時間戳。
 *
 * Why: 上傳圖片後若新檔案沿用舊路徑（理論上 UUID 檔名不會發生，但保險），
 *      或同檔名重新上傳時，瀏覽器會用快取的舊圖。加 ?t=timestamp 強制重抓。
 *
 * cacheBustToken 在每次上傳成功時 bump，連動 imagePreviewUrl 重算。
 */
const cacheBustToken = ref<number>(0);

const imagePreviewUrl = computed(() => {
  const path = arena.value?.backgroundImage;
  if (!path) return '';
  // 圖片是 player public 下的相對路徑；editor dev server 並未提供這些檔案
  // 因此預覽用「player dev server URL」會是另一回事 - 這裡先給空，
  // 實際預覽由 EditableArenaMap 中的 SVG <image> 處理 cache bust。
  return cacheBustToken.value > 0 ? `${path}?t=${cacheBustToken.value}` : path;
});

async function onSelectImage(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const ok = await store.uploadAndSetBackground(file);
  if (ok) {
    cacheBustToken.value = Date.now();
  }
  // 重設 input 讓使用者可以連續上傳同個檔名
  input.value = '';
}

function triggerFileInput(): void {
  fileInputRef.value?.click();
}

// ----------------------------------------------------------------------
// 數值欄位 - 用 v-model.number 結合 onChange 推到 store
// ----------------------------------------------------------------------

function setWidth(value: number): void {
  if (!arena.value || Number.isNaN(value) || value <= 0) return;
  store.updateArena({ size: { ...arena.value.size, width: value } });
}

function setHeight(value: number): void {
  if (!arena.value || Number.isNaN(value) || value <= 0) return;
  store.updateArena({ size: { ...arena.value.size, height: value } });
}

function setCenterX(value: number): void {
  if (!arena.value || Number.isNaN(value)) return;
  store.updateArena({ center: { ...arena.value.center, x: value } });
}

function setCenterY(value: number): void {
  if (!arena.value || Number.isNaN(value)) return;
  store.updateArena({ center: { ...arena.value.center, y: value } });
}

function setShape(shape: 'square' | 'circle'): void {
  store.updateArena({ shape });
}

// ----------------------------------------------------------------------
// 線條清單操作
// ----------------------------------------------------------------------

const lines = computed(() => arena.value?.lines ?? []);

function selectLine(id: string): void {
  store.selectLine(selectedLineId.value === id ? null : id);
}

function removeLine(id: string): void {
  store.removeArenaLine(id);
}
</script>

<template>
  <div v-if="arena" data-testid="arena-settings-panel" class="space-y-5 text-sm">
    <!-- ===== 形狀 ===== -->
    <section>
      <label class="block text-xs text-gray-400 mb-1.5">場地形狀</label>
      <div class="flex gap-2">
        <button
          type="button"
          data-testid="shape-square"
          class="flex-1 px-3 py-1.5 rounded border-2 transition-colors"
          :class="
            arena.shape === 'square'
              ? 'border-editor-accent bg-editor-accent/20 text-editor-accent'
              : 'border-gray-600 hover:border-editor-accent/60'
          "
          @click="setShape('square')"
        >
          方形
        </button>
        <button
          type="button"
          data-testid="shape-circle"
          class="flex-1 px-3 py-1.5 rounded border-2 transition-colors"
          :class="
            arena.shape === 'circle'
              ? 'border-editor-accent bg-editor-accent/20 text-editor-accent'
              : 'border-gray-600 hover:border-editor-accent/60'
          "
          @click="setShape('circle')"
        >
          圓形
        </button>
      </div>
    </section>

    <!-- ===== 邏輯尺寸 ===== -->
    <section>
      <label class="block text-xs text-gray-400 mb-1.5">邏輯尺寸（width × height）</label>
      <div class="flex gap-2">
        <input
          type="number"
          min="1"
          step="10"
          :value="arena.size.width"
          data-testid="size-width"
          class="w-full bg-editor-bg border border-gray-600 rounded px-2 py-1 font-mono"
          @change="setWidth(Number(($event.target as HTMLInputElement).value))"
        />
        <span class="self-center text-gray-500">×</span>
        <input
          type="number"
          min="1"
          step="10"
          :value="arena.size.height"
          data-testid="size-height"
          class="w-full bg-editor-bg border border-gray-600 rounded px-2 py-1 font-mono"
          @change="setHeight(Number(($event.target as HTMLInputElement).value))"
        />
      </div>
    </section>

    <!-- ===== 中心點 ===== -->
    <section>
      <label class="block text-xs text-gray-400 mb-1.5">場地中心校正（X, Y）</label>
      <div class="flex gap-2">
        <input
          type="number"
          step="1"
          :value="arena.center.x"
          data-testid="center-x"
          class="w-full bg-editor-bg border border-gray-600 rounded px-2 py-1 font-mono"
          @change="setCenterX(Number(($event.target as HTMLInputElement).value))"
        />
        <input
          type="number"
          step="1"
          :value="arena.center.y"
          data-testid="center-y"
          class="w-full bg-editor-bg border border-gray-600 rounded px-2 py-1 font-mono"
          @change="setCenterY(Number(($event.target as HTMLInputElement).value))"
        />
      </div>
      <p class="text-xs text-gray-500 mt-1">
        若上傳的圖片場地中心非幾何正中央，調整此值對齊。
      </p>
    </section>

    <!-- ===== 背景圖 ===== -->
    <section>
      <label class="block text-xs text-gray-400 mb-1.5">背景圖</label>
      <input
        ref="fileInputRef"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        class="hidden"
        data-testid="image-input"
        @change="onSelectImage"
      />
      <!--
        場地圖上傳僅在本機 dev 模式可用（需 localFileApi plugin 寫檔）。
        靜態 GH Pages 模式下按鈕 disabled 並顯示提示說明。
      -->
      <button
        type="button"
        :disabled="isUploadingImage || isLocalApiAvailable === false"
        class="w-full px-3 py-1.5 rounded border-2 border-editor-accent/60
               hover:bg-editor-accent/10 disabled:opacity-50 disabled:cursor-not-allowed"
        @click="triggerFileInput"
      >
        {{
          isLocalApiAvailable === false
            ? '🔒 需本機模式'
            : isUploadingImage
              ? '上傳中…'
              : '選擇圖片'
        }}
      </button>
      <div v-if="arena.backgroundImage" class="mt-2 text-xs text-gray-400 break-all">
        當前：{{ arena.backgroundImage }}
      </div>
      <div class="text-xs text-gray-500 mt-1">
        <template v-if="isLocalApiAvailable === false">
          場地圖需管理員於本機模式處理；您可沿用已設定的圖片。
        </template>
        <template v-else>
          支援 PNG / JPG / WebP / GIF，最大 5 MB。
        </template>
      </div>
      <!-- 隱藏 - 僅用於連動 cache bust（避免未使用警告） -->
      <span class="hidden">{{ imagePreviewUrl }}</span>
    </section>

    <!-- ===== 已繪製輔助線 ===== -->
    <section>
      <label class="block text-xs text-gray-400 mb-1.5">
        輔助線（{{ lines.length }} 條）
      </label>
      <p v-if="lines.length === 0" class="text-xs text-gray-500 italic">
        在右側畫布上拖曳以繪製。
      </p>
      <ul v-else class="space-y-1" data-testid="lines-list">
        <li
          v-for="line in lines"
          :key="line.id"
          :data-line-id="line.id"
          class="flex items-center gap-2 p-2 rounded border-2 transition-colors text-xs"
          :class="
            selectedLineId === line.id
              ? 'border-editor-accent bg-editor-accent/15'
              : 'border-gray-700 hover:border-editor-accent/60'
          "
        >
          <button
            type="button"
            class="flex-1 text-left font-mono"
            @click="selectLine(line.id)"
          >
            ({{ Math.round(line.start.x) }}, {{ Math.round(line.start.y) }}) →
            ({{ Math.round(line.end.x) }}, {{ Math.round(line.end.y) }})
          </button>
          <button
            type="button"
            :data-line-delete="line.id"
            class="px-2 py-0.5 text-red-400 hover:bg-red-500/20 rounded"
            title="刪除"
            @click="removeLine(line.id)"
          >
            ✕
          </button>
        </li>
      </ul>
      <p v-if="selectedLineId" class="text-xs text-gray-500 mt-1.5">
        提示：按 Delete 鍵刪除選取的線。
      </p>
    </section>
  </div>
</template>
