<script setup lang="ts">
/**
 * SharedScorecardView - 分享成績單唯讀頁面。
 *
 * 路由：/scorecard?data=<base64url>
 *
 * 任何人打連結都能看到分享者的成績，不依賴 store，也不需要先載過任何題庫。
 * 下方提供「我也要挑戰」按鈕導去 /setup 開始自己的練習。
 *
 * 防呆：
 *   - 無 data query 或解析失敗 → redirect /setup
 *   - 版本過新 → 顯示錯誤訊息並提供「回到首頁」按鈕（不 redirect，讓使用者看到原因）
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ROLE_DISPLAY_NAME } from '@ffxiv-sim/shared';
import { calculateRating } from '@/utils/rating';
import { ShareScorecardError, decodeScorecard, type SharedScorecard } from '@/utils/share';

const route = useRoute();
const router = useRouter();

const scorecard = ref<SharedScorecard | null>(null);

/**
 * 錯誤訊息（若為「version 不相容」等有意義錯誤才顯示；
 * 普通 invalid 直接 redirect 不顯示，避免引導攻擊者 debug URL 結構）。
 */
const errorMessage = ref<string | null>(null);

onMounted(() => {
  const raw = route.query.data;
  const encoded = typeof raw === 'string' ? raw : null;

  if (!encoded) {
    // 完全無資料 → 直接 redirect
    void router.replace('/setup');
    return;
  }

  try {
    scorecard.value = decodeScorecard(encoded);
  } catch (err) {
    if (err instanceof ShareScorecardError && err.reason === 'version') {
      // 版本不相容 → 顯示錯誤並提供導航，不 redirect
      errorMessage.value = err.message;
      return;
    }
    // 其他錯誤（invalid / decode / too-large）→ 靜默 redirect
    // Why 不顯示：這些多半是連結被截斷或惡意竄改，引導玩家 debug 沒意義
    void router.replace('/setup');
  }
});

const accuracyPercent = computed(() => {
  const s = scorecard.value;
  if (!s || s.t === 0) return 0;
  return Math.round((s.c / s.t) * 100);
});

const rating = computed(() => {
  const s = scorecard.value;
  if (!s) return null;
  return calculateRating(s.c, s.t);
});

/**
 * 完成日期顯示 - 玩家資訊用，取日期部分即可（精確到時間太侵犯隱私）。
 */
const completedDate = computed(() => {
  const s = scorecard.value;
  if (!s) return '';
  const date = new Date(s.d);
  if (Number.isNaN(date.getTime())) return '';
  // zh-TW locale 格式：2025/1/15
  return date.toLocaleDateString('zh-TW');
});

function goPractice(): void {
  void router.push('/setup');
}
</script>

<template>
  <div class="container mx-auto px-4 py-12 max-w-2xl">
    <!-- 錯誤狀態（僅版本不相容會進入此分支） -->
    <div
      v-if="errorMessage"
      data-testid="scorecard-error"
      class="bg-ffxiv-danger/20 border border-ffxiv-danger rounded-lg p-6 text-center"
    >
      <div class="text-xl font-bold text-ffxiv-danger mb-2">無法顯示分享成績</div>
      <p class="text-sm text-gray-200 mb-4">{{ errorMessage }}</p>
      <button
        type="button"
        class="px-5 py-2 bg-ffxiv-accent text-ffxiv-bg rounded font-bold"
        @click="goPractice"
      >
        回到首頁
      </button>
    </div>

    <!-- 正常顯示 -->
    <div v-else-if="scorecard" data-testid="scorecard-content">
      <!-- 分享者成績卡片 -->
      <div
        class="bg-ffxiv-panel/40 border border-ffxiv-accent/40 rounded-lg p-8 text-center mb-6"
        data-testid="shared-scorecard-board"
      >
        <div class="text-xs text-gray-400 mb-2">分享的挑戰成績</div>

        <div
          v-if="rating"
          class="text-2xl font-bold mb-3"
          :class="rating.colorClass"
          data-testid="rating-label"
        >
          {{ rating.label }}
        </div>

        <div class="text-7xl font-bold text-ffxiv-accent my-4 tabular-nums">
          {{ accuracyPercent }}%
        </div>
        <div class="text-gray-300 mb-6">
          正確 <span class="font-bold text-white">{{ scorecard.c }}</span>
          / {{ scorecard.t }} 題
        </div>

        <!-- 副本 / 攻略 / 職能 -->
        <div class="space-y-1 text-sm border-t border-ffxiv-accent/20 pt-4">
          <div>
            <span class="text-gray-500">副本：</span>
            <span class="text-ffxiv-accent">{{ scorecard.i }}</span>
          </div>
          <div>
            <span class="text-gray-500">攻略：</span>
            <span class="text-ffxiv-accent">{{ scorecard.s }}</span>
          </div>
          <div>
            <span class="text-gray-500">職能：</span>
            <span class="text-ffxiv-accent">
              {{ ROLE_DISPLAY_NAME[scorecard.r] ?? scorecard.r }}
            </span>
          </div>
          <div v-if="completedDate" class="text-xs text-gray-500 pt-2">
            完成於 {{ completedDate }}
          </div>
        </div>
      </div>

      <!-- Call to Action -->
      <div class="text-center">
        <button
          type="button"
          data-testid="try-it-button"
          class="px-8 py-3 rounded-lg text-lg font-bold bg-ffxiv-accent text-ffxiv-bg
                 hover:bg-yellow-400 transition-colors shadow-lg"
          @click="goPractice"
        >
          我也要挑戰 ⚔️
        </button>
        <p class="text-xs text-gray-500 mt-3">
          選擇副本、攻略與職能，開始屬於你的機制練習
        </p>
      </div>
    </div>

    <!-- 載入中（短暫，onMounted 解析快） -->
    <div v-else class="text-center text-gray-400 py-16">解析分享資料中…</div>
  </div>
</template>
