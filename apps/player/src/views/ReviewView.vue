<script setup lang="ts">
/**
 * ========================================================================
 * ReviewView - 逐題回顧畫面
 * ========================================================================
 *
 * 路由：/review/:index  - index 是 session.answers 陣列的 0-based 位置。
 *
 * 三個區塊：
 *   1. Header：題目名稱、Boss 技能、玩家職能、對錯標示
 *   2. Explanation：roleSolution.note 機制解析（無則顯示提示）
 *   3. Visual Diff：ArenaMap review 模式 - 同時顯示 userClicks 與 safeAreas
 *   4. Navigation：上一題/下一題/回結算
 *
 * 防呆：
 *   - 無 session 紀錄 → redirect /setup
 *   - index 越界或對應題目錯位 → redirect /result
 *
 * 【為何 index 從 props 接收而非 useRoute().params.index】
 *   router 設定中宣告 props: true，Vue Router 會自動把 params 注入 props，
 *   讓元件對「資料來源」更解耦，且 props 變動時 Vue 會自動觸發 reactivity，
 *   不需手動 watch route.params。這對「上/下一題」按鈕更新 URL 後重渲染特別關鍵。
 * ========================================================================
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import {
  ROLE_DISPLAY_NAME,
  type ChoiceQuestion,
  type ChoiceRoleSolution,
} from '@ffxiv-sim/shared';
import { useSessionStore } from '@/stores/session';
import { useSettingsStore } from '@/stores/settings';
import ArenaMap from '@/components/ArenaMap.vue';
import ChoiceReviewPanel from '@/components/review/ChoiceReviewPanel.vue';

interface Props {
  /** 路由參數 - 從字串轉數字 */
  index: string;
}

const props = defineProps<Props>();
const router = useRouter();
const session = useSessionStore();
const settings = useSettingsStore();

// 防呆：無作答紀錄 → 退回 setup
if (!session.hasRecordedAnswers) {
  void router.replace('/setup');
}

/** 將 props.index 轉為數字，無效時設為 -1 觸發後續防呆 */
const indexNum = computed(() => {
  const n = Number.parseInt(props.index, 10);
  return Number.isNaN(n) ? -1 : n;
});

/** 取出當題的完整資料（題目 / 玩家答案 / 該職能解答） */
const item = computed(() => session.getReviewItem(indexNum.value));

/**
 * 玩家點擊軌跡 - 從 AnswerRecord 萃取 Point2D 陣列。
 * 僅 map-click 題型有 clicks；其他題型回傳空陣列。
 */
const userClicks = computed(() => {
  const ans = item.value?.answer.answer;
  if (!ans || ans.type !== 'map-click') return [];
  return ans.clicks.map((c) => c.position);
});

/**
 * 該職能的安全區 - 僅 map-click 題型有；其他題型 ArenaMap 收到空陣列即可。
 */
const safeAreas = computed(() => {
  const sol = item.value?.solution;
  if (!sol || !('safeAreas' in sol)) return [];
  return sol.safeAreas;
});

/** 該職能的解析文字 */
const note = computed(() => item.value?.solution?.note ?? null);

/** 上一題 / 下一題的 index（null 表示沒有） */
const prevIndex = computed(() =>
  indexNum.value > 0 ? indexNum.value - 1 : null,
);

const nextIndex = computed(() =>
  indexNum.value < session.answers.length - 1 ? indexNum.value + 1 : null,
);

// 攻略資料 - 從 settings store 讀取，給 ArenaMap 的 waymarks 用
// 注意：玩家做完一場練習後可能已切走 settings，但 dataset 仍保留在 store 內
const strategy = computed(() => settings.selectedStrategy);
const arena = computed(() => settings.dataset?.instance.arena);

/** 是否為地圖題（決定 visual diff 區塊用 ArenaMap 或文字對照） */
const isMapClickQuestion = computed(() => item.value?.question.type === 'map-click');

/** 選擇/排序題：玩家作答的選項 ID 陣列 */
const playerSelectedIds = computed<string[]>(() => {
  const ans = item.value?.answer.answer;
  if (!ans || ans.type === 'map-click') return [];
  return ans.selectedOptionIds;
});

function goPrev(): void {
  if (prevIndex.value !== null) {
    void router.push(`/review/${prevIndex.value}`);
  }
}

function goNext(): void {
  if (nextIndex.value !== null) {
    void router.push(`/review/${nextIndex.value}`);
  }
}

function backToResults(): void {
  void router.push('/result');
}
</script>

<template>
  <div v-if="item" class="container mx-auto px-4 py-6 max-w-5xl">
    <!-- ========== Header ========== -->
    <header class="mb-4 flex flex-wrap justify-between items-start gap-3">
      <div>
        <div class="text-sm text-gray-400">
          第 {{ indexNum + 1 }} 題 / 共 {{ session.answers.length }} 題
          <span v-if="session.sessionMeta">
            · {{ ROLE_DISPLAY_NAME[session.sessionMeta.roleId] }}
          </span>
        </div>
        <div class="text-xl font-bold text-ffxiv-accent mt-1">{{ item.question.name }}</div>
        <div class="text-sm text-gray-300">
          技能：{{ item.question.boss.skillName }}
        </div>
      </div>
      <div
        class="px-4 py-2 rounded font-bold text-white shrink-0"
        :class="item.answer.isCorrect ? 'bg-ffxiv-safe' : 'bg-ffxiv-danger'"
        data-testid="result-badge"
      >
        {{ item.answer.isCorrect ? '○ 正確' : '✕ 失誤' }}
        <span v-if="item.answer.timedOut" class="text-xs ml-1">(超時)</span>
      </div>
    </header>

    <!-- ========== Explanation ========== -->
    <section
      data-testid="explanation"
      class="bg-ffxiv-panel/40 rounded-lg p-4 mb-4 border-l-4 border-ffxiv-accent"
    >
      <div class="text-xs text-ffxiv-accent font-bold mb-1">機制解析</div>
      <p v-if="note" class="text-sm text-gray-200 leading-relaxed">{{ note }}</p>
      <p v-else class="text-sm text-gray-500 italic">
        （此題尚未提供機制解析）
      </p>
    </section>

    <!-- ========== Visual Diff ========== -->
    <!-- 地圖題：ArenaMap 疊圖 -->
    <div
      v-if="isMapClickQuestion && arena"
      data-testid="visual-diff-map"
      class="bg-ffxiv-bg rounded-lg overflow-hidden aspect-square max-w-[640px] mx-auto mb-4"
    >
      <ArenaMap
        mode="review"
        :arena="arena"
        :waymarks="strategy?.waymarks ?? {}"
        :boss-facing="item.question.boss.facing"
        :boss-position="item.question.boss.position"
        :user-clicks="userClicks"
        :safe-areas="safeAreas"
        :enemies="item.question.enemies ?? []"
        :arena-mask="item.question.arenaMask ?? []"
        :tethers="item.question.tethers ?? []"
        :anchors="item.question.anchors ?? []"
      />
    </div>

    <!-- 地圖題圖例 -->
    <div
      v-if="isMapClickQuestion"
      class="flex justify-center gap-4 text-xs text-gray-400 mb-6"
    >
      <span class="flex items-center gap-1">
        <span class="w-3 h-3 rounded-full bg-ffxiv-safe inline-block" /> 正確安全區
      </span>
      <span class="flex items-center gap-1">
        <span class="w-3 h-3 rounded-full bg-ffxiv-danger inline-block" /> 您的點擊位置
      </span>
    </div>

    <!-- 選擇/排序題：文字對照清單 -->
    <div
      v-else-if="item.solution"
      data-testid="visual-diff-choice"
      class="max-w-2xl mx-auto mb-6"
    >
      <ChoiceReviewPanel
        :question="(item.question as ChoiceQuestion)"
        :solution="(item.solution as ChoiceRoleSolution)"
        :player-selected-ids="playerSelectedIds"
        :is-correct="item.answer.isCorrect"
      />
    </div>

    <!-- ========== Navigation ========== -->
    <div class="flex justify-between items-center gap-3">
      <button
        type="button"
        data-testid="prev-button"
        class="px-4 py-2 rounded transition-colors"
        :class="
          prevIndex !== null
            ? 'bg-ffxiv-panel hover:bg-ffxiv-panel/70'
            : 'bg-gray-700 text-gray-500 cursor-not-allowed'
        "
        :disabled="prevIndex === null"
        @click="goPrev"
      >
        ← 上一題
      </button>
      <button
        type="button"
        data-testid="back-results-button"
        class="px-4 py-2 bg-ffxiv-accent text-ffxiv-bg rounded font-bold hover:bg-yellow-400"
        @click="backToResults"
      >
        回到結算
      </button>
      <button
        type="button"
        data-testid="next-button"
        class="px-4 py-2 rounded transition-colors"
        :class="
          nextIndex !== null
            ? 'bg-ffxiv-panel hover:bg-ffxiv-panel/70'
            : 'bg-gray-700 text-gray-500 cursor-not-allowed'
        "
        :disabled="nextIndex === null"
        @click="goNext"
      >
        下一題 →
      </button>
    </div>
  </div>

  <!-- 載入中或防呆狀態 -->
  <div v-else class="container mx-auto px-4 py-8 text-center text-gray-400">
    載入中…
  </div>
</template>
