<script setup lang="ts">
/**
 * Step 3：職能選擇器。
 *
 * 列出 8 職能（MT/ST/H1/H2/D1~D4），按職能大分類分色顯示
 * （坦藍 / 補綠 / DPS 紅，沿用 FFXIV 慣例）。
 *
 * 條件渲染：必須先選副本 + 攻略才會啟用按鈕。
 */
import { storeToRefs } from 'pinia';
import { ROLE_CATEGORY, ROLE_DISPLAY_NAME, ROLE_IDS, type RoleId } from '@ffxiv-sim/shared';
import { useSettingsStore } from '@/stores/settings';

const store = useSettingsStore();
const { selectedStrategyId, selectedRoleId } = storeToRefs(store);

/**
 * 職能分類對應的 Tailwind class。
 * Why 抽出常數：UI 邏輯與資料常數分離，未來改色只需動此處。
 */
const CATEGORY_CLASS: Record<'tank' | 'healer' | 'dps', string> = {
  tank: 'border-blue-500/60 hover:border-blue-400',
  healer: 'border-green-500/60 hover:border-green-400',
  dps: 'border-red-500/60 hover:border-red-400',
};

const CATEGORY_SELECTED_CLASS: Record<'tank' | 'healer' | 'dps', string> = {
  tank: 'border-blue-400 bg-blue-500/20',
  healer: 'border-green-400 bg-green-500/20',
  dps: 'border-red-400 bg-red-500/20',
};

function classFor(role: RoleId): string {
  const category = ROLE_CATEGORY[role];
  return selectedRoleId.value === role
    ? CATEGORY_SELECTED_CLASS[category]
    : CATEGORY_CLASS[category];
}
</script>

<template>
  <section data-testid="role-selector">
    <h2
      class="text-lg font-bold mb-3"
      :class="selectedStrategyId ? 'text-ffxiv-accent' : 'text-gray-500'"
    >
      Step 3 · 選擇職能
    </h2>

    <p v-if="!selectedStrategyId" class="text-sm text-gray-500 italic">
      請先完成 Step 2。
    </p>

    <div v-else class="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <button
        v-for="role in ROLE_IDS"
        :key="role"
        type="button"
        :data-role-id="role"
        class="p-3 rounded border-2 text-center transition-colors bg-ffxiv-panel/40"
        :class="classFor(role)"
        @click="store.selectRole(role)"
      >
        {{ ROLE_DISPLAY_NAME[role] }}
      </button>
    </div>
  </section>
</template>
