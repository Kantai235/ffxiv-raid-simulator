<script setup lang="ts">
/**
 * ========================================================================
 * <EditableArenaMap /> - Editor 專屬可編輯場地（SVG）
 * ========================================================================
 *
 * 雙模式互動：
 *   - mode='waymarks': 拖曳 waymark 調整座標
 *   - mode='arena'   : 在背景上拖曳繪製輔助線；點擊現有線可選取
 *
 * 兩種模式互斥（不會同時拖標記又畫線），由 props.mode 控制。
 *
 * ============================================================
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
 *   mousemove → 即時更新本地暫態（dragPosition / draftLine）
 *   mouseup   → emit 結果；移除 window 事件
 *
 * window 監聽避免「游標拖出 SVG 即失追蹤」的常見坑。
 * ============================================================
 */

import { computed, onBeforeUnmount, ref, watchEffect } from 'vue';
import { storeToRefs } from 'pinia';
import type {
  Arena,
  ArenaLine,
  BossState,
  Point2D,
  SafeArea,
  Strategy,
  WaymarkId,
} from '@ffxiv-sim/shared';
import { WAYMARK_COLOR, WAYMARK_IDS, facingToCssRotation } from '@ffxiv-sim/shared';
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
const { activeDrawingTool, drawingPoints, selectedSafeAreaId } = storeToRefs(editorStore);

/**
 * 當前游標的邏輯座標（questions 模式 + 啟用工具時才追蹤）。
 *
 * Why 在 view 層而非 store：mousemove 每幀都寫，放 store 會觸發
 *      全 app 的 reactivity 鏈，浪費效能。draft layer 的預覽計算只需此元件內部
 *      reactivity 就夠了。
 */
const currentMousePos = ref<Point2D | null>(null);

/** 是否處於繪圖模式（questions 模式 + 有工具啟用） */
const isDrawing = computed(
  () => props.mode === 'questions' && activeDrawingTool.value !== null,
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

  // questions 模式：依 activeDrawingTool 分派繪圖狀態機
  if (props.mode === 'questions') {
    handleQuestionsModeMouseDown(event);
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
  // questions 模式：啟用工具時 crosshair 暗示「點擊會在此處放下安全區頂點」
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
 * Editor dev server 透過 localFileApi plugin 代理 /assets/boss/ 路徑。
 */
const BOSS_IMAGE_SIZE = 130;
const BOSS_IMAGE_HREF = 'assets/boss/boss-marker.png';

/** 王的實際繪製位置（未提供 position 則 fallback 到 arena.center） */
const resolvedBossPosition = computed<Point2D>(
  () => props.bossState?.position ?? props.arena.center,
);

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
    class="block w-full h-full select-none"
    :class="svgCursor"
    @mousedown="onCanvasMouseDown"
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

    <!-- ===== Layer: Boss 面嚮指示器 =====
         FFXIV 風格：3/4 圓 + 正面三角突起。
         缺口（含三角）方向 = 王正面，與 Player 視覺完全一致（WYSIWYG）。 -->
    <g
      v-if="showBossFacing && bossState"
      data-layer="boss"
      pointer-events="none"
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
          :href="BOSS_IMAGE_HREF"
          :x="bossImageX"
          :y="bossImageY"
          :width="BOSS_IMAGE_SIZE"
          :height="BOSS_IMAGE_SIZE"
        />
      </g>
    </g>
  </svg>
</template>
