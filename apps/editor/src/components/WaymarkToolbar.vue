<script setup lang="ts">
/**
 * Waymark 啟用/移除工具列。
 *
 * 8 個固定按鈕，每個按鈕有兩種狀態：
 *   - 已啟用（攻略中存在此 waymark）→ 顯示彩色 + 「移除」icon
 *   - 未啟用 → 顯示灰色 + 「+」icon，點擊新增到場地中央
 *
 * 拖曳座標調整由 EditableArenaMap 處理；此工具列僅管「存在 / 不存在」。
 */
import { storeToRefs } from 'pinia';
import type { WaymarkId } from '@ffxiv-sim/shared';
import { WAYMARK_COLOR, WAYMARK_IDS } from '@ffxiv-sim/shared';
import { useEditorStore } from '@/stores/editor';

const store = useEditorStore();
const { selectedStrategy, dataset, selectedStrategyId } = storeToRefs(store);

function isActive(id: WaymarkId): boolean {
  return selectedStrategy.value?.waymarks[id] !== undefined;
}

function toggle(id: WaymarkId): void {
  if (!selectedStrategyId.value || !dataset.value) return;
  if (isActive(id)) {
    store.removeWaymark(selectedStrategyId.value, id);
  } else {
    // 新增到場地中央 - 玩家拖到正確位置即可
    store.addWaymark(selectedStrategyId.value, id, { ...dataset.value.instance.arena.center });
  }
}
</script>

<template>
  <div data-testid="waymark-toolbar" class="flex flex-wrap gap-2">
    <button
      v-for="id in WAYMARK_IDS"
      :key="id"
      type="button"
      :data-waymark-toggle="id"
      :disabled="!selectedStrategyId"
      class="w-12 h-12 rounded border-2 font-bold flex items-center justify-center
             transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      :class="
        isActive(id)
          ? 'bg-opacity-30 ring-2 ring-offset-2 ring-offset-editor-bg'
          : 'bg-editor-panel border-gray-500 text-gray-400 hover:border-editor-accent'
      "
      :style="
        isActive(id)
          ? {
              backgroundColor: WAYMARK_COLOR[id] + '40',
              borderColor: WAYMARK_COLOR[id],
              color: WAYMARK_COLOR[id],
            }
          : {}
      "
      :title="isActive(id) ? `移除 ${id}` : `新增 ${id} 到場地中央`"
      @click="toggle(id)"
    >
      {{ id }}
    </button>
  </div>
</template>
