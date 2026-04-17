<script setup lang="ts">
/**
 * Step 2：攻略選擇器。
 *
 * 條件渲染：必須先選副本，且 dataset 已載入完成才會顯示選項。
 * 載入中與錯誤狀態獨立顯示，UX 上明確告知玩家「正在等什麼」。
 */
import { storeToRefs } from 'pinia';
import { useSettingsStore } from '@/stores/settings';

const store = useSettingsStore();
const {
  selectedInstanceId,
  selectedStrategyId,
  dataset,
  isLoadingDataset,
  datasetError,
} = storeToRefs(store);
</script>

<template>
  <section data-testid="strategy-selector">
    <h2
      class="text-lg font-bold mb-3"
      :class="selectedInstanceId ? 'text-ffxiv-accent' : 'text-gray-500'"
    >
      Step 2 · 選擇攻略
    </h2>

    <!-- 尚未選副本 - 顯示提示 -->
    <p v-if="!selectedInstanceId" class="text-sm text-gray-500 italic">
      請先完成 Step 1。
    </p>

    <!-- 載入中 -->
    <div v-else-if="isLoadingDataset" class="text-gray-400 py-4">載入副本資料中…</div>

    <!-- 載入失敗 -->
    <div
      v-else-if="datasetError"
      class="bg-ffxiv-danger/20 border border-ffxiv-danger rounded p-3"
      role="alert"
    >
      <p class="text-ffxiv-danger font-bold mb-1">副本資料載入失敗</p>
      <p class="text-sm text-gray-200 mb-3">{{ datasetError }}</p>
      <button
        type="button"
        class="px-3 py-1 bg-ffxiv-danger/40 hover:bg-ffxiv-danger/60 rounded text-sm"
        @click="store.selectInstance(selectedInstanceId)"
      >
        重試
      </button>
    </div>

    <!-- 空清單防呆 -->
    <div
      v-else-if="!dataset || dataset.strategies.length === 0"
      class="text-gray-400 py-4"
    >
      此副本目前沒有可用的攻略組。
    </div>

    <!-- 攻略列表 -->
    <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <button
        v-for="strategy in dataset.strategies"
        :key="strategy.id"
        type="button"
        :data-strategy-id="strategy.id"
        class="text-left p-4 rounded border-2 transition-colors"
        :class="
          selectedStrategyId === strategy.id
            ? 'border-ffxiv-accent bg-ffxiv-accent/10'
            : 'border-ffxiv-panel bg-ffxiv-panel/40 hover:border-ffxiv-accent/60'
        "
        @click="store.selectStrategy(strategy.id)"
      >
        <div class="text-base font-medium">{{ strategy.name }}</div>
        <div v-if="strategy.author" class="text-xs text-gray-400 mt-1">
          作者：{{ strategy.author }}
        </div>
        <div v-if="strategy.description" class="text-xs text-gray-300 mt-2">
          {{ strategy.description }}
        </div>
      </button>
    </div>
  </section>
</template>
