<script setup lang="ts">
/**
 * Step 1：副本選擇器。
 *
 * 直接訂閱 settings store，避免父層做大量 props/emits 樣板程式碼。
 * 視覺：卡片式按鈕，selected 狀態用 ffxiv-accent 金色強調。
 */
import { storeToRefs } from 'pinia';
import { useSettingsStore } from '@/stores/settings';

const store = useSettingsStore();
const { index, selectedInstanceId, isLoadingIndex, indexError } = storeToRefs(store);

function onSelect(id: string): void {
  // 同副本重複點擊也允許 - 等於「重試載入該副本資料」
  void store.selectInstance(id);
}
</script>

<template>
  <section data-testid="instance-selector">
    <h2 class="text-lg font-bold text-ffxiv-accent mb-3">Step 1 · 選擇副本</h2>

    <!-- 載入中 -->
    <div v-if="isLoadingIndex" class="text-gray-400 py-4">載入副本列表中…</div>

    <!-- 載入失敗 -->
    <div
      v-else-if="indexError"
      class="bg-ffxiv-danger/20 border border-ffxiv-danger rounded p-3"
      role="alert"
    >
      <p class="text-ffxiv-danger font-bold mb-1">無法取得題庫列表</p>
      <p class="text-sm text-gray-200 mb-3">{{ indexError }}</p>
      <button
        type="button"
        class="px-3 py-1 bg-ffxiv-danger/40 hover:bg-ffxiv-danger/60 rounded text-sm"
        @click="store.loadIndex()"
      >
        重試
      </button>
    </div>

    <!-- 空清單防呆：載入成功但沒有任何副本 -->
    <div
      v-else-if="!index || index.instances.length === 0"
      class="text-gray-400 py-4"
    >
      目前題庫中沒有任何副本，請聯絡題庫維護者。
    </div>

    <!-- 副本卡片列表 -->
    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <button
        v-for="entry in index.instances"
        :key="entry.id"
        type="button"
        :data-instance-id="entry.id"
        class="text-left p-4 rounded border-2 transition-colors"
        :class="
          selectedInstanceId === entry.id
            ? 'border-ffxiv-accent bg-ffxiv-accent/10'
            : 'border-ffxiv-panel bg-ffxiv-panel/40 hover:border-ffxiv-accent/60'
        "
        @click="onSelect(entry.id)"
      >
        <div class="text-xs text-ffxiv-accent font-bold">{{ entry.shortName }}</div>
        <div class="text-base font-medium mt-1">{{ entry.name }}</div>
        <div v-if="entry.tags?.length" class="mt-2 flex flex-wrap gap-1">
          <span
            v-for="tag in entry.tags"
            :key="tag"
            class="text-xs px-2 py-0.5 bg-ffxiv-bg/60 text-gray-300 rounded"
          >{{ tag }}</span>
        </div>
      </button>
    </div>
  </section>
</template>
