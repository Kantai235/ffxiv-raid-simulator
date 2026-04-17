<script setup lang="ts">
/**
 * SetupView - 三段 Wizard 的容器頁面。
 *
 * 職責：
 *   1. onMounted 觸發 loadIndex（首次進入或重新整理時）
 *   2. 排版 3 個 Selector 子元件 + 確認區
 *   3. 「開始練習」按鈕的 router push 行為
 *
 * 不直接操作 store 的細節 - 僅讀取 canStart 控制按鈕、執行路由跳轉。
 */
import { onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useRouter } from 'vue-router';
import { useSettingsStore } from '@/stores/settings';
import InstanceSelector from '@/components/setup/InstanceSelector.vue';
import StrategySelector from '@/components/setup/StrategySelector.vue';
import RoleSelector from '@/components/setup/RoleSelector.vue';
import CustomImportZone from '@/components/setup/CustomImportZone.vue';

const store = useSettingsStore();
const router = useRouter();
const { canStart, index } = storeToRefs(store);

onMounted(() => {
  // 僅在尚未載入時 fetch，避免使用者從 /practice 返回時重複請求
  if (!index.value) {
    void store.loadIndex();
  }
});

function startPractice(): void {
  if (!canStart.value) return;
  void router.push('/practice');
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 max-w-5xl">
    <header class="mb-8">
      <h1 class="text-2xl font-bold text-ffxiv-accent">練習設定</h1>
      <p class="text-sm text-gray-400 mt-1">
        依序選擇 副本 → 攻略 → 職能，準備開始模擬練習。
      </p>
    </header>

    <div class="space-y-6">
      <!-- 自訂題庫匯入區（放在最上方，讓社群分享的題庫能第一時間載入） -->
      <CustomImportZone />
      <hr class="border-ffxiv-panel" />
      <InstanceSelector />
      <hr class="border-ffxiv-panel" />
      <StrategySelector />
      <hr class="border-ffxiv-panel" />
      <RoleSelector />
    </div>

    <!-- 開始練習區 -->
    <div class="mt-10 flex justify-end">
      <button
        type="button"
        data-testid="start-button"
        :disabled="!canStart"
        class="px-8 py-3 rounded font-bold text-lg transition-colors"
        :class="
          canStart
            ? 'bg-ffxiv-accent text-ffxiv-bg hover:bg-yellow-400'
            : 'bg-gray-600 text-gray-400 cursor-not-allowed'
        "
        @click="startPractice"
      >
        開始練習
      </button>
    </div>
  </div>
</template>
