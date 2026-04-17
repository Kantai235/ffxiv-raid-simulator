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
import type { ChoiceQuestion, QuestionType, Tether } from '@ffxiv-sim/shared';
import { ROLE_IDS, WAYMARK_IDS } from '@ffxiv-sim/shared';
import { useEditorStore, type QuestionSubMode } from '@/stores/editor';

const store = useEditorStore();
const {
  dataset,
  selectedQuestion,
  selectedQuestionId,
  selectedStrategyId,
  selectedStrategy,
  questionSubMode,
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

// ----------------------------------------------------------------------
// Phase 2 - 子模式切換 + 實體 / 網格 panel
// ----------------------------------------------------------------------

const SUB_MODE_LABELS: Record<QuestionSubMode, string> = {
  'safe-area': '安全區',
  entity: '實體與分身',
  'grid-mask': '場地破壞',
};

function setSubMode(next: QuestionSubMode): void {
  store.setQuestionSubMode(next);
}

// ===== entity 面板 =====
const enemies = computed(() => selectedQuestion.value?.enemies ?? []);

function onAddEnemy(): void {
  store.addEnemy();
}

function onRemoveEnemy(id: string): void {
  if (!window.confirm('刪除此分身會同時清除所有引用它的連線（tethers），確定？')) return;
  store.removeEnemy(id);
}

function onUpdateEnemyName(id: string, name: string): void {
  store.updateEnemy(id, { name });
}

function onUpdateEnemyFacing(id: string, raw: number): void {
  if (Number.isNaN(raw)) return;
  store.updateEnemy(id, { facing: raw });
}

// ===== grid-mask 面板 =====
const arena = computed(() => dataset.value?.instance.arena);
const grid = computed(() => arena.value?.grid);
const arenaMask = computed(() => selectedQuestion.value?.arenaMask ?? []);

/**
 * grid 編輯暫態 - rows/cols 用本地 ref 而非直接 v-model 到 store，
 * 因為使用者可能正在打字（如打到「3」要打「30」），中途的「3」不該立刻
 * 觸發越界清掃。改為按「套用」按鈕才呼叫 store.updateArenaGrid。
 */
const draftRows = ref<number>(grid.value?.rows ?? 4);
const draftCols = ref<number>(grid.value?.cols ?? 4);

function applyGrid(): void {
  // 套用前檢查 - 與 store 相同規則，避免按鈕看似可用但 store 拒絕
  if (!Number.isInteger(draftRows.value) || draftRows.value <= 0) return;
  if (!Number.isInteger(draftCols.value) || draftCols.value <= 0) return;
  // 縮小尺寸時警告（store 會自動清掃，但讓使用者明確知情）
  if (
    grid.value &&
    (draftRows.value < grid.value.rows || draftCols.value < grid.value.cols) &&
    dataset.value?.questions.some((q) => q.arenaMask && q.arenaMask.length > 0)
  ) {
    const ok = window.confirm(
      '縮小網格會自動移除所有題目中超出新範圍的破碎格設定，確定套用？',
    );
    if (!ok) return;
  }
  store.updateArenaGrid(draftRows.value, draftCols.value);
}

function onClearGrid(): void {
  if (!window.confirm('將移除整個副本的 grid 設定並清光所有題目的破碎格，確定？')) return;
  store.clearArenaGrid();
}

function onClearMask(): void {
  store.clearArenaMask();
}

// ----------------------------------------------------------------------
// Phase 3 - Tethers（連線）編輯
// ----------------------------------------------------------------------

const tethers = computed(() => selectedQuestion.value?.tethers ?? []);

/** 顏色選項 - 與 shared/types/question.ts 的 Tether['color'] 字面聯合對齊 */
const TETHER_COLORS: { value: Tether['color']; label: string; preview: string }[] = [
  { value: 'red', label: '紅色', preview: '#E74C3C' },
  { value: 'blue', label: '藍色', preview: '#3498DB' },
  { value: 'purple', label: '紫色', preview: '#9B59B6' },
  { value: 'yellow', label: '黃色', preview: '#F1C40F' },
  { value: 'green', label: '綠色', preview: '#2ECC71' },
];

/**
 * 端點選項分組 - 給 source / target 下拉同時使用。
 *
 * 結構為 optgroup 友善的格式：
 *   [{ label: 'Boss', items: [{ value, label }] }, ...]
 *
 * Why 用 computed 而非靜態：enemies 隨題目變動；其他三組（Boss/Roles/Waymarks）
 *   雖然靜態，放一起方便 template 一次 v-for。
 */
const endpointGroups = computed(() => {
  const enemies = selectedQuestion.value?.enemies ?? [];
  return [
    {
      label: 'Boss',
      items: [{ value: 'boss', label: '王（Boss）' }],
    },
    {
      label: '分身',
      items: enemies.map((e) => ({ value: e.id, label: e.name })),
    },
    {
      label: '職能',
      items: ROLE_IDS.map((r) => ({ value: r, label: r })),
    },
    {
      label: '場地標記',
      items: WAYMARK_IDS.map((w) => ({ value: w, label: w })),
    },
  ];
});

/**
 * Role ID Set - 給 view 判斷某條 tether 是否引用職能（Player 端不解析職能 →
 * editor 端要用淡虛線提示「練習時定位玩家」）。
 */
const ROLE_ID_SET = new Set<string>(ROLE_IDS);
function isRoleEndpoint(endpointId: string): boolean {
  return ROLE_ID_SET.has(endpointId);
}
function tetherHasRole(t: Tether): boolean {
  return isRoleEndpoint(t.sourceId) || isRoleEndpoint(t.targetId);
}

function onAddTether(): void {
  store.addTether();
}

function onUpdateTether(idx: number, updates: Partial<Tether>): void {
  store.updateTether(idx, updates);
}

function onRemoveTether(idx: number): void {
  store.removeTether(idx);
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

    <!-- ===== Phase 2 - 子模式切換 ===== -->
    <section
      v-if="selectedQuestion"
      data-testid="sub-mode-switcher"
      class="border-t border-gray-700 pt-4"
    >
      <h3 class="text-xs text-editor-accent font-bold mb-2">編輯模式</h3>
      <div class="flex bg-editor-bg rounded overflow-hidden border border-gray-600">
        <button
          v-for="m in (['safe-area', 'entity', 'grid-mask'] as QuestionSubMode[])"
          :key="m"
          type="button"
          :data-sub-mode="m"
          class="flex-1 px-2 py-1 text-xs transition-colors"
          :class="
            questionSubMode === m
              ? 'bg-editor-accent text-editor-bg font-bold'
              : 'hover:bg-editor-panel/60'
          "
          @click="setSubMode(m)"
        >
          {{ SUB_MODE_LABELS[m] }}
        </button>
      </div>
    </section>

    <!-- ===== entity 子模式：分身管理 ===== -->
    <section
      v-if="selectedQuestion && questionSubMode === 'entity'"
      data-testid="entity-panel"
      class="border-t border-gray-700 pt-4"
    >
      <h3 class="text-xs text-editor-accent font-bold mb-2">實體與分身</h3>
      <p class="text-xs text-gray-400 leading-relaxed mb-2">
        在畫布上拖曳實體圖示來改變位置；面嚮在此處編輯。
      </p>

      <!-- Boss 面嚮（與基本資訊同欄位，但獨立放此處方便 entity 編輯流程一氣呵成） -->
      <div class="mb-3 p-2 rounded bg-editor-bg/40 border border-gray-700">
        <div class="text-xs text-gray-400 mb-1">王（Boss）</div>
        <label class="text-xs text-gray-500 block mb-0.5">面嚮（°）</label>
        <input
          type="number"
          step="15"
          data-testid="entity-boss-facing"
          :value="selectedQuestion.boss.facing"
          class="w-full bg-editor-bg border border-gray-600 rounded px-2 py-1 font-mono text-xs"
          @change="setFacing(Number(($event.target as HTMLInputElement).value))"
        />
      </div>

      <!-- 分身列表 -->
      <div class="space-y-2">
        <div
          v-for="(e, idx) in enemies"
          :key="e.id"
          :data-enemy-id="e.id"
          class="p-2 rounded bg-editor-bg/40 border border-gray-700 space-y-1"
        >
          <div class="flex items-center justify-between gap-1">
            <span class="text-xs text-gray-500">分身 {{ idx + 1 }}</span>
            <button
              type="button"
              :data-enemy-remove="e.id"
              class="px-1.5 py-0.5 text-xs text-red-400 hover:bg-red-500/20 rounded"
              @click="onRemoveEnemy(e.id)"
              title="刪除"
            >✕</button>
          </div>
          <div>
            <label class="text-xs text-gray-500 block mb-0.5">名稱</label>
            <input
              type="text"
              :value="e.name"
              :data-enemy-name="e.id"
              class="w-full bg-editor-bg border border-gray-600 rounded px-2 py-1 text-xs"
              @change="onUpdateEnemyName(e.id, ($event.target as HTMLInputElement).value)"
            />
          </div>
          <div>
            <label class="text-xs text-gray-500 block mb-0.5">面嚮（°）</label>
            <input
              type="number"
              step="15"
              :value="e.facing"
              :data-enemy-facing="e.id"
              class="w-full bg-editor-bg border border-gray-600 rounded px-2 py-1 text-xs font-mono"
              @change="onUpdateEnemyFacing(e.id, Number(($event.target as HTMLInputElement).value))"
            />
          </div>
          <div class="text-xs text-gray-500 font-mono">
            位置：({{ Math.round(e.position.x) }}, {{ Math.round(e.position.y) }})
          </div>
        </div>
      </div>

      <button
        type="button"
        data-testid="add-enemy"
        class="mt-2 w-full px-2 py-1.5 text-xs bg-editor-bg hover:bg-editor-panel/60
               rounded border border-editor-accent/60 text-editor-accent"
        @click="onAddEnemy"
      >
        + 新增分身
      </button>

      <!-- ===== 連線設定（Tethers） ===== -->
      <div class="mt-4 pt-3 border-t border-gray-700">
        <h4 class="text-xs text-editor-accent font-bold mb-1">連線設定</h4>
        <p class="text-xs text-gray-400 leading-relaxed mb-2">
          設定實體間的視覺連線（如「傾盆大貓」牽線）。
          連到職能時，畫布上以場地中央示意（練習時才會定位到玩家）。
        </p>

        <ul v-if="tethers.length > 0" class="space-y-2 mb-2" data-testid="tethers-list">
          <li
            v-for="(t, idx) in tethers"
            :key="`${t.sourceId}-${t.targetId}-${idx}`"
            :data-tether-index="idx"
            class="p-2 rounded bg-editor-bg/40 border border-gray-700 space-y-1"
          >
            <div class="flex items-center justify-between gap-1">
              <span class="text-xs text-gray-500">連線 {{ idx + 1 }}</span>
              <button
                type="button"
                :data-tether-remove="idx"
                class="px-1.5 py-0.5 text-xs text-red-400 hover:bg-red-500/20 rounded"
                @click="onRemoveTether(idx)"
                title="刪除"
              >✕</button>
            </div>

            <!-- Source 下拉 -->
            <div>
              <label class="text-xs text-gray-500 block mb-0.5">起點</label>
              <select
                :value="t.sourceId"
                :data-tether-source="idx"
                class="w-full bg-editor-bg border border-gray-600 rounded px-2 py-1 text-xs"
                @change="onUpdateTether(idx, { sourceId: ($event.target as HTMLSelectElement).value })"
              >
                <optgroup
                  v-for="g in endpointGroups"
                  :key="g.label"
                  :label="g.label"
                >
                  <option v-for="opt in g.items" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                  </option>
                </optgroup>
              </select>
            </div>

            <!-- Target 下拉 -->
            <div>
              <label class="text-xs text-gray-500 block mb-0.5">終點</label>
              <select
                :value="t.targetId"
                :data-tether-target="idx"
                class="w-full bg-editor-bg border border-gray-600 rounded px-2 py-1 text-xs"
                @change="onUpdateTether(idx, { targetId: ($event.target as HTMLSelectElement).value })"
              >
                <optgroup
                  v-for="g in endpointGroups"
                  :key="g.label"
                  :label="g.label"
                >
                  <option v-for="opt in g.items" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                  </option>
                </optgroup>
              </select>
            </div>

            <!-- Color 下拉（含色塊預覽） -->
            <div class="flex items-center gap-2">
              <label class="text-xs text-gray-500">顏色</label>
              <select
                :value="t.color"
                :data-tether-color="idx"
                class="flex-1 bg-editor-bg border border-gray-600 rounded px-2 py-1 text-xs"
                @change="onUpdateTether(idx, { color: ($event.target as HTMLSelectElement).value as Tether['color'] })"
              >
                <option v-for="c in TETHER_COLORS" :key="c.value" :value="c.value">
                  {{ c.label }}
                </option>
              </select>
              <!-- 色塊預覽 -->
              <span
                class="inline-block w-5 h-5 rounded border border-gray-600 shrink-0"
                :style="{ backgroundColor: TETHER_COLORS.find((c) => c.value === t.color)?.preview }"
              />
            </div>

            <!-- Role 提示 -->
            <p
              v-if="tetherHasRole(t)"
              :data-tether-role-hint="idx"
              class="text-xs text-yellow-400 italic"
            >
              （練習時定位玩家）
            </p>
          </li>
        </ul>
        <p v-else class="text-xs text-gray-500 italic mb-2">（尚無連線）</p>

        <button
          type="button"
          data-testid="add-tether"
          class="w-full px-2 py-1.5 text-xs bg-editor-bg hover:bg-editor-panel/60
                 rounded border border-editor-accent/60 text-editor-accent"
          @click="onAddTether"
        >
          + 新增連線
        </button>
      </div>
    </section>

    <!-- ===== grid-mask 子模式：場地破壞設定 ===== -->
    <section
      v-if="selectedQuestion && questionSubMode === 'grid-mask'"
      data-testid="grid-mask-panel"
      class="border-t border-gray-700 pt-4"
    >
      <h3 class="text-xs text-editor-accent font-bold mb-2">場地破壞</h3>

      <!-- 警告橫幅：grid 設定影響全副本 -->
      <div
        class="mb-3 p-2 text-xs bg-yellow-500/10 border border-yellow-500/40 rounded text-yellow-200 leading-relaxed"
      >
        ⚠ <span class="font-bold">注意：此設定會影響整個副本的所有題目</span>。
        縮小尺寸時會自動清除越界的破碎格設定。
      </div>

      <!-- grid rows × cols 編輯（暫態 → 套用） -->
      <div class="mb-3 p-2 rounded bg-editor-bg/40 border border-gray-700 space-y-2">
        <div class="text-xs text-gray-400">副本網格設定</div>
        <div class="flex items-center gap-2">
          <div class="flex-1">
            <label class="text-xs text-gray-500 block mb-0.5">列（rows）</label>
            <input
              type="number"
              min="1"
              step="1"
              v-model.number="draftRows"
              data-testid="grid-rows"
              class="w-full bg-editor-bg border border-gray-600 rounded px-2 py-1 text-xs font-mono"
            />
          </div>
          <div class="flex-1">
            <label class="text-xs text-gray-500 block mb-0.5">行（cols）</label>
            <input
              type="number"
              min="1"
              step="1"
              v-model.number="draftCols"
              data-testid="grid-cols"
              class="w-full bg-editor-bg border border-gray-600 rounded px-2 py-1 text-xs font-mono"
            />
          </div>
        </div>
        <div class="flex gap-1">
          <button
            type="button"
            data-testid="grid-apply"
            class="flex-1 px-2 py-1 text-xs bg-editor-accent text-editor-bg rounded font-bold"
            @click="applyGrid"
          >
            套用
          </button>
          <button
            v-if="grid"
            type="button"
            data-testid="grid-clear"
            class="px-2 py-1 text-xs text-red-400 hover:bg-red-500/20 rounded border border-red-500/40"
            @click="onClearGrid"
          >
            移除網格
          </button>
        </div>
        <div v-if="grid" class="text-xs text-gray-500">
          目前：{{ grid.rows }} × {{ grid.cols }}（共 {{ grid.rows * grid.cols }} 格）
        </div>
        <div v-else class="text-xs text-gray-500 italic">尚未設定 grid。</div>
      </div>

      <!-- 此題的破碎格狀態 -->
      <div v-if="grid" class="p-2 rounded bg-editor-bg/40 border border-gray-700">
        <div class="text-xs text-gray-400 mb-1">本題破碎格</div>
        <div class="text-xs text-gray-300 mb-2">
          已破：{{ arenaMask.length }} / {{ grid.rows * grid.cols }} 格
          <span v-if="arenaMask.length > 0" class="text-gray-500 font-mono">
            （index：{{ arenaMask.join(', ') }}）
          </span>
        </div>
        <button
          type="button"
          data-testid="clear-mask"
          :disabled="arenaMask.length === 0"
          class="w-full px-2 py-1 text-xs bg-editor-bg hover:bg-editor-panel/60 rounded
                 border border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          @click="onClearMask"
        >
          清空所有破壞
        </button>
        <p class="text-xs text-gray-500 mt-2 leading-relaxed">
          於畫布上點擊網格切換破碎/完好。
        </p>
      </div>
    </section>

    <p v-if="!selectedQuestion" class="text-xs text-gray-500 italic">
      請從上方選擇題目進行編輯。
    </p>
  </div>
</template>
