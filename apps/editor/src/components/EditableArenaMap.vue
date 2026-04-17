<script setup lang="ts">
/**
 * ========================================================================
 * <EditableArenaMap /> - Editor 專屬可編輯場地（SVG）
 * ========================================================================
 *
 * 三層模式互動（props.mode + store.questionSubMode）：
 *   - mode='waymarks'    : 拖曳 waymark 調整座標
 *   - mode='arena'       : 在背景上拖曳繪製輔助線；點擊現有線可選取
 *   - mode='questions'   : 進入題目編輯，再依子模式分流（見下方）
 *
 * ============================================================
 * 【questions 子模式事件隔離 - 避免狀態機競態】
 * ============================================================
 * questions 主模式下三個子模式的畫布互動「絕對不能交疊」，否則會產生
 * 致命的競態（例：拖實體時誤觸發 SafeArea 繪圖頂點、grid-mask 點擊
 * 被當成 SafeArea 起點）。隔離策略：
 *
 *   1. safe-area  → mousedown 走 handleQuestionsModeMouseDown
 *                   （既有 SafeArea 繪圖狀態機）
 *   2. entity     → mousedown 由實體 hitbox 自身吸收 + stopPropagation；
 *                   外層 onCanvasMouseDown 偵測到 sub-mode 不是 safe-area 即不動作
 *   3. grid-mask  → 用 SVG @click（非 mousedown），避免被任何拖曳手勢
 *                   截走；外層 onCanvasMouseDown 同樣略過
 *
 * 雙保險：isDrawing computed 強制 sub-mode === 'safe-area'，即使 store
 *   殘留 activeDrawingTool 也不會觸發 mousemove 監聽 → draft layer 不渲染。
 *
 * 切換子模式時 setQuestionSubMode 會 cancelDrawing + 清 selectedSafeAreaId
 * + 清 activeDrawingTool，保證進新子模式時無孤兒暫態。
 * ============================================================
 *
 * 【座標換算 - 螢幕像素 ↔ SVG 邏輯座標】
 * ============================================================
 * 採用 SVG 原生 API：getScreenCTM().inverse() 變換。CTM 是瀏覽器原生
 * SVG 座標換算 API，自動處理 viewBox / preserveAspectRatio / 任何 transform。
 *
 * Fallback：若 CTM 不可用，退回 boundingRect 比例計算。
 * ============================================================
 *
 * 【拖曳/畫線生命週期】
 *   mousedown → 註冊 window.mousemove + window.mouseup
 *   mousemove → 即時更新本地暫態（dragPosition / draftLine / entityDragPosition）
 *   mouseup   → emit 結果或呼叫 store action；移除 window 事件
 *
 * window 監聽避免「游標拖出 SVG 即失追蹤」的常見坑。
 *
 * 【為何拖曳期間用 Transient State 而非頻繁 store 寫入】
 *   - 每幀寫 store 會觸發整個 reactive 鏈（panel 列表也重渲染），效能災難
 *   - 拖到一半若使用者按 Esc，本地暫態直接丟掉即可，store 從未被弄髒
 *   - mouseup 才一次性呼叫 updateBossPosition / updateEnemy，dirty flag 也只跳一次
 *   - 此模式與 waymark 拖曳的 dragPosition 設計一致，全 codebase 統一風格
 * ============================================================
 */

import { computed, onBeforeUnmount, ref, watchEffect } from 'vue';
import { storeToRefs } from 'pinia';
import type {
  AnchorPoint,
  Arena,
  ArenaLine,
  BossState,
  EnemyEntity,
  Point2D,
  SafeArea,
  Strategy,
  Tether,
  WaymarkId,
} from '@ffxiv-sim/shared';
import { ROLE_IDS, WAYMARK_COLOR, WAYMARK_IDS, facingToCssRotation } from '@ffxiv-sim/shared';
import { useEditorStore } from '@/stores/editor';
import {
  calculateRadius,
  isNearStartPoint,
  normalizeRect,
} from '@/utils/drawing';

type EditMode = 'waymarks' | 'arena' | 'questions';

interface Props {
  arena: Arena;
  /** 攻略組的 waymark 集合 */
  waymarks: Strategy['waymarks'];
  /** 編輯模式 */
  mode: EditMode;
  /** 當前選取的線 id（arena 模式有效） */
  selectedLineId?: string | null;
  /**
   * 背景圖 cache busting token。每次上傳新圖時應遞增（通常傳 Date.now()），
   * 元件會在 image href 後面加 ?t=token 強制瀏覽器重抓。
   */
  imageCacheToken?: number;
  /**
   * questions 模式：當前題目的 Boss 狀態（含面嚮 / 位置 / 技能名）。
   * 提供時會在畫布渲染面嚮指示器，無提供則不畫。
   */
  bossState?: BossState | null;
  /**
   * questions 模式：當前選取職能的 safeAreas。
   * 提供時以半透明色塊渲染，方便出題者預覽。
   */
  safeAreas?: SafeArea[];
  /**
   * questions 模式：當前題目的分身（Phase 2）。
   * entity 子模式下可拖曳；其他子模式為唯讀顯示。
   */
  enemies?: EnemyEntity[];
  /**
   * questions 模式：當前題目的破碎格 index 陣列（Phase 2）。
   * grid-mask 子模式下視覺即時反映 toggleArenaMask 結果。
   */
  arenaMask?: number[];
  /**
   * questions 模式：當前題目的連線（Phase 3）。
   * Editor 端視覺與 Player 對齊；Role ID 端點 fallback 到場地中央 + 淡虛線。
   */
  tethers?: Tether[];
  /**
   * questions 模式：當前題目的自由錨點（Phase 3.5）。
   * entity 子模式下渲染為金黃色小圓點供拖曳；其他子模式 pointer-events=none。
   * Player 端不渲染（純座標提供者）；此 prop 僅 editor 用。
   */
  anchors?: AnchorPoint[];
  /**
   * 背景圖路徑前綴。
   *
   * Why: 當 editor 從 player 發佈版（靜態 GH Pages 模式）載入官方題庫時，
   *      arena.backgroundImage 是相對 player 根的路徑（如 'assets/arenas/m1s.png'），
   *      但 editor 部署在 '/<repo>/editor/'，相對 fetch 會解析成
   *      '/<repo>/editor/assets/arenas/...' → 404。
   *      傳入 '../' 可往上跳到 player 根；不傳則維持原值（本機 dev / 上傳的本機 JSON）。
   */
  imagePathPrefix?: string;
}

const props = withDefaults(defineProps<Props>(), {
  selectedLineId: null,
  imageCacheToken: 0,
  bossState: null,
  safeAreas: () => [],
  enemies: () => [],
  arenaMask: () => [],
  tethers: () => [],
  anchors: () => [],
  imagePathPrefix: '',
});

const emit = defineEmits<{
  /** waymark 拖曳完成（mouseup） */
  (e: 'waymark-drag-end', id: WaymarkId, point: Point2D): void;
  /** 完成繪製一條新的輔助線 */
  (e: 'line-create', line: ArenaLine): void;
  /** 點擊已有線條（傳 null 表示點擊空白處取消選取） */
  (e: 'line-select', id: string | null): void;
  /**
   * questions 模式下的畫布點擊 - 給安全區繪製工具使用。
   * 目前僅 emit 邏輯座標，呼叫端未掛 handler 也無副作用；
   * 下一階段會在這裡接上 polygon/circle/rect 的繪製狀態機。
   */
  (e: 'canvas-click', point: Point2D): void;
}>();

const svgRef = ref<SVGSVGElement | null>(null);

// ----------------------------------------------------------------------
// 繪圖狀態 - 從 store 取得工具/已落下的點，view 層自管 currentMousePos
// ----------------------------------------------------------------------

const editorStore = useEditorStore();
const { activeDrawingTool, drawingPoints, selectedSafeAreaId, questionSubMode } =
  storeToRefs(editorStore);

/**
 * 當前游標的邏輯座標（questions 模式 + 啟用工具時才追蹤）。
 *
 * Why 在 view 層而非 store：mousemove 每幀都寫，放 store 會觸發
 *      全 app 的 reactivity 鏈，浪費效能。draft layer 的預覽計算只需此元件內部
 *      reactivity 就夠了。
 */
const currentMousePos = ref<Point2D | null>(null);

/**
 * 是否處於繪圖模式（questions + safe-area 子模式 + 有工具啟用）。
 *
 * Phase 2 加入子模式判斷：entity / grid-mask 子模式絕不該觸發 SafeArea 繪圖
 * 暫態（即使 store 殘留 activeDrawingTool 也不該執行 mousemove 追蹤）。
 * setQuestionSubMode 已在 store 切換時清掉 tool，這裡是雙保險。
 */
const isDrawing = computed(
  () =>
    props.mode === 'questions' &&
    questionSubMode.value === 'safe-area' &&
    activeDrawingTool.value !== null,
);

/**
 * Polygon 是否可磁吸閉合：3+ 點 + 游標接近起點。
 * 給 draft layer 的預覽線與 mousedown commit 判斷共用。
 */
const canSnapPolygon = computed(() => {
  if (activeDrawingTool.value !== 'polygon') return false;
  if (!currentMousePos.value) return false;
  return isNearStartPoint(drawingPoints.value, currentMousePos.value);
});

// ----------------------------------------------------------------------
// 共用座標換算
// ----------------------------------------------------------------------

function screenToLogical(clientX: number, clientY: number): Point2D | null {
  const svg = svgRef.value;
  if (!svg) return null;
  const ctm = svg.getScreenCTM?.();
  if (ctm) {
    const inv = ctm.inverse();
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const t = pt.matrixTransform(inv);
    return { x: t.x, y: t.y };
  }
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return {
    x: ((clientX - rect.left) / rect.width) * props.arena.size.width,
    y: ((clientY - rect.top) / rect.height) * props.arena.size.height,
  };
}

function clampToArena(p: Point2D): Point2D {
  const { width, height } = props.arena.size;
  const center = props.arena.center;
  if (props.arena.shape === 'square') {
    return {
      x: Math.max(0, Math.min(width, p.x)),
      y: Math.max(0, Math.min(height, p.y)),
    };
  }
  const r = Math.min(width, height) / 2;
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= r) return p;
  const k = r / dist;
  return { x: center.x + dx * k, y: center.y + dy * k };
}

// ----------------------------------------------------------------------
// Waymark 拖曳（waymarks 模式）
// ----------------------------------------------------------------------

const draggingId = ref<WaymarkId | null>(null);
const dragPosition = ref<Point2D | null>(null);

function onWaymarkMouseDown(event: MouseEvent, id: WaymarkId): void {
  if (event.button !== 0) return;
  if (props.mode !== 'waymarks') return;
  event.preventDefault();
  event.stopPropagation(); // 別觸發背景的畫線（雖然 arena 模式不顯示 waymark 但保險）

  draggingId.value = id;
  dragPosition.value = props.waymarks[id] ?? null;

  window.addEventListener('mousemove', onWaymarkMouseMove);
  window.addEventListener('mouseup', onWaymarkMouseUp);
}

function onWaymarkMouseMove(event: MouseEvent): void {
  if (!draggingId.value) return;
  const logical = screenToLogical(event.clientX, event.clientY);
  if (!logical) return;
  dragPosition.value = clampToArena(logical);
}

function onWaymarkMouseUp(): void {
  const id = draggingId.value;
  const finalPos = dragPosition.value;
  window.removeEventListener('mousemove', onWaymarkMouseMove);
  window.removeEventListener('mouseup', onWaymarkMouseUp);
  draggingId.value = null;
  dragPosition.value = null;
  if (id && finalPos) emit('waymark-drag-end', id, finalPos);
}

// ----------------------------------------------------------------------
// 畫線（arena 模式）
// ----------------------------------------------------------------------

/**
 * 暫態畫線狀態。null 表示未在畫；有值時 SVG 顯示 draft 線。
 *
 * 與 waymark 的 dragPosition 設計同構：暫態存本地，commit 才走 store。
 */
const draftLine = ref<{ start: Point2D; end: Point2D } | null>(null);

// ----------------------------------------------------------------------
// Phase 2 - entity 子模式：拖曳 boss / 分身
// ----------------------------------------------------------------------

/**
 * 當前正在拖曳的實體 ID。
 *   - 'boss'：王本體
 *   - 其他字串：對應 enemies[].id
 *   - null：未拖曳
 *
 * Why 用 string union 而非分兩個 ref：兩者拖曳邏輯近 100% 重複，合一個
 * dragging id + 寫回時 if (id === 'boss') 比兩套 state 更不容易漏掉。
 */
const draggingEntityId = ref<string | null>(null);

/** 拖曳期間的暫態座標（mousemove 才更新；mouseup 才寫回 store） */
const entityDragPosition = ref<Point2D | null>(null);

/**
 * 是否處於 entity 子模式（畫布 cursor / hitbox 顯示判斷依據）。
 * 抽 computed 方便 template 與 cursor 計算複用。
 */
const isEntitySubMode = computed(
  () => props.mode === 'questions' && questionSubMode.value === 'entity',
);

const isGridMaskSubMode = computed(
  () => props.mode === 'questions' && questionSubMode.value === 'grid-mask',
);

/**
 * 啟動實體拖曳。`event.stopPropagation` 阻止外層 onCanvasMouseDown 觸發
 * （否則 entity 子模式下可能被當成「點擊空白」處理）。
 *
 * 支援三種實體：'boss' / enemy.id / anchor.id - 以 ID lookup 順序判斷類型。
 */
function onEntityMouseDown(event: MouseEvent, entityId: string): void {
  if (event.button !== 0) return;
  if (!isEntitySubMode.value) return;
  event.preventDefault();
  event.stopPropagation();

  draggingEntityId.value = entityId;
  // 初始位置取目前狀態（避免 mousemove 還沒觸發前圖示瞬移）
  if (entityId === 'boss') {
    entityDragPosition.value = props.bossState?.position
      ? { ...props.bossState.position }
      : { ...props.arena.center };
  } else {
    const enemy = props.enemies.find((e) => e.id === entityId);
    if (enemy) {
      entityDragPosition.value = { ...enemy.position };
    } else {
      const anchor = props.anchors.find((a) => a.id === entityId);
      entityDragPosition.value = anchor ? { ...anchor.position } : null;
    }
  }
  window.addEventListener('mousemove', onEntityMouseMove);
  window.addEventListener('mouseup', onEntityMouseUp);
}

function onEntityMouseMove(event: MouseEvent): void {
  if (!draggingEntityId.value) return;
  const logical = screenToLogical(event.clientX, event.clientY);
  if (!logical) return;
  entityDragPosition.value = clampToArena(logical);
}

function onEntityMouseUp(): void {
  const id = draggingEntityId.value;
  const finalPos = entityDragPosition.value;
  window.removeEventListener('mousemove', onEntityMouseMove);
  window.removeEventListener('mouseup', onEntityMouseUp);
  draggingEntityId.value = null;
  entityDragPosition.value = null;
  if (!id || !finalPos) return;
  // 寫回 store（mouseup 才寫；mousemove 期間僅本地暫態）
  // 用 lookup 判斷而非 string 前綴 - id 由不同 generator 產生 (enemy-* / anchor-*)，
  // 但這裡用實際存在於哪個 array 來判斷更穩定（若未來改 id 格式不會悄悄壞）。
  if (id === 'boss') {
    editorStore.updateBossPosition(finalPos);
  } else if (props.enemies.some((e) => e.id === id)) {
    editorStore.updateEnemy(id, { position: finalPos });
  } else if (props.anchors.some((a) => a.id === id)) {
    editorStore.updateAnchor(id, { position: finalPos });
  }
}

/**
 * 當前 boss 應該顯示的位置（拖曳時用暫態，否則用 props 提供值或場地中心 fallback）。
 * 渲染與 hitbox 都依賴此值，確保 mousemove 更新時視覺同步。
 */
const liveBossPosition = computed<Point2D>(() => {
  if (draggingEntityId.value === 'boss' && entityDragPosition.value) {
    return entityDragPosition.value;
  }
  return props.bossState?.position ?? props.arena.center;
});

/** 取得分身的當前顯示座標（拖曳中用暫態） */
function liveEnemyPosition(enemy: EnemyEntity): Point2D {
  if (draggingEntityId.value === enemy.id && entityDragPosition.value) {
    return entityDragPosition.value;
  }
  return enemy.position;
}

/** 取得錨點的當前顯示座標（拖曳中用暫態，與 liveEnemyPosition 同精神） */
function liveAnchorPosition(anchor: AnchorPoint): Point2D {
  if (draggingEntityId.value === anchor.id && entityDragPosition.value) {
    return entityDragPosition.value;
  }
  return anchor.position;
}

// ----------------------------------------------------------------------
// Phase 2 - grid-mask 子模式：點擊網格切換破碎
// ----------------------------------------------------------------------

/**
 * grid-mask 子模式下的畫布 click 事件。
 *
 * 為何用 click 而非 mousedown：
 *   - 避免與 entity 拖曳手勢混淆（拖曳是 mousedown→mouseup，click 才是「就地完成」）
 *   - 出題者可能會「按住游標掃過多格」，用 mousedown 容易誤觸
 *
 * 邊界：座標超出 [0, width] / [0, height] → 忽略。
 */
function onGridMaskClick(event: MouseEvent): void {
  if (!isGridMaskSubMode.value) return;
  const grid = props.arena.grid;
  if (!grid) return;
  const logical = screenToLogical(event.clientX, event.clientY);
  if (!logical) return;
  const { width, height } = props.arena.size;
  if (logical.x < 0 || logical.x > width) return;
  if (logical.y < 0 || logical.y > height) return;
  const cellW = width / grid.cols;
  const cellH = height / grid.rows;
  const col = Math.floor(logical.x / cellW);
  const row = Math.floor(logical.y / cellH);
  // 防右/下邊界 floor 溢位：當 logical.x 恰好等於 width（或 y 等於 height），
  // floor(width / cellW) = cols，超出有效 [0, cols-1]，反推 index 會越界。
  // 例如 4×4 grid、width=1000、cellW=250：logical.x=1000 → col=4，但實際應屬最右一格 col=3。
  // Math.min 把這些剛好落在外緣的點吸回最後一格，行為符合直覺（玩家點到邊界 = 點到該格）。
  const safeCol = Math.min(col, grid.cols - 1);
  const safeRow = Math.min(row, grid.rows - 1);
  // Row-major 公式：index = row * cols + col（與 shared/types/question.ts arenaMask 註解保持唯一來源）
  const index = safeRow * grid.cols + safeCol;
  editorStore.toggleArenaMask(index);
}

/**
 * grid-mask 子模式可視覺化的網格輔助線（cell 邊界）。
 * 只在 grid 存在時計算；其他子模式不渲染（避免畫布雜訊）。
 */
const gridLines = computed(() => {
  const grid = props.arena.grid;
  if (!grid) return null;
  const { width, height } = props.arena.size;
  const cellW = width / grid.cols;
  const cellH = height / grid.rows;
  // 內部分隔線 - 邊界線由背景的 stroke 已涵蓋
  const verticals: number[] = [];
  for (let i = 1; i < grid.cols; i++) verticals.push(i * cellW);
  const horizontals: number[] = [];
  for (let i = 1; i < grid.rows; i++) horizontals.push(i * cellH);
  return { verticals, horizontals, cellW, cellH };
});

// ----------------------------------------------------------------------
// Phase 3 - Tethers 連線渲染（與 Player ArenaMap 視覺對齊）
// ----------------------------------------------------------------------

/** Waymark ID 型別守衛 */
function isWaymarkId(id: string): id is WaymarkId {
  return (WAYMARK_IDS as readonly string[]).includes(id);
}

/** Role ID 型別守衛 - 用於 editor 端的「淡虛線示意」分支 */
const ROLE_ID_SET = new Set<string>(ROLE_IDS);
function isRoleId(id: string): boolean {
  return ROLE_ID_SET.has(id);
}

/**
 * 解析連線端點 ID 為場上座標。
 *
 * 解析順序（與 Player ArenaMap 對齊；anchor 為 Phase 3.5 新增）：
 *   1. 'boss'       → resolvedBossPosition
 *   2. enemy.id     → enemies 陣列對應 position（用 liveEnemyPosition 拖曳同步）
 *   3. anchor.id    → anchors 陣列對應 position（用 liveAnchorPosition 拖曳同步）
 *   4. WaymarkId    → waymarks 對應座標
 *   5. RoleId       → arena.center（editor 無法預知玩家站位，給場地中央示意）
 *
 * 找不到任何對應 → 回 null（呼叫端過濾）。
 */
function resolveEntityPosition(id: string): Point2D | null {
  if (id === 'boss') return resolvedBossPosition.value;
  const enemy = props.enemies.find((e) => e.id === id);
  if (enemy) return liveEnemyPosition(enemy);
  const anchor = props.anchors.find((a) => a.id === id);
  if (anchor) return liveAnchorPosition(anchor);
  if (isWaymarkId(id)) {
    const wm = props.waymarks[id];
    if (wm) return wm;
  }
  if (isRoleId(id)) return props.arena.center;
  return null;
}

/** 連線顏色 → CSS 色碼（與 Player ArenaMap 同表） */
const TETHER_COLOR_MAP: Record<Tether['color'], string> = {
  red: '#E74C3C',
  blue: '#3498DB',
  purple: '#9B59B6',
  yellow: '#F1C40F',
  green: '#2ECC71',
};

/**
 * 可渲染的連線資料 - 過濾任一端無法解析者。
 *
 * isRoleEndpoint 旗標讓 view 套用「淡虛線」樣式區分：
 *   editor 端 Role 連線只是示意（端點固定在場地中央），
 *   實際玩家位置要練習時才知道。
 */
const renderableTethers = computed(() =>
  props.tethers
    .map((t, idx) => {
      const src = resolveEntityPosition(t.sourceId);
      const tgt = resolveEntityPosition(t.targetId);
      if (!src || !tgt) return null;
      return {
        key: `${idx}-${t.sourceId}-${t.targetId}`,
        x1: src.x,
        y1: src.y,
        x2: tgt.x,
        y2: tgt.y,
        color: TETHER_COLOR_MAP[t.color],
        isRoleEndpoint: isRoleId(t.sourceId) || isRoleId(t.targetId),
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null),
);

/**
 * 破碎格的視覺資料（與 player ArenaMap 的 brokenTiles 同型）。
 * 不論子模式都渲染（出題者切回 safe-area 時也該看到當前破碎狀態）。
 */
const brokenTiles = computed(() => {
  const grid = props.arena.grid;
  if (!grid || props.arenaMask.length === 0) return [];
  const cellW = props.arena.size.width / grid.cols;
  const cellH = props.arena.size.height / grid.rows;
  return props.arenaMask
    .filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < grid.rows * grid.cols)
    .map((idx) => {
      const row = Math.floor(idx / grid.cols);
      const col = idx % grid.cols;
      return {
        index: idx,
        x: col * cellW,
        y: row * cellH,
        width: cellW,
        height: cellH,
      };
    });
});

// ----------------------------------------------------------------------
// 繪製安全區（questions 模式）
// ----------------------------------------------------------------------

/**
 * questions 模式的 mousedown 分派 - 依 activeDrawingTool 決定行為。
 *
 * 狀態機說明：
 *   [circle]
 *     drawingPoints.length === 0 → append 圓心（等第 2 下）
 *     drawingPoints.length === 1 → 計算半徑 + commit
 *   [rect]
 *     drawingPoints.length === 0 → append 起點（等第 2 下）
 *     drawingPoints.length === 1 → 用 normalizeRect 計算 + commit
 *   [polygon]
 *     先檢查 magnetic snap：若 3+ 點且游標接近起點 → commit
 *     否則 append 新頂點
 */
function handleQuestionsModeMouseDown(event: MouseEvent): void {
  const logical = screenToLogical(event.clientX, event.clientY);
  if (!logical) return;
  const clamped = clampToArena(logical);

  // 沒啟用工具 → 走「選取既有 safeArea」流程
  if (!activeDrawingTool.value) {
    const target = event.target as Element;
    const safeAreaId = target.getAttribute?.('data-safe-area-id') ?? null;
    // 點到 safeArea → 設定選取；點到空白 → 清掉選取
    editorStore.selectSafeArea(safeAreaId);
    // 同時 emit 給呼叫端（保留擴充彈性）
    emit('canvas-click', clamped);
    return;
  }

  event.preventDefault();

  const tool = activeDrawingTool.value;
  const pts = drawingPoints.value;

  if (tool === 'circle') {
    if (pts.length === 0) {
      editorStore.appendDrawingPoint(clamped);
      return;
    }
    // 第 2 下：計算半徑並 commit
    const center = pts[0];
    const radius = calculateRadius(center, clamped);
    // 過短半徑過濾（避免不小心雙擊產生半徑幾乎 0 的圓）
    if (radius < 3) {
      editorStore.cancelDrawing();
      return;
    }
    editorStore.commitSafeArea({ shape: 'circle', center: { ...center }, radius });
    return;
  }

  if (tool === 'rect') {
    if (pts.length === 0) {
      editorStore.appendDrawingPoint(clamped);
      return;
    }
    // 第 2 下：用 normalizeRect 計算標準矩形
    const rect = normalizeRect(pts[0], clamped);
    // 退化矩形（面積 0）過濾
    if (rect.width < 3 && rect.height < 3) {
      editorStore.cancelDrawing();
      return;
    }
    editorStore.commitSafeArea({ shape: 'rect', ...rect });
    return;
  }

  if (tool === 'polygon') {
    // 磁吸閉合：3+ 點 + 游標接近起點 → commit
    if (canSnapPolygon.value && pts.length >= 3) {
      editorStore.commitSafeArea({
        shape: 'polygon',
        points: pts.map((p) => ({ ...p })),
      });
      return;
    }
    // 否則附加頂點
    editorStore.appendDrawingPoint(clamped);
  }
}

/**
 * 全域 mousemove 追蹤 - 繪圖模式期間更新 currentMousePos，供 draft layer 重算。
 *
 * 為何用 window 而非 SVG 元素監聽：
 *   與拖曳 waymark 相同思路 - 游標拖出 SVG 仍要更新（polygon 繪製可能游標很快移動）。
 *   但我們只在 isDrawing 為 true 時才掛；關閉工具時解除，不浪費事件。
 */
function onDrawingMouseMove(event: MouseEvent): void {
  const logical = screenToLogical(event.clientX, event.clientY);
  if (!logical) return;
  currentMousePos.value = clampToArena(logical);
}

/**
 * 當 isDrawing 變化時掛/解 mousemove listener。
 * 用 watchEffect 自動追蹤 reactive 依賴。
 */
watchEffect((onCleanup) => {
  if (!isDrawing.value) {
    currentMousePos.value = null;
    return;
  }
  window.addEventListener('mousemove', onDrawingMouseMove);
  onCleanup(() => {
    window.removeEventListener('mousemove', onDrawingMouseMove);
  });
});

function onCanvasMouseDown(event: MouseEvent): void {
  if (event.button !== 0) return;

  // questions 模式：先依子模式徹底分流，避免 entity 拖曳 / grid-mask 點擊
  // 與 SafeArea 繪圖狀態機互相干擾
  if (props.mode === 'questions') {
    if (questionSubMode.value === 'safe-area') {
      handleQuestionsModeMouseDown(event);
    }
    // entity 子模式：實體拖曳由各自的 hitbox @mousedown 處理；空白點擊不動作
    // grid-mask 子模式：用 @click（非 mousedown）由 onGridMaskClick 處理
    return;
  }

  if (props.mode !== 'arena') return;

  // 檢查是否點到既有線：若是，emit 'line-select' 不開始畫新線
  const target = event.target as Element;
  const lineId = target.getAttribute?.('data-line-id');
  if (lineId) {
    emit('line-select', lineId);
    return;
  }

  // 點擊空白 → 開始畫新線（並清掉之前的選取）
  emit('line-select', null);
  const start = screenToLogical(event.clientX, event.clientY);
  if (!start) return;
  event.preventDefault();
  const clamped = clampToArena(start);
  draftLine.value = { start: clamped, end: clamped };

  window.addEventListener('mousemove', onCanvasMouseMove);
  window.addEventListener('mouseup', onCanvasMouseUp);
}

function onCanvasMouseMove(event: MouseEvent): void {
  if (!draftLine.value) return;
  const p = screenToLogical(event.clientX, event.clientY);
  if (!p) return;
  draftLine.value = { start: draftLine.value.start, end: clampToArena(p) };
}

function onCanvasMouseUp(): void {
  const draft = draftLine.value;
  window.removeEventListener('mousemove', onCanvasMouseMove);
  window.removeEventListener('mouseup', onCanvasMouseUp);
  draftLine.value = null;
  if (!draft) return;

  // 過濾過短的線（avoid「點一下不小心建立 0 長度線」）
  const dx = draft.end.x - draft.start.x;
  const dy = draft.end.y - draft.start.y;
  if (Math.hypot(dx, dy) < 5) return;

  emit('line-create', {
    id: generateLineId(),
    start: draft.start,
    end: draft.end,
  });
}

/** 不依賴 crypto API（測試環境保險）的簡易 id 生成 */
function generateLineId(): string {
  return `line-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// ----------------------------------------------------------------------
// 卸載清理
// ----------------------------------------------------------------------

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onWaymarkMouseMove);
  window.removeEventListener('mouseup', onWaymarkMouseUp);
  window.removeEventListener('mousemove', onCanvasMouseMove);
  window.removeEventListener('mouseup', onCanvasMouseUp);
  // watchEffect cleanup 理論上會處理，但卸載期競態保險：再移除一次
  window.removeEventListener('mousemove', onDrawingMouseMove);
  // Phase 2: entity 拖曳的 window listener
  window.removeEventListener('mousemove', onEntityMouseMove);
  window.removeEventListener('mouseup', onEntityMouseUp);
});

// ----------------------------------------------------------------------
// 渲染輔助
// ----------------------------------------------------------------------

const viewBox = computed(() => `0 0 ${props.arena.size.width} ${props.arena.size.height}`);
const circleRadius = computed(() =>
  Math.min(props.arena.size.width, props.arena.size.height) / 2,
);

function positionFor(id: WaymarkId): Point2D | undefined {
  if (draggingId.value === id && dragPosition.value) return dragPosition.value;
  return props.waymarks[id];
}

const renderableWaymarks = computed(() =>
  WAYMARK_IDS.filter((id) => positionFor(id) !== undefined).map((id) => ({
    id,
    pos: positionFor(id) as Point2D,
    color: WAYMARK_COLOR[id],
    isDragging: draggingId.value === id,
  })),
);

const lines = computed(() => props.arena.lines ?? []);

/** 背景圖 URL - 套 imagePathPrefix 後加 cache bust */
const backgroundImageUrl = computed(() => {
  const raw = props.arena.backgroundImage;
  if (!raw) return '';
  // 若已是絕對 URL（http://、data:、/）則不加前綴 - imagePathPrefix 僅針對相對路徑
  const isAbsolute = /^(https?:|data:|\/)/i.test(raw);
  const base = isAbsolute ? raw : `${props.imagePathPrefix}${raw}`;
  if (props.imageCacheToken > 0) {
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}t=${props.imageCacheToken}`;
  }
  return base;
});

/** SVG 整體 cursor 樣式 - 依模式 */
const svgCursor = computed(() => {
  if (props.mode === 'waymarks') {
    return draggingId.value ? 'cursor-grabbing' : '';
  }
  if (props.mode === 'arena') {
    return 'cursor-crosshair';
  }
  // questions 模式：依子模式分流 cursor 暗示
  if (questionSubMode.value === 'entity') {
    // 拖曳中 → grabbing；其餘交給 hitbox 自身的 cursor-grab
    return draggingEntityId.value ? 'cursor-grabbing' : '';
  }
  if (questionSubMode.value === 'grid-mask') {
    return 'cursor-pointer';
  }
  // safe-area：啟用工具時 crosshair 暗示「點擊會放下頂點」
  return activeDrawingTool.value ? 'cursor-crosshair' : '';
});

/**
 * 右鍵（contextmenu）- 繪圖進行中時取消並阻止預設選單。
 * 非繪圖狀態放行，讓瀏覽器的右鍵選單正常顯示（方便開發者 debug）。
 */
function onCanvasContextMenu(event: MouseEvent): void {
  if (isDrawing.value && drawingPoints.value.length > 0) {
    event.preventDefault();
    editorStore.cancelDrawing();
  }
}

// ----------------------------------------------------------------------
// questions 模式 - boss 面嚮 + safeAreas 渲染
// ----------------------------------------------------------------------

/**
 * Boss 面嚮圖示 - 使用 PNG 素材（與 Player ArenaMap WYSIWYG 一致）。
 * 素材本身正面朝北，外層 <g rotate(facing)> 旋轉到玩家設定方位。
 *
 * 【路徑解析 - 與 backgroundImageUrl 同邏輯】
 *   素材實際存放於 player 的 public/assets/boss/，相對 player 根的路徑。
 *   editor 三種環境路徑差異：
 *     1. 本機 dev：editor server 透過 localFileApi plugin 代理 /assets/ 路徑 → 直接相對即可
 *     2. published 模式：editor 部署在 /<repo>/editor/，相對解析會變
 *        /<repo>/editor/assets/boss/... → 404；需要 imagePathPrefix='../' 跳到 player 根
 *     3. upload 模式（朋友自行上傳 JSON）：與 published 同源，套同前綴
 *   bossImageHref 套用 imagePathPrefix（與 backgroundImageUrl 共用同一機制），
 *   絕對 URL（http://、data:、/）保留原值不加前綴。
 */
const BOSS_IMAGE_SIZE = 130;
const BOSS_IMAGE_HREF_RAW = 'assets/boss/boss-marker.png';

const bossImageHref = computed(() => {
  // 與 backgroundImageUrl 同套絕對 URL 偵測，避免誤套前綴破壞外部資源
  const isAbsolute = /^(https?:|data:|\/)/i.test(BOSS_IMAGE_HREF_RAW);
  return isAbsolute ? BOSS_IMAGE_HREF_RAW : `${props.imagePathPrefix}${BOSS_IMAGE_HREF_RAW}`;
});

/**
 * 王的實際繪製位置：
 *   - entity 子模式拖曳中 → 暫態座標（liveBossPosition）
 *   - 其他情境 → bossState.position 或 arena.center fallback
 */
const resolvedBossPosition = computed<Point2D>(() => liveBossPosition.value);

/**
 * 王面嚮箭頭的 CSS rotate 角度。
 * 沿用 player ArenaMap 的設計：素材基準為朝北，rotate(facing) 即正確。
 */
const bossArrowRotation = computed(() =>
  props.bossState ? facingToCssRotation(props.bossState.facing) : 0,
);

/** <image> 左上角座標 - 讓圖片中心對齊 bossPosition */
const bossImageX = computed(() => resolvedBossPosition.value.x - BOSS_IMAGE_SIZE / 2);
const bossImageY = computed(() => resolvedBossPosition.value.y - BOSS_IMAGE_SIZE / 2);

const showBossFacing = computed(() => props.mode === 'questions' && props.bossState !== null);

const showSafeAreas = computed(() => props.mode === 'questions');

/** Polygon 點轉為 SVG points 屬性字串 */
function polygonPointsAttr(points: Point2D[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

// ----------------------------------------------------------------------
// Draft Layer 預覽計算
// ----------------------------------------------------------------------

/** Circle 預覽：從第 1 點（圓心）拉半徑到游標 */
const draftCircle = computed(() => {
  if (activeDrawingTool.value !== 'circle') return null;
  if (drawingPoints.value.length !== 1 || !currentMousePos.value) return null;
  const center = drawingPoints.value[0];
  return { center, radius: calculateRadius(center, currentMousePos.value) };
});

/** Rect 預覽：從第 1 點拉對角到游標，用 normalizeRect 確保方向正確 */
const draftRect = computed(() => {
  if (activeDrawingTool.value !== 'rect') return null;
  if (drawingPoints.value.length !== 1 || !currentMousePos.value) return null;
  return normalizeRect(drawingPoints.value[0], currentMousePos.value);
});

/**
 * Polygon 預覽：已點擊的頂點 + 從最後一點到游標的虛線。
 *
 * 若 canSnapPolygon 為 true，虛線的「游標端」自動吸到起點座標，
 * 視覺上提示「點下去就會閉合」。
 */
const draftPolygon = computed(() => {
  if (activeDrawingTool.value !== 'polygon') return null;
  const pts = drawingPoints.value;
  if (pts.length === 0 || !currentMousePos.value) return null;
  const dashTarget = canSnapPolygon.value ? pts[0] : currentMousePos.value;
  return { points: pts, dashEnd: dashTarget, snapping: canSnapPolygon.value };
});
</script>

<template>
  <svg
    ref="svgRef"
    :viewBox="viewBox"
    preserveAspectRatio="xMidYMid meet"
    role="img"
    data-testid="editable-arena"
    :data-mode="mode"
    :data-sub-mode="mode === 'questions' ? questionSubMode : null"
    class="block w-full h-full select-none"
    :class="svgCursor"
    @mousedown="onCanvasMouseDown"
    @click="onGridMaskClick"
    @contextmenu="onCanvasContextMenu"
  >
    <!-- ===== Layer: 場地背景 ===== -->
    <g data-layer="background">
      <rect
        v-if="arena.shape === 'square'"
        x="0"
        y="0"
        :width="arena.size.width"
        :height="arena.size.height"
        fill="#1F2937"
        stroke="#10B981"
        stroke-width="3"
      />
      <circle
        v-else
        :cx="arena.center.x"
        :cy="arena.center.y"
        :r="circleRadius"
        fill="#1F2937"
        stroke="#10B981"
        stroke-width="3"
      />

      <!-- 背景圖（若有） -->
      <image
        v-if="backgroundImageUrl"
        :href="backgroundImageUrl"
        x="0"
        y="0"
        :width="arena.size.width"
        :height="arena.size.height"
        preserveAspectRatio="xMidYMid slice"
      />

      <!-- 中心十字參考線（編輯時對位用） -->
      <line
        :x1="arena.center.x"
        y1="0"
        :x2="arena.center.x"
        :y2="arena.size.height"
        stroke="#10B98155"
        stroke-width="1"
        stroke-dasharray="6 6"
        pointer-events="none"
      />
      <line
        x1="0"
        :y1="arena.center.y"
        :x2="arena.size.width"
        :y2="arena.center.y"
        stroke="#10B98155"
        stroke-width="1"
        stroke-dasharray="6 6"
        pointer-events="none"
      />
    </g>

    <!-- ===== Layer: 破損格遮罩（與 Player 同視覺）=====
         所有子模式都顯示，讓出題者隨時看到當前破壞狀態。
         pointer-events=none：點擊穿透，給 grid-mask 子模式的 click 處理。 -->
    <g
      v-if="brokenTiles.length > 0"
      data-layer="arena-mask"
      pointer-events="none"
    >
      <g
        v-for="tile in brokenTiles"
        :key="`mask-${tile.index}`"
        :data-mask-index="tile.index"
      >
        <rect
          :x="tile.x"
          :y="tile.y"
          :width="tile.width"
          :height="tile.height"
          fill="rgba(0, 0, 0, 0.65)"
          stroke="rgba(231, 76, 60, 0.8)"
          stroke-width="1.5"
        />
        <line
          :x1="tile.x"
          :y1="tile.y"
          :x2="tile.x + tile.width"
          :y2="tile.y + tile.height"
          stroke="rgba(231, 76, 60, 0.75)"
          stroke-width="2"
        />
        <line
          :x1="tile.x + tile.width"
          :y1="tile.y"
          :x2="tile.x"
          :y2="tile.y + tile.height"
          stroke="rgba(231, 76, 60, 0.75)"
          stroke-width="2"
        />
      </g>
    </g>

    <!-- ===== Layer: grid-mask 輔助網格線 =====
         僅 grid-mask 子模式顯示，幫助出題者對齊。pointer-events=none 不擋 click。 -->
    <g
      v-if="isGridMaskSubMode && gridLines"
      data-layer="grid-helper"
      pointer-events="none"
    >
      <line
        v-for="x in gridLines.verticals"
        :key="`gv-${x}`"
        :x1="x"
        y1="0"
        :x2="x"
        :y2="arena.size.height"
        stroke="rgba(212, 175, 55, 0.5)"
        stroke-width="1"
        stroke-dasharray="4 4"
      />
      <line
        v-for="y in gridLines.horizontals"
        :key="`gh-${y}`"
        x1="0"
        :y1="y"
        :x2="arena.size.width"
        :y2="y"
        stroke="rgba(212, 175, 55, 0.5)"
        stroke-width="1"
        stroke-dasharray="4 4"
      />
    </g>

    <!-- ===== Layer: 已存在的輔助線 ===== -->
    <!-- 介於背景與 waymark 之間 -->
    <g data-layer="lines">
      <g v-for="line in lines" :key="line.id">
        <!-- 命中熱區（透明粗線，方便點擊細線） -->
        <line
          :x1="line.start.x"
          :y1="line.start.y"
          :x2="line.end.x"
          :y2="line.end.y"
          stroke="transparent"
          stroke-width="20"
          :data-line-id="line.id"
          :class="mode === 'arena' ? 'cursor-pointer' : ''"
        />
        <!-- 視覺線 -->
        <line
          :x1="line.start.x"
          :y1="line.start.y"
          :x2="line.end.x"
          :y2="line.end.y"
          :stroke="line.color ?? '#FBBF24'"
          :stroke-width="(line.thickness ?? 2) * (selectedLineId === line.id ? 2 : 1)"
          pointer-events="none"
        />
        <!-- 選取狀態：兩端顯示小圓點 -->
        <template v-if="selectedLineId === line.id">
          <circle
            :cx="line.start.x"
            :cy="line.start.y"
            r="6"
            fill="#10B981"
            pointer-events="none"
          />
          <circle
            :cx="line.end.x"
            :cy="line.end.y"
            r="6"
            fill="#10B981"
            pointer-events="none"
          />
        </template>
      </g>
    </g>

    <!-- ===== Layer: 正在拖曳的暫態線 ===== -->
    <g v-if="draftLine" data-layer="draft-line" pointer-events="none">
      <line
        :x1="draftLine.start.x"
        :y1="draftLine.start.y"
        :x2="draftLine.end.x"
        :y2="draftLine.end.y"
        stroke="#10B981"
        stroke-width="3"
        stroke-dasharray="4 4"
      />
      <text
        :x="draftLine.end.x + 10"
        :y="draftLine.end.y - 8"
        fill="#10B981"
        font-size="12"
        font-family="monospace"
      >({{ Math.round(draftLine.end.x) }}, {{ Math.round(draftLine.end.y) }})</text>
    </g>

    <!-- ===== Layer: Safe Areas =====
         questions 模式：渲染當前選取職能的安全區（半透明色塊），出題者預覽用。
         pointer-events=all 讓點擊事件能命中各形狀（給「點擊選取」使用）；
         無工具啟用時 mousedown 會走 selectSafeArea。
         選中的形狀邊框加粗 + 變金色，視覺區分「目前可被 Delete」的形狀。 -->
    <g v-if="showSafeAreas" data-layer="safe-areas">
      <template v-for="(area, idx) in safeAreas" :key="area.id ?? idx">
        <circle
          v-if="area.shape === 'circle'"
          :cx="area.center.x"
          :cy="area.center.y"
          :r="area.radius"
          fill="#27AE60"
          fill-opacity="0.3"
          :stroke="selectedSafeAreaId && area.id === selectedSafeAreaId ? '#D4AF37' : '#27AE60'"
          :stroke-width="selectedSafeAreaId && area.id === selectedSafeAreaId ? 4 : 2"
          :data-safe-area-shape="area.shape"
          :data-safe-area-id="area.id"
        />
        <rect
          v-else-if="area.shape === 'rect'"
          :x="area.x"
          :y="area.y"
          :width="area.width"
          :height="area.height"
          fill="#27AE60"
          fill-opacity="0.3"
          :stroke="selectedSafeAreaId && area.id === selectedSafeAreaId ? '#D4AF37' : '#27AE60'"
          :stroke-width="selectedSafeAreaId && area.id === selectedSafeAreaId ? 4 : 2"
          :data-safe-area-shape="area.shape"
          :data-safe-area-id="area.id"
        />
        <polygon
          v-else
          :points="polygonPointsAttr(area.points)"
          fill="#27AE60"
          fill-opacity="0.3"
          :stroke="selectedSafeAreaId && area.id === selectedSafeAreaId ? '#D4AF37' : '#27AE60'"
          :stroke-width="selectedSafeAreaId && area.id === selectedSafeAreaId ? 4 : 2"
          :data-safe-area-shape="area.shape"
          :data-safe-area-id="area.id"
        />
      </template>
    </g>

    <!-- ===== Layer: Draft 安全區預覽（questions 模式繪圖中） =====
         渲染繪製到一半的形狀，mouseup / next mousedown 才 commit 到 store。 -->
    <g
      v-if="isDrawing"
      data-layer="draft-safe-area"
      data-testid="draft-safe-area"
      pointer-events="none"
    >
      <!-- Circle draft：從圓心到游標的半徑 -->
      <template v-if="draftCircle">
        <circle
          :cx="draftCircle.center.x"
          :cy="draftCircle.center.y"
          :r="draftCircle.radius"
          fill="#10B981"
          fill-opacity="0.2"
          stroke="#10B981"
          stroke-width="2"
          stroke-dasharray="4 4"
        />
        <!-- 圓心標記 -->
        <circle
          :cx="draftCircle.center.x"
          :cy="draftCircle.center.y"
          r="4"
          fill="#10B981"
        />
        <text
          :x="draftCircle.center.x + 8"
          :y="draftCircle.center.y - 8"
          fill="#10B981"
          font-size="12"
          font-family="monospace"
        >r={{ Math.round(draftCircle.radius) }}</text>
      </template>

      <!-- Rect draft：起點 + 對角線到游標 -->
      <template v-else-if="draftRect">
        <rect
          :x="draftRect.x"
          :y="draftRect.y"
          :width="draftRect.width"
          :height="draftRect.height"
          fill="#10B981"
          fill-opacity="0.2"
          stroke="#10B981"
          stroke-width="2"
          stroke-dasharray="4 4"
        />
        <text
          :x="draftRect.x + draftRect.width + 6"
          :y="draftRect.y - 6"
          fill="#10B981"
          font-size="12"
          font-family="monospace"
        >{{ Math.round(draftRect.width) }}×{{ Math.round(draftRect.height) }}</text>
      </template>

      <!-- Polygon draft：已點頂點的折線 + 最後一點到游標的虛線 -->
      <template v-else-if="draftPolygon">
        <!-- 已落下的頂點連線 -->
        <polyline
          v-if="draftPolygon.points.length >= 2"
          :points="polygonPointsAttr(draftPolygon.points)"
          fill="none"
          stroke="#10B981"
          stroke-width="2"
        />
        <!-- 最後一點到游標（或磁吸到起點）的虛線 -->
        <line
          :x1="draftPolygon.points[draftPolygon.points.length - 1].x"
          :y1="draftPolygon.points[draftPolygon.points.length - 1].y"
          :x2="draftPolygon.dashEnd.x"
          :y2="draftPolygon.dashEnd.y"
          :stroke="draftPolygon.snapping ? '#D4AF37' : '#10B981'"
          stroke-width="2"
          stroke-dasharray="4 4"
        />
        <!-- 各頂點小圓點 -->
        <circle
          v-for="(pt, idx) in draftPolygon.points"
          :key="idx"
          :cx="pt.x"
          :cy="pt.y"
          :r="idx === 0 && draftPolygon.snapping ? 8 : 4"
          :fill="idx === 0 && draftPolygon.snapping ? '#D4AF37' : '#10B981'"
          :stroke="idx === 0 && draftPolygon.snapping ? 'white' : 'none'"
          :stroke-width="2"
        />
        <!-- 磁吸提示文字 -->
        <text
          v-if="draftPolygon.snapping"
          :x="draftPolygon.points[0].x + 14"
          :y="draftPolygon.points[0].y - 10"
          fill="#D4AF37"
          font-size="12"
          font-family="monospace"
          font-weight="bold"
        >點擊閉合</text>
      </template>
    </g>

    <!-- ===== Layer: Waymarks =====
         waymarks 模式：可拖曳；questions 模式：唯讀顯示作參考；arena 模式：隱藏。
         arena 隱藏的原因：避免畫線時誤拖到 waymark 命中熱區。

         【可見度強化設計（與 Player ArenaMap 對齊，WYSIWYG）】
         疊在場地背景圖上時，原本純彩色半透明底色會被雜訊吞掉。
         三層堆疊：深色外框 + 高不透明度彩色本體 + 白色描邊文字。
         drop-shadow 套在 layer 整體，讓所有標記從背景浮起。 -->
    <g
      v-if="mode !== 'arena'"
      data-layer="waymarks"
      filter="drop-shadow(0 2px 3px rgba(0,0,0,0.6))"
    >
      <g
        v-for="wm in renderableWaymarks"
        :key="wm.id"
        :data-waymark="wm.id"
        :class="
          mode === 'waymarks'
            ? wm.isDragging
              ? 'cursor-grabbing'
              : 'cursor-grab'
            : ''
        "
        @mousedown="mode === 'waymarks' ? onWaymarkMouseDown($event, wm.id) : null"
      >
        <circle
          v-if="mode === 'waymarks'"
          :cx="wm.pos.x"
          :cy="wm.pos.y"
          r="32"
          fill="transparent"
          pointer-events="all"
        />
        <template v-if="!/^\d$/.test(wm.id)">
          <!-- 深色外框 - 在任何背景都形成對比邊界 -->
          <rect
            :x="wm.pos.x - 24"
            :y="wm.pos.y - 24"
            width="48"
            height="48"
            fill="rgba(0,0,0,0.55)"
            stroke="rgba(0,0,0,0.85)"
            stroke-width="1"
            pointer-events="none"
          />
          <rect
            :x="wm.pos.x - 22"
            :y="wm.pos.y - 22"
            width="44"
            height="44"
            :fill="wm.color"
            fill-opacity="0.7"
            :stroke="wm.color"
            :stroke-width="wm.isDragging ? 4 : 2"
            pointer-events="none"
          />
          <text
            :x="wm.pos.x"
            :y="wm.pos.y + 8"
            :fill="wm.color"
            font-size="28"
            font-weight="bold"
            text-anchor="middle"
            stroke="white"
            stroke-width="3"
            paint-order="stroke"
            pointer-events="none"
          >{{ wm.id }}</text>
        </template>
        <template v-else>
          <circle
            :cx="wm.pos.x"
            :cy="wm.pos.y"
            r="24"
            fill="rgba(0,0,0,0.55)"
            stroke="rgba(0,0,0,0.85)"
            stroke-width="1"
            pointer-events="none"
          />
          <circle
            :cx="wm.pos.x"
            :cy="wm.pos.y"
            r="22"
            :fill="wm.color"
            fill-opacity="0.7"
            :stroke="wm.color"
            :stroke-width="wm.isDragging ? 4 : 2"
            pointer-events="none"
          />
          <text
            :x="wm.pos.x"
            :y="wm.pos.y + 8"
            :fill="wm.color"
            font-size="24"
            font-weight="bold"
            text-anchor="middle"
            stroke="white"
            stroke-width="3"
            paint-order="stroke"
            pointer-events="none"
          >{{ wm.id }}</text>
        </template>
        <text
          v-if="wm.isDragging"
          :x="wm.pos.x"
          :y="wm.pos.y - 36"
          fill="#10B981"
          font-size="14"
          font-family="monospace"
          text-anchor="middle"
          pointer-events="none"
        >({{ Math.round(wm.pos.x) }}, {{ Math.round(wm.pos.y) }})</text>
      </g>
    </g>

    <!-- ===== Layer: Tethers 連線（Phase 3）=====
         與 Player ArenaMap 視覺對齊：虛線 + drop-shadow。
         Role ID 端點以淡虛線（opacity=0.5 + 較粗 dasharray）示意「練習時定位玩家」。
         pointer-events=none 不擋下層互動（拖曳實體 / 點擊網格）。 -->
    <g
      v-if="renderableTethers.length > 0"
      data-layer="tethers"
      class="tethers-layer"
      pointer-events="none"
      filter="drop-shadow(0 1px 2px rgba(0,0,0,0.7))"
    >
      <line
        v-for="t in renderableTethers"
        :key="t.key"
        :x1="t.x1"
        :y1="t.y1"
        :x2="t.x2"
        :y2="t.y2"
        :stroke="t.color"
        stroke-width="4"
        stroke-linecap="round"
        :stroke-dasharray="t.isRoleEndpoint ? '8 4' : '10 6'"
        :stroke-opacity="t.isRoleEndpoint ? 0.5 : 0.85"
        :data-tether-role="t.isRoleEndpoint ? 'true' : 'false'"
      />
    </g>

    <!-- ===== Layer: Boss 面嚮指示器 =====
         entity 子模式下額外疊一層透明 hitbox 接拖曳事件。
         其他子模式 pointer-events=none 不擋下層點擊（如 grid-mask click）。 -->
    <g
      v-if="showBossFacing && bossState"
      data-layer="boss"
      :pointer-events="isEntitySubMode ? 'auto' : 'none'"
      :data-testid="'boss-facing'"
      filter="drop-shadow(0 2px 4px rgba(0,0,0,0.7))"
    >
      <g
        :transform="`rotate(${bossArrowRotation} ${resolvedBossPosition.x} ${resolvedBossPosition.y})`"
      >
        <!--
          【王面嚮指示】使用 PNG 素材（與 Player 一致 WYSIWYG）。
          素材本身正面朝北，外層 rotate(facing) 旋轉到玩家設定的方位。
        -->
        <image
          :href="bossImageHref"
          :x="bossImageX"
          :y="bossImageY"
          :width="BOSS_IMAGE_SIZE"
          :height="BOSS_IMAGE_SIZE"
          pointer-events="none"
        />
      </g>
      <!--
        entity 子模式：可拖曳的命中熱區（透明圓）。
        放在 rotate <g> 之外，這樣 hitbox 不會跟著面嚮旋轉，永遠是固定的可點圓。
      -->
      <circle
        v-if="isEntitySubMode"
        :cx="resolvedBossPosition.x"
        :cy="resolvedBossPosition.y"
        r="65"
        fill="transparent"
        :class="draggingEntityId === 'boss' ? 'cursor-grabbing' : 'cursor-grab'"
        data-testid="boss-hitbox"
        @mousedown="onEntityMouseDown($event, 'boss')"
      />
      <!-- 拖曳中顯示座標小提示 -->
      <text
        v-if="draggingEntityId === 'boss'"
        :x="resolvedBossPosition.x"
        :y="resolvedBossPosition.y - 75"
        fill="#10B981"
        font-size="14"
        font-family="monospace"
        text-anchor="middle"
        pointer-events="none"
      >({{ Math.round(resolvedBossPosition.x) }}, {{ Math.round(resolvedBossPosition.y) }})</text>
    </g>

    <!-- ===== Layer: 分身（Phase 2） =====
         與 Boss 同 z-order；entity 子模式下可拖曳。
         縮小尺寸 + 紅色光暈，視覺上「敵方但次要」。 -->
    <g
      data-layer="enemies"
      :pointer-events="isEntitySubMode ? 'auto' : 'none'"
      filter="drop-shadow(0 1px 2px rgba(0,0,0,0.6))"
    >
      <g
        v-for="enemy in enemies"
        :key="enemy.id"
        :data-enemy-id="enemy.id"
      >
        <!-- 紅色光暈圓框 - 與 Player ArenaMap 視覺一致 -->
        <circle
          :cx="liveEnemyPosition(enemy).x"
          :cy="liveEnemyPosition(enemy).y"
          r="44"
          fill="rgba(231, 76, 60, 0.12)"
          stroke="rgba(231, 76, 60, 0.55)"
          stroke-width="2"
          stroke-dasharray="4 3"
          pointer-events="none"
        />
        <g
          :transform="`rotate(${facingToCssRotation(enemy.facing)} ${liveEnemyPosition(enemy).x} ${liveEnemyPosition(enemy).y})`"
        >
          <image
            :href="bossImageHref"
            :x="liveEnemyPosition(enemy).x - 40"
            :y="liveEnemyPosition(enemy).y - 40"
            width="80"
            height="80"
            opacity="0.85"
            pointer-events="none"
          />
        </g>
        <!-- entity 子模式 hitbox -->
        <circle
          v-if="isEntitySubMode"
          :cx="liveEnemyPosition(enemy).x"
          :cy="liveEnemyPosition(enemy).y"
          r="44"
          fill="transparent"
          :class="draggingEntityId === enemy.id ? 'cursor-grabbing' : 'cursor-grab'"
          :data-enemy-hitbox="enemy.id"
          @mousedown="onEntityMouseDown($event, enemy.id)"
        />
        <!-- 拖曳座標提示 -->
        <text
          v-if="draggingEntityId === enemy.id"
          :x="liveEnemyPosition(enemy).x"
          :y="liveEnemyPosition(enemy).y - 55"
          fill="#10B981"
          font-size="12"
          font-family="monospace"
          text-anchor="middle"
          pointer-events="none"
        >({{ Math.round(liveEnemyPosition(enemy).x) }}, {{ Math.round(liveEnemyPosition(enemy).y) }})</text>
      </g>
    </g>

    <!-- ===== Layer: 自由錨點（Anchors, Phase 3.5）=====
         editor only：金黃色小圓點 + 隱形 hitbox 供拖曳。
         player 完全不渲染（純座標提供者）；其他子模式 pointer-events=none
         不擋下層互動（拖曳實體 / 點擊網格）。 -->
    <g
      data-layer="anchors"
      :pointer-events="isEntitySubMode ? 'auto' : 'none'"
      filter="drop-shadow(0 1px 2px rgba(0,0,0,0.6))"
    >
      <g
        v-for="anchor in anchors"
        :key="anchor.id"
        :data-anchor-id="anchor.id"
      >
        <!-- 視覺圓點（金黃色，r=15 - 比 waymark 小、與場地對比明顯） -->
        <circle
          :cx="liveAnchorPosition(anchor).x"
          :cy="liveAnchorPosition(anchor).y"
          r="15"
          fill="#FBBF24"
          fill-opacity="0.85"
          stroke="rgba(0, 0, 0, 0.6)"
          stroke-width="1.5"
          pointer-events="none"
        />
        <!-- 中心小黑點，視覺上像「錨點」-->
        <circle
          :cx="liveAnchorPosition(anchor).x"
          :cy="liveAnchorPosition(anchor).y"
          r="3"
          fill="#1F2937"
          pointer-events="none"
        />
        <!-- 名稱標籤（小字，避免遮擋畫布） -->
        <text
          :x="liveAnchorPosition(anchor).x"
          :y="liveAnchorPosition(anchor).y + 28"
          fill="#FBBF24"
          font-size="11"
          font-family="monospace"
          text-anchor="middle"
          stroke="rgba(0, 0, 0, 0.6)"
          stroke-width="2"
          paint-order="stroke"
          pointer-events="none"
        >{{ anchor.name }}</text>
        <!-- entity 子模式：隱形 hitbox 供拖曳（r=24 比視覺稍大方便點） -->
        <circle
          v-if="isEntitySubMode"
          :cx="liveAnchorPosition(anchor).x"
          :cy="liveAnchorPosition(anchor).y"
          r="24"
          fill="transparent"
          :class="draggingEntityId === anchor.id ? 'cursor-grabbing' : 'cursor-grab'"
          :data-anchor-hitbox="anchor.id"
          @mousedown="onEntityMouseDown($event, anchor.id)"
        />
        <!-- 拖曳座標提示 -->
        <text
          v-if="draggingEntityId === anchor.id"
          :x="liveAnchorPosition(anchor).x"
          :y="liveAnchorPosition(anchor).y - 22"
          fill="#FBBF24"
          font-size="11"
          font-family="monospace"
          text-anchor="middle"
          pointer-events="none"
        >({{ Math.round(liveAnchorPosition(anchor).x) }}, {{ Math.round(liveAnchorPosition(anchor).y) }})</text>
      </g>
    </g>
  </svg>
</template>
