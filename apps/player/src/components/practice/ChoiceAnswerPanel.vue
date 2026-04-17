<script setup lang="ts">
/**
 * ========================================================================
 * ChoiceAnswerPanel - 選擇/排序題作答面板
 * ========================================================================
 * 依 props.questionType 渲染三種互動 UI：
 *   - single-choice : Radio 群組
 *   - multi-choice  : Checkbox 群組
 *   - ordering      : 帶上/下移按鈕的排序列表
 *
 * 直接訂閱 session store - 因為這個元件的存在意義就是當前題目的作答介面，
 * 與 store 強耦合反而比 props 拉一堆狀態更直觀。
 *
 * 已結算（review 即時顯示）時禁用所有互動，避免結算後玩家還能改答案。
 * ========================================================================
 */
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import type { ChoiceQuestion, QuestionOption } from '@ffxiv-sim/shared';
import { useSessionStore } from '@/stores/session';

interface Props {
  question: ChoiceQuestion;
}

const props = defineProps<Props>();

const session = useSessionStore();
const { currentSelectedOptionIds, isCurrentEvaluated } = storeToRefs(session);

/**
 * 排序題：依玩家當前順序顯示。
 * 將 store 的 ID 順序對映回完整 option 物件，方便模板顯示 label。
 */
const orderedOptions = computed<QuestionOption[]>(() => {
  if (props.question.type !== 'ordering') return [];
  return currentSelectedOptionIds.value
    .map((id) => props.question.options.find((o) => o.id === id))
    .filter((o): o is QuestionOption => o !== undefined);
});

// ----------------------------------------------------------------------
// 單選 - Radio 行為
// ----------------------------------------------------------------------

function isSelected(id: string): boolean {
  return currentSelectedOptionIds.value.includes(id);
}

function selectSingle(id: string): void {
  if (isCurrentEvaluated.value) return;
  session.setSelectedOptions([id]);
}

// ----------------------------------------------------------------------
// 多選 - Checkbox toggle 行為
// ----------------------------------------------------------------------

function toggleMulti(id: string): void {
  if (isCurrentEvaluated.value) return;
  const set = new Set(currentSelectedOptionIds.value);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  // 保留原始順序 - 從 question.options 過濾，避免每次 toggle 順序跳動
  const next = props.question.options.filter((o) => set.has(o.id)).map((o) => o.id);
  session.setSelectedOptions(next);
}

// ----------------------------------------------------------------------
// 排序 - 上移/下移
// ----------------------------------------------------------------------

function move(id: string, direction: 'up' | 'down'): void {
  if (isCurrentEvaluated.value) return;
  session.moveOption(id, direction);
}

function isFirst(id: string): boolean {
  return currentSelectedOptionIds.value[0] === id;
}

function isLast(id: string): boolean {
  const arr = currentSelectedOptionIds.value;
  return arr[arr.length - 1] === id;
}
</script>

<template>
  <div data-testid="choice-answer-panel" :data-question-type="question.type">
    <!-- ========== 單選 ========== -->
    <div v-if="question.type === 'single-choice'" class="space-y-2">
      <button
        v-for="opt in question.options"
        :key="opt.id"
        type="button"
        :data-option-id="opt.id"
        :disabled="isCurrentEvaluated"
        class="w-full flex items-center gap-3 p-3 rounded border-2 text-left transition-colors
               disabled:opacity-60 disabled:cursor-not-allowed"
        :class="
          isSelected(opt.id)
            ? 'border-ffxiv-accent bg-ffxiv-accent/15'
            : 'border-ffxiv-panel bg-ffxiv-panel/30 hover:border-ffxiv-accent/60'
        "
        @click="selectSingle(opt.id)"
      >
        <!-- Radio 視覺：實心圓表選中 -->
        <span
          class="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0"
          :class="isSelected(opt.id) ? 'border-ffxiv-accent' : 'border-gray-400'"
        >
          <span
            v-if="isSelected(opt.id)"
            class="w-2.5 h-2.5 rounded-full bg-ffxiv-accent"
          />
        </span>
        <span>{{ opt.label }}</span>
      </button>
    </div>

    <!-- ========== 多選 ========== -->
    <div v-else-if="question.type === 'multi-choice'" class="space-y-2">
      <button
        v-for="opt in question.options"
        :key="opt.id"
        type="button"
        :data-option-id="opt.id"
        :disabled="isCurrentEvaluated"
        class="w-full flex items-center gap-3 p-3 rounded border-2 text-left transition-colors
               disabled:opacity-60 disabled:cursor-not-allowed"
        :class="
          isSelected(opt.id)
            ? 'border-ffxiv-accent bg-ffxiv-accent/15'
            : 'border-ffxiv-panel bg-ffxiv-panel/30 hover:border-ffxiv-accent/60'
        "
        @click="toggleMulti(opt.id)"
      >
        <!-- Checkbox 視覺：方框 + 勾 -->
        <span
          class="w-5 h-5 rounded border-2 flex items-center justify-center shrink-0"
          :class="
            isSelected(opt.id)
              ? 'border-ffxiv-accent bg-ffxiv-accent text-ffxiv-bg'
              : 'border-gray-400'
          "
        >
          <span v-if="isSelected(opt.id)" class="text-xs font-bold leading-none">✓</span>
        </span>
        <span>{{ opt.label }}</span>
      </button>
    </div>

    <!-- ========== 排序 ========== -->
    <ol v-else class="space-y-2">
      <li
        v-for="(opt, idx) in orderedOptions"
        :key="opt.id"
        :data-option-id="opt.id"
        class="flex items-center gap-3 p-3 rounded border-2 border-ffxiv-panel bg-ffxiv-panel/30"
      >
        <span class="text-ffxiv-accent font-bold w-6 text-center">{{ idx + 1 }}</span>
        <span class="flex-1">{{ opt.label }}</span>
        <button
          type="button"
          :data-testid="`move-up-${opt.id}`"
          :disabled="isCurrentEvaluated || isFirst(opt.id)"
          class="px-2 py-1 rounded bg-ffxiv-bg hover:bg-ffxiv-accent/20
                 disabled:opacity-30 disabled:cursor-not-allowed"
          @click="move(opt.id, 'up')"
          aria-label="上移"
        >↑</button>
        <button
          type="button"
          :data-testid="`move-down-${opt.id}`"
          :disabled="isCurrentEvaluated || isLast(opt.id)"
          class="px-2 py-1 rounded bg-ffxiv-bg hover:bg-ffxiv-accent/20
                 disabled:opacity-30 disabled:cursor-not-allowed"
          @click="move(opt.id, 'down')"
          aria-label="下移"
        >↓</button>
      </li>
    </ol>
  </div>
</template>
