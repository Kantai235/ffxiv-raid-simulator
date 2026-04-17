<script setup lang="ts">
/**
 * ========================================================================
 * PracticeView - 練習畫面（Gameplay Loop）
 * ========================================================================
 *
 * 職責：
 *   1. 從 settings store 取設定 + dataset → 啟動 session
 *   2. 驅動 requestAnimationFrame 倒數計時，呼叫 store.tick()
 *   3. 結算後延遲 1.5 秒讓玩家看回饋，再進下一題或跳 /result
 *   4. 渲染 4 個區塊：Header / CastBar / DebuffBar / ArenaMap
 *
 * 【計時器生命週期管理】
 *   RAF handle 與「結算後延遲」的 setTimeout handle 各保留一個 ref：
 *     - onMounted 啟動 RAF；onBeforeUnmount 取消
 *     - watch(currentIndex) 切題時不需重啟 RAF（store 內 timeRemaining 已被
 *       loadCurrentQuestion 重設，下一幀 tick 就會繼續扣）
 *     - watch(isCurrentEvaluated) 監聽結算事件，啟動延遲跳題；切題前清掉舊 timeout
 *     - 元件卸載時兩種 handle 都要 cleanup，避免記憶體洩漏與「跳到別頁後仍觸發 nextQuestion」
 * ========================================================================
 */

import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRouter } from 'vue-router';
import { ROLE_DISPLAY_NAME, type ChoiceQuestion } from '@ffxiv-sim/shared';
import { useSettingsStore } from '@/stores/settings';
import { useSessionStore } from '@/stores/session';
import ArenaMap from '@/components/ArenaMap.vue';
import BossCastBar from '@/components/practice/BossCastBar.vue';
import DebuffBar from '@/components/practice/DebuffBar.vue';
import ChoiceAnswerPanel from '@/components/practice/ChoiceAnswerPanel.vue';

const router = useRouter();
const settings = useSettingsStore();
const session = useSessionStore();

const {
  selectedInstanceEntry,
  selectedStrategy,
  selectedRoleId,
  dataset,
  canStart,
} = storeToRefs(settings);

const {
  currentQuestion,
  currentRoleSolution,
  currentClicks,
  timeRemaining,
  progressPercent,
  currentIndex,
  questions,
  isPracticing,
  isCurrentEvaluated,
  isLastQuestion,
} = storeToRefs(session);

// ----------------------------------------------------------------------
// 防呆：未完成 wizard 直接打 /practice
// ----------------------------------------------------------------------

if (!canStart.value || !dataset.value) {
  void router.replace('/setup');
}

// ----------------------------------------------------------------------
// 計時器資源 - 在元件 scope 內持有，cleanup 時逐一清理
// ----------------------------------------------------------------------

/** RAF handle，cancelAnimationFrame 用 */
let rafHandle: number | null = null;

/** 上次 RAF 回呼的時間戳（performance.now()），算 delta 用 */
let lastFrameTimestamp = 0;

/** 結算後延遲跳下一題的 setTimeout handle */
let advanceTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

/** 結算後等多久再跳下一題（毫秒） - 給玩家看反饋 */
const ADVANCE_DELAY_MS = 1500;

// ----------------------------------------------------------------------
// RAF 計時迴圈
// ----------------------------------------------------------------------

/**
 * RAF 回呼 - 每幀算 delta 後呼叫 store.tick。
 *
 * Why 用 performance.now() 而非 RAF 提供的 timestamp：兩者同源（皆為高精度時鐘），
 *      但取 performance.now() 更顯式，且測試環境 mock 時較直觀。
 *
 * 邊界：lastFrameTimestamp === 0 表第一幀，delta 設 0 避免大躍進。
 */
function rafLoop(): void {
  const now = performance.now();
  const delta = lastFrameTimestamp === 0 ? 0 : now - lastFrameTimestamp;
  lastFrameTimestamp = now;
  session.tick(delta);
  rafHandle = requestAnimationFrame(rafLoop);
}

function startTimer(): void {
  stopTimer(); // 防止重複啟動造成多 RAF 同時跑
  lastFrameTimestamp = 0;
  rafHandle = requestAnimationFrame(rafLoop);
}

function stopTimer(): void {
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
}

function clearAdvanceTimeout(): void {
  if (advanceTimeoutHandle !== null) {
    clearTimeout(advanceTimeoutHandle);
    advanceTimeoutHandle = null;
  }
}

// ----------------------------------------------------------------------
// 生命週期
// ----------------------------------------------------------------------

onMounted(() => {
  if (!canStart.value || !dataset.value) return;

  // session.startSession 過濾後若該攻略無題目，會回 false。
  // 此時不該卡在「準備中…」，而是退回 /setup 並把錯誤訊息帶回 settings store
  // 讓 SetupView 顯示「該攻略尚無題目可練」提示。
  const ok = session.startSession({
    questions: dataset.value.questions,
    instanceId: settings.selectedInstanceId!,
    strategyId: settings.selectedStrategyId!,
    roleId: settings.selectedRoleId!,
  });
  if (!ok) {
    settings.datasetError = '此攻略目前沒有任何題目，請選擇其他攻略或聯絡管理員出題';
    void router.replace('/setup');
    return;
  }
  startTimer();
});

onBeforeUnmount(() => {
  // 清理所有計時器資源 - 這是避免記憶體洩漏與幽靈回呼的關鍵
  stopTimer();
  clearAdvanceTimeout();
});

// ----------------------------------------------------------------------
// 監聽結算事件 → 延遲跳下一題
// ----------------------------------------------------------------------

watch(isCurrentEvaluated, (evaluated) => {
  if (!evaluated) return;
  // 切題前若有舊延遲未觸發，先清掉（理論上不會發生但防呆）
  clearAdvanceTimeout();
  advanceTimeoutHandle = setTimeout(() => {
    const advanced = session.nextQuestion();
    if (!advanced) {
      // 已是最後一題 → 結束 session，跳結算
      stopTimer();
      void router.push('/result');
    }
  }, ADVANCE_DELAY_MS);
});

// 切題時清掉舊的延遲 timeout（雙保險）
watch(currentIndex, () => {
  clearAdvanceTimeout();
});

// ----------------------------------------------------------------------
// 顯示用 computed
// ----------------------------------------------------------------------

const progressLabel = computed(
  () => `Question ${currentIndex.value + 1} / ${questions.value.length}`,
);

const debuffIds = computed(() => currentRoleSolution.value?.debuffs ?? []);

/**
 * 結算後的視覺反饋色：對 = 綠、錯 = 紅、未結算 = 透明。
 */
const feedbackBorderClass = computed(() => {
  if (!isCurrentEvaluated.value) return '';
  const last = session.answers[session.answers.length - 1];
  if (!last) return '';
  return last.isCorrect ? 'ring-4 ring-ffxiv-safe' : 'ring-4 ring-ffxiv-danger';
});

function onArenaClick(point: { x: number; y: number }): void {
  session.recordClick(point);
}

/**
 * 「提交答案」按鈕 - 僅選擇/排序題顯示。
 * 地圖題不需要此按鈕（玩家點擊即作答，由超時或下一題自動結算）。
 *
 * Why 選擇題需要明確提交時機：玩家選擇後可能想改，無法用「點完就算」
 *      的策略；超時自動結算固然存在，但玩家確定答案時應能即時提交。
 */
function submitChoice(): void {
  if (isCurrentEvaluated.value) return;
  session.evaluateCurrentQuestion();
}

const isMapClickQuestion = computed(() => currentQuestion.value?.type === 'map-click');
</script>

<template>
  <div v-if="isPracticing && currentQuestion" class="container mx-auto px-4 py-4 max-w-6xl">
    <!-- ===== Header ===== -->
    <header class="flex flex-wrap justify-between items-center gap-3 mb-4">
      <div>
        <div class="text-sm text-gray-400">
          {{ selectedInstanceEntry?.name }} · {{ selectedStrategy?.name }} ·
          {{ selectedRoleId ? ROLE_DISPLAY_NAME[selectedRoleId] : '' }}
        </div>
        <div class="text-base font-bold text-ffxiv-accent">
          {{ currentQuestion.name }}
          <span v-if="isLastQuestion" class="text-xs text-ffxiv-danger ml-2">（最後一題）</span>
        </div>
      </div>
      <div class="text-sm text-gray-300 font-mono" data-testid="progress-label">
        {{ progressLabel }}
      </div>
    </header>

    <!-- ===== Boss Cast Bar ===== -->
    <BossCastBar
      class="mb-4"
      :skill-name="currentQuestion.boss.skillName"
      :time-remaining="timeRemaining"
      :progress-percent="progressPercent"
      :total-cast-time="currentQuestion.boss.castTime"
    />

    <!-- ===== Debuff Bar ===== -->
    <div class="bg-ffxiv-panel/40 rounded-lg p-3 mb-4">
      <div class="text-xs text-gray-400 mb-2">您身上的 Debuff</div>
      <DebuffBar :debuff-ids="debuffIds" :library="dataset?.debuffLibrary ?? []" />
    </div>

    <!-- ===== 作答區 - 依題型分派 ===== -->
    <!-- 地圖題：ArenaMap -->
    <div
      v-if="isMapClickQuestion"
      class="bg-ffxiv-bg rounded-lg overflow-hidden aspect-square max-w-[640px] mx-auto transition-shadow"
      :class="feedbackBorderClass"
      data-testid="answer-area-map"
    >
      <ArenaMap
        v-if="dataset"
        :mode="isCurrentEvaluated ? 'review' : 'interactive'"
        :arena="dataset.instance.arena"
        :waymarks="selectedStrategy?.waymarks ?? {}"
        :boss-facing="currentQuestion.boss.facing"
        :boss-position="currentQuestion.boss.position"
        :user-clicks="currentClicks"
        :safe-areas="
          isCurrentEvaluated && currentRoleSolution && 'safeAreas' in currentRoleSolution
            ? currentRoleSolution.safeAreas
            : []
        "
        :enemies="currentQuestion.enemies ?? []"
        :arena-mask="currentQuestion.arenaMask ?? []"
        :tethers="currentQuestion.tethers ?? []"
        :anchors="currentQuestion.anchors ?? []"
        @click="onArenaClick"
      />
    </div>

    <!-- 選擇/排序題：ChoiceAnswerPanel + 提交按鈕 -->
    <div
      v-else
      class="max-w-2xl mx-auto rounded-lg p-4 transition-shadow"
      :class="feedbackBorderClass"
      data-testid="answer-area-choice"
    >
      <ChoiceAnswerPanel :question="(currentQuestion as ChoiceQuestion)" />
      <div class="mt-4 flex justify-end">
        <button
          type="button"
          data-testid="submit-choice-button"
          :disabled="isCurrentEvaluated"
          class="px-6 py-2 rounded font-bold transition-colors
                 disabled:opacity-50 disabled:cursor-not-allowed"
          :class="
            isCurrentEvaluated
              ? 'bg-gray-600 text-gray-300'
              : 'bg-ffxiv-accent text-ffxiv-bg hover:bg-yellow-400'
          "
          @click="submitChoice"
        >
          提交答案
        </button>
      </div>
    </div>

    <!-- 結算後的 toast -->
    <div
      v-if="isCurrentEvaluated"
      class="mt-4 text-center text-lg font-bold"
      :class="
        session.answers[session.answers.length - 1]?.isCorrect
          ? 'text-ffxiv-safe'
          : 'text-ffxiv-danger'
      "
    >
      {{
        session.answers[session.answers.length - 1]?.isCorrect
          ? '✓ 正確！'
          : '✗ 失誤'
      }}
    </div>
  </div>

  <!-- 載入中或防呆狀態 -->
  <div v-else class="container mx-auto px-4 py-8 text-center text-gray-400">
    準備中…
  </div>
</template>
