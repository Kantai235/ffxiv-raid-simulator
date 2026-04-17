<script setup lang="ts">
/**
 * RoleSolutionPanel - 8 職能解答編輯（mode='questions' 時與 QuestionsPanel 並排）。
 *
 * - 上方 8 個職能 tab（依職能分類上色：坦藍 / 補綠 / DPS 紅）
 * - 中間：debuffs 多選（從 dataset.debuffLibrary）
 * - 下方：機制解析 textarea
 *
 * 安全區（safeAreas）/ 正解選項（correctOptionIds）的視覺編輯由
 * EditableArenaMap 或下一階段的 ChoiceSolutionEditor 處理，這裡不顯示。
 */
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import type {
  ChoiceQuestion,
  ChoiceRoleSolution,
  MapClickRoleSolution,
  QuestionOption,
} from '@ffxiv-sim/shared';
import {
  ROLE_CATEGORY,
  ROLE_DISPLAY_NAME,
  ROLE_IDS,
  type RoleId,
} from '@ffxiv-sim/shared';
import { useEditorStore, type DrawingTool } from '@/stores/editor';

const store = useEditorStore();
const {
  dataset,
  selectedQuestion,
  selectedRoleId,
  selectedRoleSolution,
  activeDrawingTool,
  selectedSafeAreaId,
} = storeToRefs(store);

// ----------------------------------------------------------------------
// 安全區繪圖工具（僅 map-click 題型）
// ----------------------------------------------------------------------

const isMapClick = computed(() => selectedQuestion.value?.type === 'map-click');

const safeAreas = computed(() => {
  const sol = selectedRoleSolution.value;
  if (!sol || !('safeAreas' in sol)) return [];
  return (sol as MapClickRoleSolution).safeAreas;
});

function startTool(tool: NonNullable<DrawingTool>): void {
  store.startDrawing(tool);
}

function removeLastSafeArea(): void {
  if (safeAreas.value.length === 0) return;
  store.removeSafeArea(safeAreas.value.length - 1);
}

function removeSelectedSafeArea(): void {
  if (!selectedSafeAreaId.value) return;
  store.removeSafeAreaById(selectedSafeAreaId.value);
}

function selectSafeAreaFromList(id: string | undefined): void {
  if (!id) return;
  store.selectSafeArea(id);
}

const TOOL_LABELS: Record<NonNullable<DrawingTool>, string> = {
  circle: '圓形',
  rect: '矩形',
  polygon: '多邊形',
};

// ----------------------------------------------------------------------
// 選擇/排序題：正解設定（correctOptionIds）
// ----------------------------------------------------------------------

/** 是否為 choice 系列題型 */
const isChoiceQuestion = computed(() => {
  const q = selectedQuestion.value;
  return q !== null && q.type !== 'map-click';
});

/** 是否為排序題（影響正解 UI 採用「上下移」而非 toggle） */
const isOrderingQuestion = computed(() => selectedQuestion.value?.type === 'ordering');

/** 是否為單選題（單選 = 點一個自動取消其他） */
const isSingleChoice = computed(() => selectedQuestion.value?.type === 'single-choice');

const questionOptions = computed<QuestionOption[]>(() => {
  const q = selectedQuestion.value;
  if (!q || q.type === 'map-click') return [];
  return (q as ChoiceQuestion).options;
});

const currentCorrectIds = computed<string[]>(() => {
  const sol = selectedRoleSolution.value;
  if (!sol || !('correctOptionIds' in sol)) return [];
  return (sol as ChoiceRoleSolution).correctOptionIds;
});

function isOptionCorrect(optionId: string): boolean {
  return currentCorrectIds.value.includes(optionId);
}

/**
 * 切換某個 option 的正解狀態。
 *   - 單選：選中此項並清掉其他
 *   - 多選：toggle（已選則取消、未選則加入；保留 options 順序避免每次跳動）
 */
function toggleCorrect(optionId: string): void {
  if (!selectedQuestion.value) return;
  const qId = selectedQuestion.value.id;
  const role = selectedRoleId.value;

  if (isSingleChoice.value) {
    // 單選：再次點同一項 → 取消；否則覆寫
    const next = currentCorrectIds.value.includes(optionId) ? [] : [optionId];
    store.setCorrectOptionIds(qId, role, next);
    return;
  }

  // 多選：toggle，保留 options 順序
  const set = new Set(currentCorrectIds.value);
  if (set.has(optionId)) set.delete(optionId);
  else set.add(optionId);
  const ordered = questionOptions.value.filter((o) => set.has(o.id)).map((o) => o.id);
  store.setCorrectOptionIds(qId, role, ordered);
}

// 排序題：用「按 options 順序組合」與「上下移」兩種編輯方式

/**
 * 排序題的「正解順序」。若 RoleSolution 尚未初始化（空陣列），
 * UI 會顯示一個按鈕「以 options 預設順序初始化」，避免從零組裝太繁瑣。
 */
const orderedCorrect = computed<QuestionOption[]>(() => {
  if (!isOrderingQuestion.value) return [];
  // 若 correctOptionIds 已存在，依序對映回 options
  return currentCorrectIds.value
    .map((id) => questionOptions.value.find((o) => o.id === id))
    .filter((o): o is QuestionOption => o !== undefined);
});

function initializeOrdering(): void {
  if (!selectedQuestion.value) return;
  store.setCorrectOptionIds(
    selectedQuestion.value.id,
    selectedRoleId.value,
    questionOptions.value.map((o) => o.id),
  );
}

function moveCorrect(optionId: string, direction: 'up' | 'down'): void {
  const ids = [...currentCorrectIds.value];
  const idx = ids.indexOf(optionId);
  if (idx === -1) return;
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= ids.length) return;
  [ids[idx], ids[targetIdx]] = [ids[targetIdx], ids[idx]];
  if (!selectedQuestion.value) return;
  store.setCorrectOptionIds(selectedQuestion.value.id, selectedRoleId.value, ids);
}

function isFirstCorrect(optionId: string): boolean {
  return currentCorrectIds.value[0] === optionId;
}

function isLastCorrect(optionId: string): boolean {
  return currentCorrectIds.value[currentCorrectIds.value.length - 1] === optionId;
}

const debuffLibrary = computed(() => dataset.value?.debuffLibrary ?? []);

// ----------------------------------------------------------------------
// 職能 tab
// ----------------------------------------------------------------------

const CATEGORY_COLORS: Record<'tank' | 'healer' | 'dps', string> = {
  tank: 'border-blue-500/60',
  healer: 'border-green-500/60',
  dps: 'border-red-500/60',
};

const CATEGORY_ACTIVE: Record<'tank' | 'healer' | 'dps', string> = {
  tank: 'bg-blue-500/30 border-blue-400',
  healer: 'bg-green-500/30 border-green-400',
  dps: 'bg-red-500/30 border-red-400',
};

function tabClass(role: RoleId): string {
  const cat = ROLE_CATEGORY[role];
  return selectedRoleId.value === role ? CATEGORY_ACTIVE[cat] : CATEGORY_COLORS[cat];
}

function selectRole(role: RoleId): void {
  store.selectRole(role);
}

// ----------------------------------------------------------------------
// Debuff 編輯
// ----------------------------------------------------------------------

const currentDebuffs = computed<string[]>(() => selectedRoleSolution.value?.debuffs ?? []);

function toggleDebuff(debuffId: string): void {
  if (!selectedQuestion.value) return;
  const set = new Set(currentDebuffs.value);
  if (set.has(debuffId)) set.delete(debuffId);
  else set.add(debuffId);
  // 保留 library 順序避免每次 toggle 順序跳動
  const ordered = debuffLibrary.value.filter((d) => set.has(d.id)).map((d) => d.id);
  store.updateRoleSolution(selectedQuestion.value.id, selectedRoleId.value, {
    debuffs: ordered,
  });
}

function isDebuffSelected(debuffId: string): boolean {
  return currentDebuffs.value.includes(debuffId);
}

// ----------------------------------------------------------------------
// Note 編輯
// ----------------------------------------------------------------------

const currentNote = computed(() => selectedRoleSolution.value?.note ?? '');

function setNote(value: string): void {
  if (!selectedQuestion.value) return;
  store.updateRoleSolution(selectedQuestion.value.id, selectedRoleId.value, {
    note: value || undefined, // 空字串轉 undefined，保持 JSON 整潔
  });
}
</script>

<template>
  <div data-testid="role-solution-panel" class="space-y-4 text-sm">
    <h3 class="text-xs text-editor-accent font-bold">職能解答</h3>

    <!-- 8 職能 tab -->
    <div class="grid grid-cols-4 gap-1" data-testid="role-tabs">
      <button
        v-for="role in ROLE_IDS"
        :key="role"
        type="button"
        :data-role-tab="role"
        class="px-1.5 py-1.5 text-xs rounded border-2 transition-colors"
        :class="tabClass(role)"
        @click="selectRole(role)"
      >
        {{ role }}
      </button>
    </div>

    <p class="text-xs text-gray-500">
      編輯中：{{ ROLE_DISPLAY_NAME[selectedRoleId] }}
    </p>

    <template v-if="selectedQuestion && selectedRoleSolution">
      <!-- Debuff 多選 -->
      <section>
        <label class="text-xs text-gray-400 block mb-1.5">
          身上 Debuff（{{ currentDebuffs.length }}）
        </label>
        <div v-if="debuffLibrary.length === 0" class="text-xs text-gray-500 italic">
          （此副本的 debuffLibrary 為空，請先在 JSON 補上）
        </div>
        <ul v-else class="space-y-1 max-h-40 overflow-y-auto" data-testid="debuff-list">
          <li v-for="d in debuffLibrary" :key="d.id">
            <button
              type="button"
              :data-debuff-toggle="d.id"
              class="w-full flex items-center gap-2 p-1.5 rounded border-2 transition-colors text-left text-xs"
              :class="
                isDebuffSelected(d.id)
                  ? 'border-editor-accent bg-editor-accent/15'
                  : 'border-gray-700 hover:border-editor-accent/60'
              "
              @click="toggleDebuff(d.id)"
            >
              <span
                class="w-4 h-4 rounded border-2 flex items-center justify-center shrink-0"
                :class="
                  isDebuffSelected(d.id)
                    ? 'border-editor-accent bg-editor-accent text-editor-bg'
                    : 'border-gray-500'
                "
              >
                <span v-if="isDebuffSelected(d.id)" class="text-[10px] font-bold leading-none">✓</span>
              </span>
              <span class="flex-1">{{ d.name }}</span>
              <span v-if="d.duration" class="text-gray-500">{{ d.duration }}s</span>
            </button>
          </li>
        </ul>
      </section>

      <!-- Note textarea -->
      <section>
        <label class="text-xs text-gray-400 block mb-1.5">機制解析（玩家回顧時顯示）</label>
        <textarea
          data-testid="field-note"
          rows="4"
          :value="currentNote"
          placeholder="例：MT 王腳下接刀，注意不要轉身踩到 D3 的 AOE"
          class="w-full bg-editor-bg border border-gray-600 rounded px-2 py-1 text-xs leading-relaxed"
          @change="setNote(($event.target as HTMLTextAreaElement).value)"
        />
      </section>

      <!-- ===== Map-click：安全區繪製工具 ===== -->
      <section
        v-if="isMapClick"
        data-testid="safe-area-tools"
        class="border-t border-gray-700 pt-3"
      >
        <label class="text-xs text-gray-400 block mb-1.5">
          安全區（{{ safeAreas.length }}）
        </label>

        <!-- 3 個工具按鈕 - 點擊 toggle 啟用 -->
        <div class="flex gap-1 mb-2">
          <button
            v-for="tool in (['circle', 'rect', 'polygon'] as const)"
            :key="tool"
            type="button"
            :data-tool="tool"
            class="flex-1 px-2 py-1.5 text-xs rounded border-2 transition-colors"
            :class="
              activeDrawingTool === tool
                ? 'border-editor-accent bg-editor-accent/20 text-editor-accent font-bold'
                : 'border-gray-600 hover:border-editor-accent/60'
            "
            @click="startTool(tool)"
          >
            {{ TOOL_LABELS[tool] }}
          </button>
        </div>

        <!-- 操作提示 - 依工具切換 -->
        <p
          v-if="activeDrawingTool"
          data-testid="drawing-hint"
          class="text-xs text-editor-accent leading-relaxed"
        >
          <template v-if="activeDrawingTool === 'circle'">
            ① 點擊圓心 → ② 點擊圓周
          </template>
          <template v-else-if="activeDrawingTool === 'rect'">
            ① 點擊一角 → ② 點擊對角
          </template>
          <template v-else>
            連續點擊各頂點 → 接近起點時點擊閉合
          </template>
          <span class="block text-gray-500">右鍵 / Esc 取消當前繪製</span>
        </p>

        <!-- 已存在的 safeAreas 清單 - 點擊以選取，行內顯示是否為當前選中 -->
        <ul
          v-if="safeAreas.length > 0"
          class="mt-2 space-y-1 max-h-32 overflow-y-auto"
          data-testid="safe-areas-list"
        >
          <li v-for="(area, idx) in safeAreas" :key="area.id ?? idx">
            <button
              type="button"
              :data-safe-area-row="area.id"
              class="w-full flex items-center gap-2 text-xs px-2 py-1 rounded font-mono text-left transition-colors"
              :class="
                selectedSafeAreaId && area.id === selectedSafeAreaId
                  ? 'bg-editor-accent/20 text-editor-accent border border-editor-accent/60'
                  : 'bg-editor-bg/40 text-gray-400 hover:bg-editor-bg border border-transparent'
              "
              @click="selectSafeAreaFromList(area.id)"
            >
              <span>#{{ idx + 1 }}</span>
              <span class="flex-1">{{ area.shape }}</span>
              <span v-if="selectedSafeAreaId && area.id === selectedSafeAreaId" class="text-[10px]">●</span>
            </button>
          </li>
        </ul>

        <!-- 操作按鈕 -->
        <div v-if="safeAreas.length > 0" class="mt-2 flex gap-2 flex-wrap">
          <button
            type="button"
            data-testid="remove-selected-safe-area"
            :disabled="!selectedSafeAreaId"
            class="text-xs text-red-400 hover:bg-red-500/20 rounded px-2 py-1
                   disabled:opacity-30 disabled:cursor-not-allowed"
            @click="removeSelectedSafeArea"
          >
            ✕ 刪除選定區域
          </button>
          <button
            type="button"
            data-testid="remove-last-safe-area"
            class="text-xs text-gray-400 hover:bg-editor-bg rounded px-2 py-1"
            @click="removeLastSafeArea"
          >
            ↩ 移除最後一個
          </button>
        </div>

        <p v-if="selectedSafeAreaId" class="text-xs text-gray-500 mt-1">
          提示：按 Delete 刪除選定區域。
        </p>
      </section>

      <!-- ===== Choice 系列：正解設定 ===== -->
      <section
        v-else-if="isChoiceQuestion"
        data-testid="correct-options-panel"
        class="border-t border-gray-700 pt-3"
      >
        <label class="text-xs text-gray-400 block mb-1.5">
          正解 ({{ isSingleChoice ? '單選' : isOrderingQuestion ? '排序' : '多選' }})
        </label>

        <!-- 無 options 提示 -->
        <p
          v-if="questionOptions.length === 0"
          class="text-xs text-yellow-400 italic"
        >
          請先在上方為此題目新增選項。
        </p>

        <!-- 單選 / 多選：以 options 順序顯示，可切換 -->
        <ul
          v-else-if="!isOrderingQuestion"
          class="space-y-1"
          data-testid="correct-toggles"
        >
          <li v-for="opt in questionOptions" :key="opt.id">
            <button
              type="button"
              :data-correct-toggle="opt.id"
              class="w-full flex items-center gap-2 p-1.5 rounded border-2 transition-colors text-left text-xs"
              :class="
                isOptionCorrect(opt.id)
                  ? 'border-editor-accent bg-editor-accent/15 text-editor-accent'
                  : 'border-gray-700 hover:border-editor-accent/60'
              "
              @click="toggleCorrect(opt.id)"
            >
              <span
                class="w-4 h-4 flex items-center justify-center shrink-0 border-2"
                :class="
                  isSingleChoice ? 'rounded-full' : 'rounded'
                "
                :style="
                  isOptionCorrect(opt.id)
                    ? { borderColor: '#10B981', background: '#10B981' }
                    : { borderColor: '#9CA3AF' }
                "
              >
                <span v-if="isOptionCorrect(opt.id)" class="text-[10px] font-bold leading-none text-editor-bg">✓</span>
              </span>
              <span class="flex-1">{{ opt.label }}</span>
            </button>
          </li>
        </ul>

        <!-- 排序：依正解順序顯示 + 上下移；若未初始化則顯示初始化按鈕 -->
        <template v-else>
          <button
            v-if="orderedCorrect.length === 0"
            type="button"
            data-testid="init-ordering-button"
            class="w-full px-3 py-2 text-xs border-2 border-editor-accent/60 hover:bg-editor-accent/10 rounded"
            @click="initializeOrdering"
          >
            以選項預設順序初始化
          </button>
          <ol v-else class="space-y-1" data-testid="correct-ordering">
            <li
              v-for="(opt, idx) in orderedCorrect"
              :key="opt.id"
              class="flex items-center gap-2 p-1.5 rounded border-2 border-editor-accent/40 bg-editor-accent/10 text-xs"
            >
              <span class="text-editor-accent font-bold w-5 text-center">{{ idx + 1 }}</span>
              <span class="flex-1">{{ opt.label }}</span>
              <button
                type="button"
                :data-correct-up="opt.id"
                :disabled="isFirstCorrect(opt.id)"
                class="px-1.5 py-0.5 rounded hover:bg-editor-bg
                       disabled:opacity-30 disabled:cursor-not-allowed"
                @click="moveCorrect(opt.id, 'up')"
              >↑</button>
              <button
                type="button"
                :data-correct-down="opt.id"
                :disabled="isLastCorrect(opt.id)"
                class="px-1.5 py-0.5 rounded hover:bg-editor-bg
                       disabled:opacity-30 disabled:cursor-not-allowed"
                @click="moveCorrect(opt.id, 'down')"
              >↓</button>
            </li>
          </ol>
        </template>
      </section>
    </template>

    <p v-else class="text-xs text-gray-500 italic">
      請先選擇題目。
    </p>
  </div>
</template>
