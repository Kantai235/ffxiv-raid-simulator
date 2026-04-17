<script setup lang="ts">
/**
 * ========================================================================
 * ChoiceReviewPanel - 選擇/排序題的回顧文字對照
 * ========================================================================
 *
 * 替代地圖題的 ArenaMap 疊圖，給玩家「玩家答 vs 正確答」的清晰文字對照。
 *
 * 視覺策略：
 *   - 完全正確 → 玩家清單整體綠色
 *   - 有錯誤   → 玩家錯選/錯排的選項紅色標註
 *   - 正確答案區塊永遠綠色
 *
 * 排序題的「錯」判定 = 該位置的 ID 與正解該位置的 ID 不同。
 * 多選題的「錯」判定 = 玩家選了但不在正解內，或正解有但玩家漏選。
 * ========================================================================
 */
import { computed } from 'vue';
import type { ChoiceQuestion, ChoiceRoleSolution, QuestionOption } from '@ffxiv-sim/shared';

interface Props {
  question: ChoiceQuestion;
  solution: ChoiceRoleSolution;
  /** 玩家的作答 ID 陣列（從 AnswerRecord 萃取） */
  playerSelectedIds: string[];
  /** 玩家整題是否答對 */
  isCorrect: boolean;
}

const props = defineProps<Props>();

/** id → option 物件的查表 */
const optionMap = computed<Record<string, QuestionOption>>(() => {
  const m: Record<string, QuestionOption> = {};
  for (const o of props.question.options) m[o.id] = o;
  return m;
});

const correctIds = computed(() => props.solution.correctOptionIds);

/**
 * 判斷玩家某選項是否「錯」- 依題型策略：
 *   - single/multi：玩家選了但不在解答內 → 錯
 *   - ordering    ：該位置的 ID 與解答對應位置不同 → 錯
 *
 * @param id   選項 ID
 * @param idx  該選項在玩家陣列中的 index（排序題用）
 */
function isPlayerOptionWrong(id: string, idx: number): boolean {
  if (props.question.type === 'ordering') {
    return correctIds.value[idx] !== id;
  }
  return !correctIds.value.includes(id);
}

/**
 * 多選題：玩家漏選的 ID（在解答內但玩家沒選）。
 * 排序題不適用（順序錯就是錯，不算「漏」）。
 */
const missedIds = computed(() => {
  if (props.question.type !== 'multi-choice') return [];
  const selectedSet = new Set(props.playerSelectedIds);
  return correctIds.value.filter((id) => !selectedSet.has(id));
});

/** 顯示「玩家答」清單的 label - 排序題保留順序，其他題型用原始 options 順序 */
const playerDisplayItems = computed(() => {
  if (props.question.type === 'ordering') {
    return props.playerSelectedIds.map((id) => ({ id, label: optionMap.value[id]?.label ?? id }));
  }
  // 單/多選：依原始 options 順序顯示玩家選了哪些（避免每次顯示順序跳動）
  const selectedSet = new Set(props.playerSelectedIds);
  return props.question.options
    .filter((o) => selectedSet.has(o.id))
    .map((o) => ({ id: o.id, label: o.label }));
});

/** 顯示「正解」清單 - 排序題保留順序 */
const correctDisplayItems = computed(() =>
  correctIds.value.map((id) => ({ id, label: optionMap.value[id]?.label ?? id })),
);

const isOrdering = computed(() => props.question.type === 'ordering');
</script>

<template>
  <div data-testid="choice-review-panel" class="space-y-4">
    <!-- 玩家作答 -->
    <section>
      <h3 class="text-sm font-bold text-gray-300 mb-2">您的作答</h3>
      <div
        v-if="playerDisplayItems.length === 0"
        class="p-3 rounded border-2 border-ffxiv-danger/60 bg-red-500/10 text-red-400 text-sm italic"
        data-testid="player-empty"
      >
        （未作答）
      </div>
      <component
        v-else
        :is="isOrdering ? 'ol' : 'ul'"
        class="space-y-1.5"
      >
        <li
          v-for="(item, idx) in playerDisplayItems"
          :key="item.id"
          :data-testid="
            isPlayerOptionWrong(item.id, idx) ? 'player-wrong-item' : 'player-right-item'
          "
          class="p-2 rounded border-2 flex items-center gap-2"
          :class="
            isPlayerOptionWrong(item.id, idx)
              ? 'border-red-500 bg-red-500/10 text-red-400'
              : 'border-green-500 bg-green-500/10 text-green-300'
          "
        >
          <span v-if="isOrdering" class="font-bold w-5 text-center">{{ idx + 1 }}.</span>
          <span class="flex-1">{{ item.label }}</span>
          <span class="text-xs">
            {{ isPlayerOptionWrong(item.id, idx) ? '✕' : '✓' }}
          </span>
        </li>
      </component>

      <!-- 多選漏選提示 -->
      <div
        v-if="missedIds.length > 0"
        class="mt-2 text-xs text-red-400"
        data-testid="missed-hint"
      >
        漏選：{{ missedIds.map((id) => optionMap[id]?.label ?? id).join('、') }}
      </div>
    </section>

    <!-- 正確答案 -->
    <section>
      <h3 class="text-sm font-bold text-gray-300 mb-2">正確答案</h3>
      <component :is="isOrdering ? 'ol' : 'ul'" class="space-y-1.5" data-testid="correct-list">
        <li
          v-for="(item, idx) in correctDisplayItems"
          :key="item.id"
          class="p-2 rounded border-2 border-green-500 bg-green-500/10 text-green-300 flex items-center gap-2"
        >
          <span v-if="isOrdering" class="font-bold w-5 text-center">{{ idx + 1 }}.</span>
          <span class="flex-1">{{ item.label }}</span>
        </li>
      </component>
    </section>

    <!-- 整題對錯標籤（玩家畫面 header 已有，這裡再給一個強化視覺） -->
    <div
      class="text-center text-sm font-bold py-2 rounded"
      :class="isCorrect ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-400'"
    >
      {{ isCorrect ? '○ 完全正確' : '✕ 答案不符' }}
    </div>
  </div>
</template>
