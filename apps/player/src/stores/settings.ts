import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type {
  DatasetIndex,
  InstanceDataset,
  InstanceIndexEntry,
  RoleId,
  Strategy,
} from '@ffxiv-sim/shared';
import { fetchIndex, fetchInstanceData } from '../services/dataset';
import { parseAndValidateDataset } from '../services/datasetValidator';

/**
 * ========================================================================
 * Settings Store - 設定精靈狀態管理
 * ========================================================================
 *
 * 負責職責：
 *   1. 持有副本索引（fetchIndex 的結果）
 *   2. 持有當前選定副本的完整 dataset（fetchInstanceData 的結果）
 *   3. 追蹤玩家三項選擇：instanceId / strategyId / roleId
 *   4. 載入狀態與錯誤訊息（給 UI 顯示 loading/error）
 *   5. 「重置連動」邏輯：上層選擇變更時自動清空下層選擇
 *
 * 【重置連動規則】
 *   - 換副本（selectInstance）→ 清攻略 + 職能 + 重新觸發 fetch
 *     Why: 不同副本的攻略列表完全不同，舊 strategyId 在新副本中不存在
 *   - 換攻略（selectStrategy）→ 清職能
 *     Why: 同副本不同攻略的站位/解答不同，職能應重選以提示玩家「這次練的是另一套」
 *
 * 【為何 dataset 也存在 store 內】
 *   練習畫面與回顧畫面都需要查 dataset，避免每次切頁面都重 fetch。
 *   選新副本時舊 dataset 自動被覆寫，記憶體不會累積。
 * ========================================================================
 */
export const useSettingsStore = defineStore('settings', () => {
  // ----------------------------------------------------------------------
  // State
  // ----------------------------------------------------------------------

  /** 副本索引（首次進入設定畫面時載入一次） */
  const index = ref<DatasetIndex | null>(null);

  /** 當前選定副本的完整 dataset（隨 selectInstance 變動） */
  const dataset = ref<InstanceDataset | null>(null);

  /** 玩家選擇 - 三段 wizard */
  const selectedInstanceId = ref<string | null>(null);
  const selectedStrategyId = ref<string | null>(null);
  const selectedRoleId = ref<RoleId | null>(null);

  /** 載入狀態 - 給 UI 顯示 spinner 用 */
  const isLoadingIndex = ref(false);
  const isLoadingDataset = ref(false);

  /**
   * 錯誤訊息 - UI 直接顯示給玩家。
   * null 表示無錯誤；錯誤被新動作清掉時也應重置為 null。
   */
  const indexError = ref<string | null>(null);
  const datasetError = ref<string | null>(null);

  /**
   * 當前 dataset 是否來自「自訂題庫匯入」（而非官方 fetchIndex）。
   *
   * Why 獨立 state 而非推斷：
   *   UI 端需清楚顯示「自訂題庫」標示、提供「清除並回到官方題庫」按鈕。
   *   從 dataset.instance.id 去 index.instances 比對的方式太脆弱（id 撞名時會誤判）。
   */
  const isCustomDataset = ref(false);

  /** 自訂題庫匯入失敗的錯誤訊息（獨立於 indexError / datasetError 方便 UI 顯示） */
  const customImportError = ref<string | null>(null);

  // ----------------------------------------------------------------------
  // Getters
  // ----------------------------------------------------------------------

  /** 當前選定副本的索引條目（給 UI 顯示副本名稱用） */
  const selectedInstanceEntry = computed<InstanceIndexEntry | null>(() => {
    if (!index.value || !selectedInstanceId.value) return null;
    return index.value.instances.find((i) => i.id === selectedInstanceId.value) ?? null;
  });

  /** 當前選定攻略的完整資料（給 UI 顯示與練習畫面初始化用） */
  const selectedStrategy = computed<Strategy | null>(() => {
    if (!dataset.value || !selectedStrategyId.value) return null;
    return dataset.value.strategies.find((s) => s.id === selectedStrategyId.value) ?? null;
  });

  /**
   * 是否三項都選齊、可開始練習。
   * UI 用此 getter 控制「開始練習」按鈕的 disabled 狀態。
   */
  const canStart = computed(() =>
    selectedInstanceId.value !== null &&
    selectedStrategyId.value !== null &&
    selectedRoleId.value !== null,
  );

  // ----------------------------------------------------------------------
  // Actions
  // ----------------------------------------------------------------------

  /**
   * 載入副本索引。
   *
   * 通常在設定畫面 onMounted 時呼叫一次；若使用者按「重試」按鈕也會重複呼叫。
   * 失敗時錯誤訊息存於 indexError，state 不變（保留先前可能成功載入的 index）。
   */
  async function loadIndex(): Promise<void> {
    isLoadingIndex.value = true;
    indexError.value = null;
    try {
      index.value = await fetchIndex();
    } catch (err) {
      indexError.value = err instanceof Error ? err.message : '未知錯誤';
    } finally {
      isLoadingIndex.value = false;
    }
  }

  /**
   * 選擇副本（並觸發載入該副本完整資料）。
   *
   * 重置連動：清空攻略與職能選擇，避免新副本不存在舊 ID 造成 UI 錯亂。
   *
   * 特殊情況：若傳入的 instanceId 等於當前已選，仍會重新觸發 fetch
   *   Why: 給「重試」按鈕一條路，且重複點同副本不會有副作用
   */
  async function selectInstance(instanceId: string): Promise<void> {
    // 自訂題庫模式下 dataset 已在記憶體中，點擊「副本卡片」不該重 fetch
    // （index 中的 dataPath 是虛擬值，fetch 必然失敗）
    if (isCustomDataset.value) {
      // 重置下層選擇，但保留 dataset
      selectedInstanceId.value = instanceId;
      selectedStrategyId.value = null;
      selectedRoleId.value = null;
      return;
    }

    selectedInstanceId.value = instanceId;
    // 重置下層選擇與 dataset
    selectedStrategyId.value = null;
    selectedRoleId.value = null;
    dataset.value = null;
    datasetError.value = null;

    const entry = index.value?.instances.find((i) => i.id === instanceId);
    if (!entry) {
      datasetError.value = `找不到副本：${instanceId}`;
      return;
    }

    isLoadingDataset.value = true;
    try {
      dataset.value = await fetchInstanceData(entry);
    } catch (err) {
      datasetError.value = err instanceof Error ? err.message : '未知錯誤';
    } finally {
      isLoadingDataset.value = false;
    }
  }

  /**
   * 選擇攻略。
   *
   * 重置連動：清空職能。
   * Why: 不同攻略的站位/解答不同，強制重選職能可避免玩家以舊攻略的肌肉記憶練新攻略。
   */
  function selectStrategy(strategyId: string): void {
    selectedStrategyId.value = strategyId;
    selectedRoleId.value = null;
  }

  /**
   * 選擇職能。
   * 不需重置連動 - 職能是 wizard 最後一層。
   */
  function selectRole(roleId: RoleId): void {
    selectedRoleId.value = roleId;
  }

  /**
   * 完整重置 - 給「回到首頁重新選擇」或測試用。
   */
  function reset(): void {
    selectedInstanceId.value = null;
    selectedStrategyId.value = null;
    selectedRoleId.value = null;
    dataset.value = null;
    datasetError.value = null;
    isCustomDataset.value = false;
    customImportError.value = null;
  }

  /**
   * 載入自訂（使用者匯入）題庫。
   *
   * 接受「已解析的 JSON 物件」或「原始 JSON 字串」兩種輸入，
   * 統一走 parseAndValidateDataset 做三層驗證：
   *   L1 結構、L2 schema 版本、L3 內層必要欄位
   *
   * 驗證通過後：
   *   1. 清空三選 wizard（strategyId / roleId）- 覆蓋官方題庫狀態
   *   2. 構造虛擬 index（只含此一條）讓 InstanceSelector UI 邏輯仍可運作
   *   3. 寫入 dataset + 自動選取此副本
   *   4. 標示 isCustomDataset=true
   *   5. 清掉先前的 indexError / datasetError（匯入成功視為「已恢復」）
   *
   * 失敗時：customImportError 設錯誤訊息，現有 dataset/index 不變動
   * （匯入失敗不應破壞玩家原本在操作的狀態）。
   *
   * @param input  可為原始 JSON 字串或 FileReader 讀出的結果；也可為已解析的物件
   * @returns      是否成功載入
   */
  function loadCustomDataset(input: string | unknown): boolean {
    customImportError.value = null;
    try {
      // 若為字串走 parse；否則 stringify 後走同一條驗證路徑
      // 統一路徑確保「API 結果」與「檔案匯入」採用同套驗證邏輯
      const text = typeof input === 'string' ? input : JSON.stringify(input);
      const validated = parseAndValidateDataset(text);

      // 覆蓋既有狀態
      selectedStrategyId.value = null;
      selectedRoleId.value = null;
      dataset.value = validated;
      selectedInstanceId.value = validated.instance.id;
      datasetError.value = null;
      indexError.value = null;

      // 構造虛擬 index 只含此一條，讓 InstanceSelector 的 UI 邏輯（依賴 index.instances）仍可運作
      index.value = {
        schemaVersion: validated.schemaVersion,
        instances: [
          {
            id: validated.instance.id,
            name: validated.instance.name,
            shortName: validated.instance.shortName,
            dataPath: '<custom-import>',
            schemaVersion: validated.schemaVersion,
            tags: validated.instance.tags,
          },
        ],
      };

      isCustomDataset.value = true;
      return true;
    } catch (err) {
      customImportError.value = err instanceof Error ? err.message : '匯入失敗';
      return false;
    }
  }

  /**
   * 清除自訂題庫，回到官方題庫流程。
   *
   * 操作：重置所有選擇 + 標示 isCustomDataset=false，然後呼叫 loadIndex 重取官方清單。
   */
  async function clearCustomDataset(): Promise<void> {
    reset();
    await loadIndex();
  }

  return {
    // state
    index,
    dataset,
    selectedInstanceId,
    selectedStrategyId,
    selectedRoleId,
    isLoadingIndex,
    isLoadingDataset,
    indexError,
    datasetError,
    isCustomDataset,
    customImportError,
    // getters
    selectedInstanceEntry,
    selectedStrategy,
    canStart,
    // actions
    loadIndex,
    selectInstance,
    selectStrategy,
    selectRole,
    loadCustomDataset,
    clearCustomDataset,
    reset,
  };
});
