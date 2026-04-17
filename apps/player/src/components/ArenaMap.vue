<script setup lang="ts">
/**
 * ========================================================================
 * <ArenaMap /> - 共用場地元件（作答 / 回顧 / 唯讀 三模式）
 * ========================================================================
 *
 * 此元件為整個系統的視覺核心，負責：
 *   1. 繪製副本場地背景（方形 / 圓形）
 *   2. 渲染攻略組定義的場地標記（Waymarks A-D, 1-4）
 *   3. 在 review 模式下疊加半透明安全區（圓 / 矩形 / 多邊形）
 *   4. 繪製王的面嚮指示器（箭頭）
 *   5. 繪製玩家點擊軌跡
 *   6. 在 interactive 模式下捕捉點擊並 emit 邏輯座標
 *
 * ============================================================
 * 【座標系約定 - 與 packages/shared/types/geometry.ts 一致】
 * ============================================================
 *   - 原點：場地【左上角】（與 DOM/Canvas 一致，也與 shared 的 SafeArea 定義一致）
 *   - x 軸：向右為正
 *   - y 軸：向下為正
 *   - 單位：Arena.size 定義的邏輯座標（建議 1000×1000）
 *
 *   emit 'click' 的座標也是【左上原點】邏輯座標，呼叫端可直接餵進 isPointInSafeArea
 *   進行命中判定，無需任何轉換。
 *
 *   TODO: 初版 spec 曾要求「以場地中心為原點」，經確認後改採全專案統一的左上原點。
 *         若未來需改變此慣例，需同步調整 shared/utils/geometry.ts 與所有 SafeArea 定義。
 * ============================================================
 *
 * 【SVG ViewBox 縮放原理】
 *   SVG 用 viewBox="0 0 W H" 宣告邏輯座標空間，瀏覽器會自動將 SVG 元素在 DOM 中的
 *   實際像素大小（由 CSS 決定）映射到此邏輯空間。因此：
 *     - 我們用邏輯座標（Arena.size）繪製所有圖形，不關心實際像素
 *     - 收到滑鼠事件時，clientX/clientY 是像素座標，需除以「像素/邏輯比例」轉回邏輯座標
 *     - 此比例 = boundingRect.width / arena.size.width
 *   此機制下畫面縮放、響應式調整都不會影響邏輯座標的正確性。
 * ============================================================
 */

import { computed, ref } from 'vue';
import type {
  Arena,
  EnemyEntity,
  Point2D,
  SafeArea,
  Strategy,
  Tether,
  WaymarkId,
} from '@ffxiv-sim/shared';
import { WAYMARK_COLOR, WAYMARK_IDS, facingToCssRotation } from '@ffxiv-sim/shared';

type ArenaMapMode = 'interactive' | 'review' | 'readonly';

interface Props {
  /** 元件運作模式 - 影響互動性與部分圖層顯示 */
  mode?: ArenaMapMode;
  /** 場地資訊（形狀、尺寸、背景圖） */
  arena: Arena;
  /** 攻略組定義的場地標記（可選） */
  waymarks?: Strategy['waymarks'];
  /**
   * 王的面嚮（度，正北 0、順時針）。
   * 若提供則繪製箭頭指示器；可搭配 bossPosition 覆寫位置，未提供則畫於 arena.center。
   */
  bossFacing?: number;
  /**
   * 王的位置（邏輯座標，左上原點）。
   * 未提供則使用 arena.center。
   */
  bossPosition?: Point2D;
  /**
   * 正確解答的安全區，僅在 mode='review' 時繪製。
   * Why: 避免在 interactive 模式下意外洩漏答案。
   */
  safeAreas?: SafeArea[];
  /** 玩家的點擊軌跡 */
  userClicks?: Point2D[];
  /**
   * 分身列表（Phase 1 動態實體系統）。
   * 每個實體擁有獨立座標與面嚮，樣式上為王的縮小灰紅色版本。
   */
  enemies?: EnemyEntity[];
  /**
   * 破損網格索引（Phase 1 動態場地）。
   * 依賴 arena.grid 提供的 rows/cols。若無 grid 或陣列空則不渲染。
   */
  arenaMask?: number[];
  /**
   * 實體連線（Phase 1 連線機制）。
   * sourceId / targetId 依「'boss' → enemies → waymarks」順序解析；
   * 任一端無法解析則該條連線略過不畫（優雅降級）。
   */
  tethers?: Tether[];
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'readonly',
  waymarks: () => ({}),
  bossFacing: undefined,
  bossPosition: undefined,
  safeAreas: () => [],
  userClicks: () => [],
  enemies: () => [],
  arenaMask: () => [],
  tethers: () => [],
});

const emit = defineEmits<{
  /** 點擊場地時觸發，僅在 interactive 模式下 emit */
  (e: 'click', point: Point2D): void;
}>();

/**
 * SVG 根元素 ref，用於 getBoundingClientRect 做座標換算。
 * 採 ref 而非 query，因 ref 在 Vue 生命週期內有保證，且 SSR/測試更穩定。
 */
const svgRef = ref<SVGSVGElement | null>(null);

// ========================================================================
// computed：場地形狀與尺寸
// ========================================================================

const viewBox = computed(() => `0 0 ${props.arena.size.width} ${props.arena.size.height}`);

/** 圓形場地的半徑（內切於 size 矩形） */
const circleRadius = computed(() =>
  Math.min(props.arena.size.width, props.arena.size.height) / 2,
);

/** 王的實際繪製位置（未提供 bossPosition 時 fallback 到 arena.center） */
const resolvedBossPosition = computed<Point2D>(() => props.bossPosition ?? props.arena.center);

/**
 * 王面嚮箭頭的 CSS rotate 角度。
 * 素材基準為「朝上 = 北」，見 shared/utils/facing.ts 的 facingToCssRotation 說明。
 */
const bossArrowRotation = computed(() =>
  props.bossFacing === undefined ? 0 : facingToCssRotation(props.bossFacing),
);

// ========================================================================
// 點擊座標轉換
// ========================================================================

/**
 * 將滑鼠事件的螢幕座標轉換為場地邏輯座標。
 *
 * 【演算法】
 *   1. 取得 SVG 元素在 viewport 中的實際像素範圍（getBoundingClientRect）
 *   2. 計算點擊點在此範圍內的相對像素位置（clientX − rect.left）
 *   3. 乘上「邏輯座標 / 像素」比例 = arena.size.width / rect.width
 *
 * 【為何不用 SVGSVGElement.createSVGPoint + getScreenCTM】
 *   那套 API 更通用（支援 SVG 內 transform 巢狀），但我們的 SVG 無 transform，
 *   用 getBoundingClientRect 足夠且相容性更好、jsdom 測試友善（jsdom 不實作 getScreenCTM）。
 *
 * 【邊界情況】
 *   - rect.width === 0 時（元件未掛載或被隱藏）：回傳 null，由呼叫端決定行為
 *   - 點擊位置超出 SVG 邊界：理論上瀏覽器不會派發此事件到 SVG，但若發生仍可能 emit
 *     負值或超過 size 的值。呼叫端（練習畫面）應自行判斷是否為有效點擊。
 */
function screenToLogical(event: MouseEvent): Point2D | null {
  const svg = svgRef.value;
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;

  // 像素 → 邏輯座標的比例。寬高獨立計算以支援未來非 1:1 場地。
  const scaleX = props.arena.size.width / rect.width;
  const scaleY = props.arena.size.height / rect.height;

  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function handleClick(event: MouseEvent): void {
  if (props.mode !== 'interactive') return;
  const logical = screenToLogical(event);
  if (logical) emit('click', logical);
}

// ========================================================================
// 圖層渲染 helpers
// ========================================================================

/**
 * Waymark 列表（僅含有座標者），供 template v-for 使用。
 * 注意：這裡過濾掉未定義的 waymark，避免渲染出孤兒元素。
 */
const renderableWaymarks = computed(() =>
  WAYMARK_IDS.filter((id) => props.waymarks[id] !== undefined).map((id) => {
    const pos = props.waymarks[id];
    // 型別守衛已由 filter 保證，但 TS 推論不到，需顯式 assert
    return { id, pos: pos as Point2D, color: WAYMARK_COLOR[id] };
  }),
);

/**
 * 安全區是否應顯示：僅 review 模式。
 * Why: interactive 模式下顯示安全區等於洩漏答案。
 */
const showSafeAreas = computed(() => props.mode === 'review');

/**
 * 場地輔助線列表（出題者於 Editor 繪製，存於 arena.lines）。
 *
 * 預設色與粗細：若資料未指定，套用低調的金色細線（與 ffxiv-accent 系一致）。
 * Why 預設低調：輔助線是「視覺參考」非主視覺，不該搶過 waymark 與安全區的注意力。
 */
const DEFAULT_LINE_COLOR = 'rgba(212, 175, 55, 0.5)'; // ffxiv-accent 半透明
const DEFAULT_LINE_THICKNESS = 2;

const arenaLines = computed(() => props.arena.lines ?? []);

/**
 * 將 Polygon 的頂點轉為 SVG points 屬性字串。
 * SVG <polygon> 要求形如 "x1,y1 x2,y2 x3,y3"。
 */
function polygonPointsAttr(points: Point2D[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

// ========================================================================
// 其他視覺計算
// ========================================================================

/**
 * Boss 面嚮圖示 - 使用 PNG 素材（assets/boss/boss-marker.png）。
 *
 * 之前嘗試用 SVG path 程式繪製，但細節太難對齊使用者參考圖；
 * 改用美術直接提供的 PNG 素材，所見即所得。
 *
 * 【素材規格】
 *   - 來源：apps/player/public/assets/boss/boss-marker.png
 *   - 視覺方向：素材本身正面朝北（與 facingToCssRotation 約定一致），
 *     外層 <g transform="rotate(facing)"> 直接旋轉即可
 *   - 尺寸：130x130 邏輯單位（直徑包含三角突起與外光暈）
 *   - 中心對齊：boss position（透過 width/2 計算 x、height/2 計算 y）
 *
 * 【為何放邏輯尺寸而非實際像素】
 * 場地採 1000x1000 邏輯座標（與 ArenaMap viewBox 對齊），素材在這個
 * 座標系下的視覺大小由 IMAGE_SIZE 常數決定，與素材本身的實際 DPI 無關。
 */
const BOSS_IMAGE_SIZE = 130;
/** 圖片素材路徑（player public 下的相對路徑） */
const BOSS_IMAGE_HREF = 'assets/boss/boss-marker.png';

/**
 * 計算 <image> 的左上角位置 - 讓圖片中心對齊 bossPosition。
 * SVG <image> 的 x/y 是左上角座標，需要從中心扣半個邊長。
 */
const bossImageX = computed(() => resolvedBossPosition.value.x - BOSS_IMAGE_SIZE / 2);
const bossImageY = computed(() => resolvedBossPosition.value.y - BOSS_IMAGE_SIZE / 2);


/**
 * 是否顯示面嚮指示器。
 * 注意：bossFacing === 0 是合法值（正北），不能用 truthy 判斷。
 */
const showBossFacing = computed(() => props.bossFacing !== undefined);

/**
 * 場地背景圖載入失敗時的 fallback 旗標。
 * CLAUDE.md 第 9 點：圖片載入失敗需有 placeholder，不可崩潰。
 */
const backgroundFailed = ref(false);
function onBackgroundError(): void {
  backgroundFailed.value = true;
}

// ========================================================================
// Phase 1：動態網格（arenaMask）
// ========================================================================

/**
 * 將 arenaMask 轉為可渲染的破損格資料（含左上座標與寬高）。
 *
 * 渲染邏輯：
 *   - index = row * cols + col（row-major）
 *   - 每格寬高 = arena.size / { cols, rows }
 *
 * 【資料不合理時的降級】
 *   validator 已過濾 index 越界、非整數等情境；但此元件也能處理
 *   「arenaMask 提供卻無 grid」的意外輸入（直接回空陣列，不渲染），
 *   避免開發期誤用導致整個 view 崩潰。
 */
const brokenTiles = computed(() => {
  const grid = props.arena.grid;
  if (!grid || props.arenaMask.length === 0) return [];
  const tileWidth = props.arena.size.width / grid.cols;
  const tileHeight = props.arena.size.height / grid.rows;
  return props.arenaMask
    .filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < grid.rows * grid.cols)
    .map((idx) => {
      const row = Math.floor(idx / grid.cols);
      const col = idx % grid.cols;
      return {
        index: idx,
        x: col * tileWidth,
        y: row * tileHeight,
        width: tileWidth,
        height: tileHeight,
      };
    });
});

// ========================================================================
// Phase 1：連線（tethers）- sourceId / targetId 座標解析
// ========================================================================

/** Waymark ID 型別守衛 - 比較 shared 的 WAYMARK_IDS 清單 */
function isWaymarkId(id: string): id is WaymarkId {
  return (WAYMARK_IDS as readonly string[]).includes(id);
}

/**
 * 將實體 ID 解析為場上座標。支援：
 *   - 'boss'         → resolvedBossPosition
 *   - EnemyEntity.id → enemies 陣列中對應 position
 *   - WAYMARK_ID     → waymarks 對應座標
 *
 * 找不到則回 null（呼叫端應過濾掉該條連線，優雅降級）。
 *
 * Why 按此順序：'boss' 為保留字（優先）；接下來 enemies 與 waymark 本質是獨立
 *   命名空間，但 enemies 為「題目當下動態生成的實體」優先級高於「全攻略共用的 waymark」。
 */
function resolveEntityPosition(id: string): Point2D | null {
  if (id === 'boss') return resolvedBossPosition.value;
  const enemy = props.enemies.find((e) => e.id === id);
  if (enemy) return enemy.position;
  if (isWaymarkId(id)) {
    const wm = props.waymarks[id];
    if (wm) return wm;
  }
  return null;
}

/**
 * 連線顏色 → 實際 CSS 色碼的對映。
 * 採用明亮色系並保留高飽和度，方便在深色場地上依然清晰。
 */
const TETHER_COLOR_MAP: Record<Tether['color'], string> = {
  red: '#E74C3C',
  blue: '#3498DB',
  purple: '#9B59B6',
  yellow: '#F1C40F',
  green: '#2ECC71',
};

/**
 * 可渲染的連線列表 - 過濾掉任一端無法解析的條目。
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
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null),
);

// ========================================================================
// Phase 1：分身（enemies）渲染資料
// ========================================================================

/**
 * 分身 marker 視覺尺寸（縮小版 boss marker）。
 * 小於 BOSS_IMAGE_SIZE，視覺上「分身 = 弱化的王」。
 */
const ENEMY_MARKER_SIZE = 80;

/**
 * 將 enemies 轉為渲染資料（含左上座標與 CSS 旋轉角度）。
 */
const renderableEnemies = computed(() =>
  props.enemies.map((e) => ({
    id: e.id,
    name: e.name,
    cx: e.position.x,
    cy: e.position.y,
    imgX: e.position.x - ENEMY_MARKER_SIZE / 2,
    imgY: e.position.y - ENEMY_MARKER_SIZE / 2,
    rotation: facingToCssRotation(e.facing),
  })),
);
</script>

<template>
  <!--
    SVG 根元素：
    - preserveAspectRatio="xMidYMid meet" 保持比例置中，不變形
    - role="img" 輔助可及性
    - data-mode 方便測試與 debug 檢視當前模式
    - cursor 依模式切換：interactive → crosshair，其他 → default
  -->
  <svg
    ref="svgRef"
    :viewBox="viewBox"
    :data-mode="mode"
    :data-testid="'arena-map'"
    preserveAspectRatio="xMidYMid meet"
    role="img"
    class="block w-full h-full select-none"
    :class="{ 'cursor-crosshair': mode === 'interactive' }"
    @click="handleClick"
  >
    <!-- =========================================================
         Layer 1: 場地背景
         ========================================================= -->
    <g data-layer="background">
      <!-- 底色與邊界 -->
      <rect
        v-if="arena.shape === 'square'"
        x="0"
        y="0"
        :width="arena.size.width"
        :height="arena.size.height"
        fill="#1A2A40"
        stroke="#D4AF37"
        stroke-width="2"
      />
      <circle
        v-else
        :cx="arena.center.x"
        :cy="arena.center.y"
        :r="circleRadius"
        fill="#1A2A40"
        stroke="#D4AF37"
        stroke-width="2"
      />
      <!--
        背景圖：
        - 若 arena.backgroundImage 提供且載入成功 → 顯示
        - 若載入失敗 → onBackgroundError 設旗標，不再渲染 <image>，保留純色底
        - clipPath 暫不處理（方形場地無需剪裁；圓形場地的背景超出部分會被 rect 的色覆蓋……
          TODO: 圓形場地若使用非圓形底圖，需加 <clipPath> 剪裁。
      -->
      <image
        v-if="arena.backgroundImage && !backgroundFailed"
        :href="arena.backgroundImage"
        x="0"
        y="0"
        :width="arena.size.width"
        :height="arena.size.height"
        preserveAspectRatio="xMidYMid slice"
        @error="onBackgroundError"
      />
    </g>

    <!-- =========================================================
         Layer 1.5: 破損網格遮罩（Arena Mask）
         - 位置：介於背景與輔助線之間；遮罩要壓過背景圖但不該擋住
           waymark / 安全區等重要資訊
         - 視覺：半透明黑色填滿 + 對角交叉線，表示「此格無法站立」
         - pointer-events=none：玩家仍可點擊破碎格（hit test 由
           呼叫端判斷是否算失誤；此處僅負責視覺警示）
         ========================================================= -->
    <g data-layer="arena-mask" pointer-events="none">
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
        <!-- 對角交叉線讓「破碎」視覺更直覺 -->
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

    <!-- =========================================================
         Layer 2: 場地輔助線（Arena Lines）
         由出題者於 Editor 繪製，存於 arena.lines。
         位於背景上方、Waymark 之下，避免遮擋重要的 A/B/C/D 標記。
         pointer-events=none 確保不擋住玩家對地圖的點擊。
         ========================================================= -->
    <g data-layer="lines" pointer-events="none">
      <line
        v-for="line in arenaLines"
        :key="line.id"
        :data-line-id="line.id"
        :x1="line.start.x"
        :y1="line.start.y"
        :x2="line.end.x"
        :y2="line.end.y"
        :stroke="line.color ?? DEFAULT_LINE_COLOR"
        :stroke-width="line.thickness ?? DEFAULT_LINE_THICKNESS"
      />
    </g>

    <!-- =========================================================
         Layer 3: 場地標記（Waymarks）
         A/B/C/D 繪製成彩色十字方塊；1/2/3/4 繪製成彩色圓點。

         【可見度強化設計】
         疊在場地背景圖上時，原本純彩色半透明底色會被雜訊吞掉。
         採「三層堆疊」讓標記從任何背景浮出：
           1. 最底：半透明深色描邊（外框），產生浮雕邊界
           2. 中層：彩色底 + 高不透明度（0.7），維持色彩識別
           3. 頂層：文字用 paint-order="stroke"，白色 stroke 在彩色 fill 之後，
                  無論背景明暗都可讀
         ========================================================= -->
    <g
      data-layer="waymarks"
      pointer-events="none"
      filter="drop-shadow(0 2px 3px rgba(0,0,0,0.6))"
    >
      <g v-for="wm in renderableWaymarks" :key="wm.id" :data-waymark="wm.id">
        <!-- 字母標記：方形底 + 中央字母 -->
        <template v-if="!/^\d$/.test(wm.id)">
          <!-- 深色外框（略大於本體）- 在任何背景都形成對比邊界 -->
          <rect
            :x="wm.pos.x - 24"
            :y="wm.pos.y - 24"
            width="48"
            height="48"
            fill="rgba(0,0,0,0.55)"
            stroke="rgba(0,0,0,0.85)"
            stroke-width="1"
          />
          <!-- 彩色本體 - 不透明度提升讓顏色更顯眼 -->
          <rect
            :x="wm.pos.x - 22"
            :y="wm.pos.y - 22"
            width="44"
            height="44"
            :fill="wm.color"
            fill-opacity="0.7"
            :stroke="wm.color"
            stroke-width="2"
          />
          <!-- 文字：白色 stroke 打底 + 彩色 fill，paint-order 確保 stroke 不蓋過 fill -->
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
          >{{ wm.id }}</text>
        </template>
        <!-- 數字標記：圓形底 + 中央數字 -->
        <template v-else>
          <circle
            :cx="wm.pos.x"
            :cy="wm.pos.y"
            r="24"
            fill="rgba(0,0,0,0.55)"
            stroke="rgba(0,0,0,0.85)"
            stroke-width="1"
          />
          <circle
            :cx="wm.pos.x"
            :cy="wm.pos.y"
            r="22"
            :fill="wm.color"
            fill-opacity="0.7"
            :stroke="wm.color"
            stroke-width="2"
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
          >{{ wm.id }}</text>
        </template>
      </g>
    </g>

    <!-- =========================================================
         Layer 4: 安全區（僅 review 模式）
         使用半透明綠色，讓底層 waymark 仍可辨識。
         ========================================================= -->
    <g
      v-if="showSafeAreas"
      data-layer="safe-areas"
      pointer-events="none"
    >
      <template v-for="(area, idx) in safeAreas" :key="idx">
        <circle
          v-if="area.shape === 'circle'"
          :cx="area.center.x"
          :cy="area.center.y"
          :r="area.radius"
          fill="#27AE60"
          fill-opacity="0.3"
          stroke="#27AE60"
          stroke-width="2"
          :data-safe-area-shape="area.shape"
          :data-safe-area-index="idx"
        />
        <rect
          v-else-if="area.shape === 'rect'"
          :x="area.x"
          :y="area.y"
          :width="area.width"
          :height="area.height"
          fill="#27AE60"
          fill-opacity="0.3"
          stroke="#27AE60"
          stroke-width="2"
          :data-safe-area-shape="area.shape"
          :data-safe-area-index="idx"
        />
        <polygon
          v-else
          :points="polygonPointsAttr(area.points)"
          fill="#27AE60"
          fill-opacity="0.3"
          stroke="#27AE60"
          stroke-width="2"
          :data-safe-area-shape="area.shape"
          :data-safe-area-index="idx"
        />
      </template>
    </g>

    <!-- =========================================================
         Layer 4.5: 實體連線（Tethers）
         介於安全區與實體之間，視覺上「線被圖示壓住」。
         - stroke-dasharray 產生虛線質感，與遊戲內的連線視覺接近
         - stroke-linecap round 讓線頭柔和、端點與實體 marker 過渡自然
         - drop-shadow 增加可見度（深色場地不被吞掉）
         ========================================================= -->
    <g
      data-layer="tethers"
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
        stroke-dasharray="10 6"
        stroke-opacity="0.85"
      />
    </g>

    <!-- =========================================================
         Layer 5: 王與分身
         - 王：PNG 素材 + 面嚮旋轉，優先使用 boss.position，無則 arena.center
         - 分身：同款素材縮小版 + 紅色光暈，與王視覺呼應但明顯次要
         ========================================================= -->
    <g
      data-layer="boss"
      pointer-events="none"
      filter="drop-shadow(0 2px 4px rgba(0,0,0,0.7))"
    >
      <!-- 王本體（有提供 bossFacing 才畫） -->
      <g
        v-if="showBossFacing"
        :data-testid="'boss-facing'"
        :transform="`rotate(${bossArrowRotation} ${resolvedBossPosition.x} ${resolvedBossPosition.y})`"
      >
        <!--
          【王面嚮指示】使用 PNG 素材而非程式繪製（細節難以對齊原版圖）。
          素材本身正面朝北，外層 <g rotate(facing)> 旋轉到玩家設定的方位。
          中心對齊 bossPosition：image x/y 為左上角，需扣半個邊長。
        -->
        <image
          :href="BOSS_IMAGE_HREF"
          :x="bossImageX"
          :y="bossImageY"
          :width="BOSS_IMAGE_SIZE"
          :height="BOSS_IMAGE_SIZE"
        />
      </g>

      <!-- 分身（縮小 boss marker + 紅色光暈） -->
      <g
        v-for="enemy in renderableEnemies"
        :key="enemy.id"
        :data-enemy-id="enemy.id"
      >
        <!-- 紅色光暈：微透明圓框，與王區別但保持「敵方」色調一致性 -->
        <circle
          :cx="enemy.cx"
          :cy="enemy.cy"
          :r="ENEMY_MARKER_SIZE / 2 + 4"
          fill="rgba(231, 76, 60, 0.12)"
          stroke="rgba(231, 76, 60, 0.55)"
          stroke-width="2"
          stroke-dasharray="4 3"
        />
        <g
          :transform="`rotate(${enemy.rotation} ${enemy.cx} ${enemy.cy})`"
        >
          <image
            :href="BOSS_IMAGE_HREF"
            :x="enemy.imgX"
            :y="enemy.imgY"
            :width="ENEMY_MARKER_SIZE"
            :height="ENEMY_MARKER_SIZE"
            opacity="0.85"
          />
        </g>
      </g>
    </g>

    <!-- =========================================================
         Layer 6: 玩家點擊軌跡
         多個點時用遞增編號顯示順序，對連續走位題友好。
         ========================================================= -->
    <g data-layer="user-clicks" pointer-events="none">
      <g v-for="(click, idx) in userClicks" :key="idx" :data-click-index="idx">
        <circle
          :cx="click.x"
          :cy="click.y"
          r="10"
          fill="#E74C3C"
          fill-opacity="0.9"
          stroke="white"
          stroke-width="2"
        />
        <!-- 連續點擊題才顯示序號 -->
        <text
          v-if="userClicks.length > 1"
          :x="click.x"
          :y="click.y + 4"
          fill="white"
          font-size="12"
          font-weight="bold"
          text-anchor="middle"
        >{{ idx + 1 }}</text>
      </g>
    </g>
  </svg>
</template>
