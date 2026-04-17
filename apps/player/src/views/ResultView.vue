<script setup lang="ts">
/**
 * ========================================================================
 * ResultView - 結算畫面
 * ========================================================================
 * 三個區塊：
 *   1. Summary Board：總正確率 + FFXIV 風格評價
 *   2. Question List：逐題清單（綠✓/紅✗ + 耗時），點擊跳 /review/:index
 *   3. Actions：重新練習 / 回到設定
 *
 * 防呆：直接打 /result 但無作答紀錄 → redirect /setup
 * ========================================================================
 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ROLE_DISPLAY_NAME } from '@ffxiv-sim/shared';
import { useSessionStore } from '@/stores/session';
import { useSettingsStore } from '@/stores/settings';
import { calculateRating } from '@/utils/rating';
import { copyToClipboard } from '@/utils/clipboard';
import { buildShareUrl, encodeScorecard } from '@/utils/share';

const router = useRouter();
const session = useSessionStore();
const settings = useSettingsStore();

// 防呆：無紀錄 → 退回 setup
if (!session.hasRecordedAnswers) {
  void router.replace('/setup');
}

const result = computed(() => session.getResult());

const accuracyPercent = computed(() => {
  const r = result.value;
  if (!r || r.totalCount === 0) return 0;
  return Math.round((r.correctCount / r.totalCount) * 100);
});

const rating = computed(() => {
  const r = result.value;
  if (!r) return null;
  return calculateRating(r.correctCount, r.totalCount);
});

/**
 * 逐題清單資料 - 結合題目本體與 answer record。
 * 因為 ReviewView 透過 index 取資料，這裡也用 index 對齊。
 */
const itemRows = computed(() => {
  const r = result.value;
  if (!r) return [];
  return r.answers.map((ans, index) => {
    const q = session.questions[index];
    const elapsedMs = ans.finishedAt - ans.startedAt;
    return {
      index,
      questionName: q?.name ?? '(未知題目)',
      isCorrect: ans.isCorrect,
      timedOut: ans.timedOut,
      elapsedSeconds: (elapsedMs / 1000).toFixed(1),
    };
  });
});

function goReview(index: number): void {
  void router.push(`/review/${index}`);
}

/**
 * 重新練習 - 沿用相同副本/攻略/職能，清空答案重跑。
 *
 * 流程：
 *   1. session.restartSession() in-place 重置答案、進度、isPracticing
 *   2. push /practice，由 PracticeView 的 onMounted 重新呼叫 startSession
 *
 * Why 不直接 push /practice 讓 PracticeView 處理：因為 onMounted 內的
 *      startSession 會用「當前」settings 重組 payload，但若 store 仍有舊
 *      session 狀態（isPracticing=false），UI 會閃一下舊內容。
 *      restartSession 直接設好狀態避免閃爍。
 */
function retry(): void {
  session.restartSession();
  void router.push('/practice');
}

function backToSetup(): void {
  session.reset();
  settings.reset();
  void router.push('/setup');
}

// ----------------------------------------------------------------------
// 分享成績單
// ----------------------------------------------------------------------

/**
 * Toast 狀態 - 複製後顯示的短暫回饋。
 *   'idle'    : 閒置，按鈕顯示原始標籤
 *   'copied'  : 剛複製成功，顯示「已複製」
 *   'failed'  : 剪貼簿兩層 fallback 都失敗，顯示手動複製的 prompt
 *   'fallback-text' : 顯示可選取的 text input 讓使用者手動複製
 */
const copyState = ref<'idle' | 'copied' | 'failed'>('idle');
const shareUrlCache = ref('');

/**
 * 產生分享 URL 並寫入剪貼簿。
 *
 * 編碼失敗或剪貼簿兩層都失敗時，仍在畫面上顯示完整 URL 讓使用者手動複製。
 * 3 秒後自動重置 toast。
 */
async function onShare(): Promise<void> {
  const r = result.value;
  if (!r) return;

  const instanceName = settings.selectedInstanceEntry?.name ?? '未知副本';
  const strategyName = settings.selectedStrategy?.name ?? '未知攻略';

  try {
    const encoded = encodeScorecard(r, instanceName, strategyName);
    const url = buildShareUrl(encoded);
    shareUrlCache.value = url;

    const ok = await copyToClipboard(url);
    copyState.value = ok ? 'copied' : 'failed';
    // 2.5 秒後回閒置（toast 消失），但 shareUrlCache 保留供手動複製
    setTimeout(() => {
      copyState.value = 'idle';
    }, 2500);
  } catch {
    // encodeScorecard 理論上不會拋（除非極端異常輸入），保險起見仍 catch
    copyState.value = 'failed';
  }
}
</script>

<template>
  <div v-if="result" class="container mx-auto px-4 py-8 max-w-3xl">
    <!-- ========== Summary Board ========== -->
    <header
      data-testid="summary-board"
      class="bg-ffxiv-panel/40 border border-ffxiv-accent/40 rounded-lg p-8 mb-6 text-center"
    >
      <div
        v-if="rating"
        class="text-2xl font-bold mb-2"
        :class="rating.colorClass"
        data-testid="rating-label"
      >
        {{ rating.label }}
      </div>
      <div class="text-6xl font-bold text-ffxiv-accent my-4 tabular-nums">
        {{ accuracyPercent }}%
      </div>
      <div class="text-gray-300">
        正確 {{ result.correctCount }} / {{ result.totalCount }} 題
      </div>
      <div v-if="session.sessionMeta" class="text-xs text-gray-500 mt-3">
        {{ ROLE_DISPLAY_NAME[session.sessionMeta.roleId] }}
      </div>
    </header>

    <!-- ========== Question List ========== -->
    <section class="mb-6">
      <h2 class="text-lg font-bold text-ffxiv-accent mb-3">逐題回顧</h2>
      <ul class="space-y-2" data-testid="question-list">
        <li v-for="row in itemRows" :key="row.index">
          <button
            type="button"
            :data-question-row="row.index"
            class="w-full flex items-center gap-3 p-3 rounded border-2 transition-colors text-left
                   border-ffxiv-panel bg-ffxiv-panel/30 hover:border-ffxiv-accent/60"
            @click="goReview(row.index)"
          >
            <!-- 對錯標籤 -->
            <span
              class="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white shrink-0"
              :class="row.isCorrect ? 'bg-ffxiv-safe' : 'bg-ffxiv-danger'"
              :data-testid="row.isCorrect ? 'mark-correct' : 'mark-wrong'"
            >{{ row.isCorrect ? '○' : '✕' }}</span>
            <!-- 題目資訊 -->
            <div class="flex-1 min-w-0">
              <div class="text-sm text-gray-400">第 {{ row.index + 1 }} 題</div>
              <div class="font-medium truncate">{{ row.questionName }}</div>
            </div>
            <!-- 耗時與超時標籤 -->
            <div class="text-right text-sm shrink-0">
              <div class="font-mono tabular-nums text-gray-300">{{ row.elapsedSeconds }}s</div>
              <div v-if="row.timedOut" class="text-xs text-ffxiv-danger">超時</div>
            </div>
            <span class="text-gray-500 ml-1">›</span>
          </button>
        </li>
      </ul>
    </section>

    <!-- ========== Actions ========== -->
    <div class="flex flex-wrap justify-center gap-3">
      <button
        type="button"
        data-testid="retry-button"
        class="px-6 py-2 bg-ffxiv-accent text-ffxiv-bg rounded font-bold hover:bg-yellow-400"
        @click="retry"
      >
        重新練習
      </button>
      <button
        type="button"
        data-testid="share-button"
        class="px-6 py-2 bg-ffxiv-panel hover:bg-ffxiv-panel/70 rounded border border-ffxiv-accent/40"
        @click="onShare"
      >
        <template v-if="copyState === 'copied'">
          <span class="text-ffxiv-safe" data-testid="copy-toast-copied">✓ 已複製到剪貼簿</span>
        </template>
        <template v-else-if="copyState === 'failed'">
          <span class="text-ffxiv-danger" data-testid="copy-toast-failed">複製失敗，請手動複製</span>
        </template>
        <template v-else>
          📋 複製分享連結
        </template>
      </button>
      <button
        type="button"
        data-testid="back-setup-button"
        class="px-6 py-2 bg-ffxiv-panel hover:bg-ffxiv-panel/70 rounded"
        @click="backToSetup"
      >
        回到設定
      </button>
    </div>

    <!-- Clipboard 失敗 fallback：顯示可選取的 text input 讓使用者手動 Ctrl+C -->
    <div
      v-if="copyState === 'failed' && shareUrlCache"
      class="mt-4 max-w-xl mx-auto"
      data-testid="manual-copy-fallback"
    >
      <p class="text-xs text-gray-400 mb-1">您的瀏覽器無法自動寫入剪貼簿，請手動複製：</p>
      <input
        type="text"
        :value="shareUrlCache"
        readonly
        class="w-full bg-ffxiv-bg/60 border border-ffxiv-accent/40 rounded px-3 py-2 text-xs font-mono"
        @focus="($event.target as HTMLInputElement).select()"
      />
    </div>
  </div>
</template>
