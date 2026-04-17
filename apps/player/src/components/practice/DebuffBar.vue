<script setup lang="ts">
/**
 * 玩家身上 Debuff 狀態列。
 *
 * 接收 debuff ID 陣列與 debuff 定義庫，渲染成圖示列。
 * 圖示載入失敗時 fallback 為帶名稱的純色方塊（CLAUDE.md 第 9 點）。
 */
import { computed, reactive } from 'vue';
import type { DebuffDefinition } from '@ffxiv-sim/shared';

interface Props {
  /** 玩家身上的 debuff ID 陣列 */
  debuffIds: string[];
  /** 該副本的 debuff 定義庫，用於查詢圖示與名稱 */
  library: DebuffDefinition[];
}

const props = defineProps<Props>();

/**
 * 將 ID 解析為完整的 debuff 物件；無對應定義者過濾掉。
 * Why filter 掉而非顯示「未知 debuff」：未知 debuff 通常是出題資料 bug，
 *      在玩家畫面顯示反而干擾，由開發 console 追查即可。
 */
const debuffs = computed(() =>
  props.debuffIds
    .map((id) => props.library.find((d) => d.id === id))
    .filter((d): d is DebuffDefinition => d !== undefined),
);

/**
 * 各 debuff 圖示是否載入失敗的旗標表（key = debuff id）。
 * Why reactive object 而非 ref(Map)：模板中存取 `failed[id]` 較直觀。
 */
const failed = reactive<Record<string, boolean>>({});

function onError(id: string): void {
  failed[id] = true;
}
</script>

<template>
  <div data-testid="debuff-bar" class="flex gap-2 items-center min-h-[3rem]">
    <span v-if="debuffs.length === 0" class="text-sm text-gray-500 italic">
      （無 Debuff）
    </span>
    <div
      v-for="d in debuffs"
      :key="d.id"
      class="flex flex-col items-center"
      :title="d.description ?? d.name"
    >
      <!-- 有效圖示 → 顯示 <img>；失敗則顯示 fallback -->
      <img
        v-if="d.icon && !failed[d.id]"
        :src="d.icon"
        :alt="d.name"
        class="w-12 h-12 rounded border border-ffxiv-accent/40 bg-ffxiv-bg"
        @error="onError(d.id)"
      />
      <div
        v-else
        class="w-12 h-12 rounded border border-ffxiv-danger/60 bg-ffxiv-danger/30
               flex items-center justify-center text-[10px] text-white text-center px-1 leading-tight"
      >
        {{ d.name }}
      </div>
      <span v-if="d.duration" class="text-xs text-gray-300 mt-1 font-mono">
        {{ d.duration }}s
      </span>
    </div>
  </div>
</template>
