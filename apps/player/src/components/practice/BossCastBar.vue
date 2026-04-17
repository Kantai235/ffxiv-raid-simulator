<script setup lang="ts">
/**
 * Boss 詠唱條 - 顯示技能名稱與倒數進度。
 *
 * 視覺：當剩餘時間 < 30% 時轉紅，模擬「即將施放」的緊迫感。
 * 純展示元件，不持有計時邏輯（計時由 PracticeView 驅動 store）。
 */
import { computed } from 'vue';

interface Props {
  skillName: string;
  /** 剩餘秒數 */
  timeRemaining: number;
  /** 進度百分比 (0~100)，由 store.progressPercent 提供 */
  progressPercent: number;
  /** 總讀條時間，用於顯示「3.2 / 8.0」格式 */
  totalCastTime: number;
}

const props = defineProps<Props>();

/** 緊迫狀態：剩餘時間少於 30% → 變紅 */
const isUrgent = computed(() => props.timeRemaining / props.totalCastTime < 0.3);
</script>

<template>
  <div class="bg-ffxiv-panel/80 border border-ffxiv-accent/40 rounded-lg p-3">
    <div class="flex justify-between items-center mb-2">
      <span class="text-base font-bold text-ffxiv-accent">{{ skillName }}</span>
      <span
        class="text-sm font-mono tabular-nums"
        :class="isUrgent ? 'text-ffxiv-danger' : 'text-gray-300'"
      >
        {{ timeRemaining.toFixed(1) }}s / {{ totalCastTime.toFixed(1) }}s
      </span>
    </div>
    <!-- 進度條外框 -->
    <div class="h-3 bg-ffxiv-bg/80 rounded overflow-hidden border border-ffxiv-accent/20">
      <!--
        進度條內條：寬度反映 progressPercent。
        Why 用 width 而非 transform：transform 雖效能稍佳，但 width 動畫
            在 Tailwind 下可直接用 transition-all，且讀條不是高頻動畫，效能差異可忽略。
      -->
      <div
        class="h-full transition-all duration-100 ease-linear"
        :class="isUrgent ? 'bg-ffxiv-danger' : 'bg-ffxiv-accent'"
        :style="{ width: `${progressPercent}%` }"
        :data-testid="'cast-bar-fill'"
      />
    </div>
  </div>
</template>
