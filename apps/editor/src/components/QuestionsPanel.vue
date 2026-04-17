<script setup lang="ts">
/**
 * QuestionsPanel - 題目列表 + 基本資訊編輯（mode='questions' 時左側顯示）。
 *
 * 上半部：題目清單 + 工具列（新增/複製/刪除）
 * 下半部：當前選取題目的基本資訊表單（name / type / boss）
 *
 * 不負責 RoleSolution 編輯（由 RoleSolutionPanel 接手）。
 */
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import type { ChoiceQuestion, QuestionType } from '@ffxiv-sim/shared';
import { useEditorStore } from '@/stores/editor';

const store = useEditorStore();
const {
  dataset,
  selectedQuestion,
  selectedQuestionId,
  selectedStrategyId,
  selectedStrategy,
} = storeToRefs(store);

/**
 * 題目列表 - 只顯示屬於當前選取攻略組的題目（schema 1.1+ 題目綁攻略）。
 *
 * 未選攻略時直接回空陣列，UI 會顯示「請先選攻略」提示，新增按鈕也會 disable。
 */
const questions = computed(() => {
  if (!dataset.value || !selectedStrategyId.value) return [];
  return dataset.value.questions.filter((q) => q.strategyId === selectedStrategyId.value);
});

const instanceId = computed(() => dataset.value?.instance.id ?? '');

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  'map-click': '地圖點擊',
  'single-choice': '單選',
  'multi-choice': '多選',
  ordering: '排序',
};

// ----------------------------------------------------------------------
// CRUD
// ----------------------------------------------------------------------

function onAdd(type: QuestionType): void {
  if (!instanceId.value) return;
  const newId = store.addQuestion(type, instanceId.value);
  if (newId) store.selectQuestion(newId);
}

function onSelect(id: string): void {
  store.selectQuestion(id);
}

function onDuplicate(id: string): void {
  const newId = store.duplicateQuestion(id);
  if (newId) store.selectQuestion(newId);
}

function onDelete(id: string): void {
  if (!window.confirm('確定刪除此題？')) return;
  store.deleteQuestion(id);
}

// ----------------------------------------------------------------------
// 基本資訊表單
// ----------------------------------------------------------------------

function setName(value: string): void {
  if (!selectedQuestion.value) return;
  store.updateQuestion(selectedQuestion.value.id, { name: value });
}

function setType(value: QuestionType): void {
  if (!selectedQuestion.value) return;
  if (selectedQuestion.value.type === value) return;
  // 提示：題型變動會重置 8 職能 RoleSolution
  const ok = window.confirm(
    `切換題型會重置所有 8 職能的解答（debuffs 與安全區/正解都會清空），確定？`,
  );
  if (!ok) return;
  store.updateQuestion(selectedQuestion.value.id, { type: value });
}

function setSkillName(value: string): void {
  if (!selectedQuestion.value) return;
  store.updateQuestion(selectedQuestion.value.id, {
    boss: { ...selectedQuestion.value.boss, skillName: value },
  });
}

function setCastTime(value: number): void {
  if (!selectedQuestion.value || Number.isNaN(value) || value <= 0) return;
  store.updateQuestion(selectedQuestion.value.id, {
    boss: { ...selectedQuestion.value.boss, castTime: value },
  });
}

function setFacing(value: number): void {
  if (!selectedQuestion.value || Number.isNaN(value)) return;
  // 不主動 normalize 到 [0,360)，由出題者輸入；shared/utils/facing 有 normalizeDegrees
  // 但允許 -45 等值便於人類書寫，前台 facingToCssRotation 會自動 normalize
  store.updateQuestion(selectedQuestion.value.id, {
    boss: { ...selectedQuestion.value.boss, facing: value },
  });
}

// 排序題型獨有：clickCount / options 編輯先佔位（下一階段補完整 UI）
// 目前讓出題者只能用「複製題目 → 改名」的方式快速增題；
// 完整題目欄位編輯會在後續 RoleSolution 框選工具一起做。
const isMapClick = computed(() => selectedQuestion.value?.type === 'map-click');

function setClickCount(value: number): void {
  const q = selectedQuestion.value;
  if (!q || q.type !== 'map-click') return;
  if (Number.isNaN(value) || value < 1) return;
  store.updateQuestion(q.id, { clickCount: value });
}

// ----------------------------------------------------------------------
// Options 管理（僅 choice 系列題型）
// ----------------------------------------------------------------------

const options = computed(() => {
  const q = selectedQuestion.value;
  if (!q || q.type === 'map-click') return [];
  return (q as ChoiceQuestion).options;
});

/** 新增選項時的暫態輸入字串 */
const newOptionLabel = ref('');

function onAddOption(): void {
  const label = newOptionLabel.value.trim();
  if (!label) return;
  store.addQuestionOption(label);
  newOptionLabel.value = '';
}

function onUpdateOptionLabel(optionId: string, label: string): void {
  store.updateQuestionOption(optionId, label);
}

function onRemoveOption(optionId: string): void {
  if (!window.confirm('刪除此選項會同時清掉所有職能正解中對此選項的引用，確定？')) return;
  store.removeQuestionOption(optionId);
}

function onMoveOption(optionId: string, dir: 'up' | 'down'): void {
  store.moveQuestionOption(optionId, dir);
}

function isFirstOption(optionId: string): boolean {
  return options.value[0]?.id === optionId;
}

function isLastOption(optionId: string): boolean {
  return options.value[options.value.length - 1]?.id === optionId;
}
</script>

<template>
  <div data-testid="questions-panel" class="space-y-4 text-sm">
    <!-- ===== 未選攻略：禁用整個題目編輯區，顯示明確提示 ===== -->
    <section
      v-if="!selectedStrategyId"
      data-testid="strategy-required-banner"
      class="bg-yellow-500/10 border border-yellow-500/40 rounded p-3"
    >
      <div class="text-xs text-yellow-400 font-bold mb-1">⚠ 請先選擇攻略組</div>
      <p class="text-xs text-gray-300 leading-relaxed">
        題目綁定於特定攻略（不同攻略的站位/解答不同）。
        請先在「場地標記」模式選擇攻略組，回到「題目編輯」模式後即可開始編輯。
      </p>
    </section>

    <!-- ===== 題目清單（已選攻略才顯示） ===== -->
    <section v-else>
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-xs text-editor-accent font-bold">
          {{ selectedStrategy?.name ?? '' }} 的題目（{{ questions.length }}）
        </h3>
      </div>

      <ul v-if="questions.length > 0" class="space-y-1 max-h-64 overflow-y-auto" data-testid="questions-list">
        <li
          v-for="(q, idx) in questions"
          :key="q.id"
          :data-question-id="q.id"
          class="flex items-center gap-1 p-2 rounded border-2 transition-colors"
          :class="
            selectedQuestionId === q.id
              ? 'border-editor-accent bg-editor-accent/15'
              : 'border-gray-700 hover:border-editor-accent/60'
          "
        >
          <button
            type="button"
            class="flex-1 text-left min-w-0"
            @click="onSelect(q.id)"
          >
            <div class="text-xs text-gray-500">
              {{ idx + 1 }}. {{ QUESTION_TYPE_LABELS[q.type] }}
            </div>
            <div class="truncate">{{ q.name }}</div>
          </button>
          <button
            type="button"
            :data-question-duplicate="q.id"
            class="px-1.5 py-0.5 text-xs text-gray-400 hover:bg-editor-bg rounded"
            title="複製"
            @click="onDuplicate(q.id)"
          >⎘</button>
          <button
            type="button"
            :data-question-delete="q.id"
            class="px-1.5 py-0.5 text-xs text-red-400 hover:bg-red-500/20 rounded"
            title="刪除"
            @click="onDelete(q.id)"
          >✕</button>
        </li>
      </ul>
      <p v-else class="text-xs text-gray-500 italic mb-2">（尚無題目）</p>

      <!-- 新增 - 用下拉選擇題型 -->
      <div class="mt-2 flex items-center gap-1">
        <label class="text-xs text-gray-400">新增：</label>
        <button
          type="button"
          data-testid="add-map-click"
          class="text-xs px-2 py-1 bg-editor-bg hover:bg-editor-panel/60 rounded"
          @click="onAdd('map-click')"
        >+ 地圖題</button>
        <button
          type="button"
          class="text-xs px-2 py-1 bg-editor-bg hover:bg-editor-panel/60 rounded"
          @click="onAdd('single-choice')"
        >+ 單選</button>
        <button
          type="button"
          class="text-xs px-2 py-1 bg-editor-bg hover:bg-editor-panel/60 rounded"
          @click="onAdd('multi-choice')"
        >+ 多選</button>
        <button
          type="button"
          class="text-xs px-2 py-1 bg-editor-bg hover:bg-editor-panel/60 rounded"
          @click="onAdd('ordering')"
        >+ 排序</button>
      </div>
    </section>

    <!-- ===== 基本資訊表單 ===== -->
    <section v-if="selectedQuestion" data-testid="question-form" class="border-t border-gray-700 pt-4">
      <h3 class="text-xs text-editor-accent font-bold mb-2">題目基本資訊</h3>

      <div class="space-y-2">
        <div>
          <label class="text-xs text-gray-400 block mb-0.5">題目名稱</label>
          <input
            type="text"
            data-testid="field-name"
            :value="selectedQuestion.name"
            class="w-full bg-editor-bg border border-gray-600 rounded px-2 py-1"
            @change="setName(($event.target as HTMLInputElement).value)"
          />
        </div>

        <div>
          <label class="text-xs text-gray-400 block mb-0.5">題型</label>
          <select
            data-testid="field-type"
            :value="selectedQuestion.type"
            class="w-full bg-editor-bg border border-gray-600 rounded px-2 py-1"
            @change="setType(($event.target as HTMLSelectElement).value as QuestionType)"
          >
            <option value="map-click">地圖點擊</option>
            <option value="single-choice">單選</option>
            <option value="multi-choice">多選</option>
            <option value="ordering">排序</option>
          </select>
          <p class="text-xs text-gray-500 mt-0.5">
            切換題型會重置所有職能的解答。
          </p>
        </div>

        <div>
          <label class="text-xs text-gray-400 block mb-0.5">王詠唱技能</label>
          <input
            type="text"
            data-testid="field-skill"
            :value="selectedQuestion.boss.skillName"
            class="w-full bg-editor-bg border border-gray-600 rounded px-2 py-1"
            @change="setSkillName(($event.target as HTMLInputElement).value)"
          />
        </div>

        <div class="flex gap-2">
          <div class="flex-1">
            <label class="text-xs text-gray-400 block mb-0.5">詠唱秒數</label>
            <input
              type="number"
              min="0.1"
              step="0.5"
              data-testid="field-cast-time"
              :value="selectedQuestion.boss.castTime"
              class="w-full bg-editor-bg border border-gray-600 rounded px-2 py-1 font-mono"
              @change="setCastTime(Number(($event.target as HTMLInputElement).value))"
            />
          </div>
          <div class="flex-1">
            <label class="text-xs text-gray-400 block mb-0.5">面嚮（°）</label>
            <input
              type="number"
              step="15"
              data-testid="field-facing"
              :value="selectedQuestion.boss.facing"
              class="w-full bg-editor-bg border border-gray-600 rounded px-2 py-1 font-mono"
              @change="setFacing(Number(($event.target as HTMLInputElement).value))"
            />
          </div>
        </div>

        <!-- 地圖題獨有：clickCount -->
        <div v-if="isMapClick">
          <label class="text-xs text-gray-400 block mb-0.5">需點擊次數（連續走位）</label>
          <input
            type="number"
            min="1"
            step="1"
            data-testid="field-click-count"
            :value="(selectedQuestion as Extract<typeof selectedQuestion, { type: 'map-click' }>).clickCount"
            class="w-full bg-editor-bg border border-gray-600 rounded px-2 py-1 font-mono"
            @change="setClickCount(Number(($event.target as HTMLInputElement).value))"
          />
        </div>

        <!-- 選擇/排序題：options 完整管理 -->
        <div v-else data-testid="options-management">
          <label class="text-xs text-gray-400 block mb-1">
            選項（{{ options.length }}）
          </label>
          <ul v-if="options.length > 0" class="space-y-1 mb-2" data-testid="options-list">
            <li
              v-for="opt in options"
              :key="opt.id"
              :data-option-id="opt.id"
              class="flex items-center gap-1 p-1.5 rounded border border-gray-700 bg-editor-bg/40"
            >
              <input
                type="text"
                :value="opt.label"
                :data-option-label="opt.id"
                class="flex-1 bg-transparent border border-transparent rounded px-1 py-0.5 text-xs
                       focus:border-editor-accent focus:bg-editor-bg outline-none"
                @change="onUpdateOptionLabel(opt.id, ($event.target as HTMLInputElement).value)"
              />
              <button
                type="button"
                :data-option-up="opt.id"
                :disabled="isFirstOption(opt.id)"
                class="px-1.5 py-0.5 text-xs rounded hover:bg-editor-panel/60
                       disabled:opacity-30 disabled:cursor-not-allowed"
                @click="onMoveOption(opt.id, 'up')"
                title="上移"
              >↑</button>
              <button
                type="button"
                :data-option-down="opt.id"
                :disabled="isLastOption(opt.id)"
                class="px-1.5 py-0.5 text-xs rounded hover:bg-editor-panel/60
                       disabled:opacity-30 disabled:cursor-not-allowed"
                @click="onMoveOption(opt.id, 'down')"
                title="下移"
              >↓</button>
              <button
                type="button"
                :data-option-remove="opt.id"
                class="px-1.5 py-0.5 text-xs text-red-400 hover:bg-red-500/20 rounded"
                @click="onRemoveOption(opt.id)"
                title="刪除"
              >✕</button>
            </li>
          </ul>

          <!-- 新增選項 -->
          <div class="flex gap-1">
            <input
              type="text"
              v-model="newOptionLabel"
              placeholder="新選項標籤"
              data-testid="new-option-input"
              class="flex-1 bg-editor-bg border border-gray-600 rounded px-2 py-1 text-xs"
              @keydown.enter.prevent="onAddOption"
            />
            <button
              type="button"
              data-testid="add-option-button"
              :disabled="!newOptionLabel.trim()"
              class="px-2 py-1 text-xs bg-editor-accent text-editor-bg rounded font-bold
                     disabled:opacity-50 disabled:cursor-not-allowed"
              @click="onAddOption"
            >+ 新增</button>
          </div>

          <p v-if="options.length < 2" class="text-xs text-yellow-400 mt-1">
            ⚠ 建議至少 2 個選項
          </p>
        </div>
      </div>
    </section>

    <p v-else class="text-xs text-gray-500 italic">
      請從上方選擇題目進行編輯。
    </p>
  </div>
</template>
