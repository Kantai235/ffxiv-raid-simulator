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
import type { Arena, Point2D, SafeArea, Strategy } from '@ffxiv-sim/shared';
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
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'readonly',
  waymarks: () => ({}),
  bossFacing: undefined,
  bossPosition: undefined,
  safeAreas: () => [],
  userClicks: () => [],
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
         Layer 5: 王與面嚮指示器
         王用黑色圓表示，上方延伸箭頭指向面嚮方向。
         箭頭素材基準為「朝上 = 北」，CSS rotate 角度 = facingToCssRotation(facing)。
         ========================================================= -->
    <g
      v-if="showBossFacing"
      data-layer="boss"
      pointer-events="none"
      filter="drop-shadow(0 2px 4px rgba(0,0,0,0.7))"
    >
      <g
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
