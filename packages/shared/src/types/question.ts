import type { RoleId } from '../constants/roles';
import type { Point2D, SafeArea } from './geometry';

/**
 * ========================================================================
 * 題型分類（QuestionType）
 * ========================================================================
 * 系統目前支援 4 種題型，每種題型對應不同的作答 UI 與解答結構：
 *
 *   - single-choice : 單選題（多個選項中選一個）
 *   - multi-choice  : 多選題（多個選項中選多個，順序不拘）
 *   - ordering      : 排序題（將給定選項排成正確順序）
 *   - map-click     : 地圖點擊題（在場地上點擊安全位置，可連續多點）
 *
 * Why 採用判別聯合：不同題型的解答資料結構差異大（選項 ID vs 安全區），
 *      用判別聯合 + 共用 base 介面，TypeScript 可在 switch 中精確收斂型別。
 * ========================================================================
 */
export type QuestionType = 'single-choice' | 'multi-choice' | 'ordering' | 'map-click';

/**
 * 王（Boss）狀態 - 出題時王的當前讀條與面嚮。
 */
export interface BossState {
  /** 技能名稱（顯示於讀條 UI），例如 '雙重利爪' */
  skillName: string;

  /**
   * 讀條時間（秒）。
   * 前台會以此倒數，模擬「玩家在 X 秒內必須完成走位」。
   * 倒數結束後自動結算當前作答結果。
   */
  castTime: number;

  /**
   * 王面嚮角度（單位：度 Degree）。
   *
   * ============================================================
   * 【面嚮角度約定 - 全專案唯一真實來源】
   * ============================================================
   *   - 0   度 = 面向正北（畫面上方，y 軸負方向）
   *   - 90  度 = 面向正東（畫面右方，x 軸正方向）
   *   - 180 度 = 面向正南（畫面下方）
   *   - 270 度 = 面向正西（畫面左方）
   *
   * Why 採用「正北 0 度、順時針增加」：與 FFXIV 玩家社群慣用方位
   *      （True North 巨集）一致，且與羅盤方位直觀對應，降低出題者心智負擔。
   *
   * 注意：此角度與標準數學極座標（東 0 度、逆時針）【不同】，
   *      前台繪製王模型旋轉時需做轉換：cssRotate = facing - 90（或同等）。
   * ============================================================
   */
  facing: number;

  /** 王在場地上的座標（選填，未填則使用 Arena.center） */
  position?: Point2D;
}

/**
 * 敵方分身實體 - 場上除王本身外的可追蹤目標。
 *
 * 用途舉例：M1S「模仿貓」、P6S「靈魂之影」、P8S「巨像」等機制產生的分身，
 * 需要獨立的位置與面嚮才能正確呈現 AOE 指示或牽線。
 *
 * 【id 約定】
 *   由出題者（或 editor 自動）指定，在同題目的 enemies 範圍內唯一。
 *   Tether.sourceId / targetId 可引用此 id；與 WAYMARK_ID / 'boss' 保留字衝突時，
 *   前台依「'boss' → enemies → waymarks」的順序解析。
 */
export interface EnemyEntity {
  /** 唯一識別碼（題內唯一） */
  id: string;
  /** 顯示名稱，例：'模仿貓 1'、'靈魂之影' */
  name: string;
  /** 場上位置（邏輯座標，左上原點） */
  position: Point2D;
  /** 面嚮角度（度，正北 0 順時針）- 與 BossState.facing 同約定 */
  facing: number;
}

/**
 * 自由錨點（AnchorPoint）- Tether 端點專用的「無圖示座標」。
 *
 * 用途：很多牽線機制的端點不對應任何實體（例：M1S 傾盆大貓的固定落點、
 * P3S 標靶位置）。若要強塞給 enemy 會出現「不該畫圖示卻畫了圖示」的視覺錯誤。
 * Anchor 提供「純座標」抽象，editor 可拖曳調整、player 完全隱形只當座標提供者。
 *
 * 【與 EnemyEntity 的差異】
 *   - EnemyEntity 帶 facing + 視覺圖示（縮小 boss marker），玩家看得到
 *   - AnchorPoint 只有 position，無 facing；player 端不渲染任何圖形
 *   - editor 端則畫成小金圓點便於拖曳
 *
 * 【為何不複用 EnemyEntity 加 hidden 旗標】
 *   schema 語意混淆（敵人變成「不可見的敵人」很怪），且 facing 對 anchor
 *   無意義反而變成資料欄位污染。獨立型別最乾淨。
 */
export interface AnchorPoint {
  /** 唯一識別碼（題內唯一） */
  id: string;
  /** 顯示名稱（給 editor 下拉選單辨識），例：'錨點 1'、'落雷點' */
  name: string;
  /** 場上位置（邏輯座標，左上原點） */
  position: Point2D;
}

/**
 * 視覺連線（Tether）- 實體之間的牽引/點名線。
 *
 * 用途舉例：M1S「傾盆大貓」的連線點名、P8S「靈魂痛擊」的牽線。
 *
 * ============================================================
 * 【為何採 ID 引用而非絕對座標 - 架構緣由】
 * ============================================================
 * Boss 與 Enemy 的位置在 editor 端是動態的（出題者隨時可拖曳），
 * 在 player 端未來也可能擴充為「機制中途移動」。若 Tether 存死座標：
 *   1. 拖曳 Boss 後連線端點不會跟著動 → 出現「線指向空地」的鬼影
 *   2. 編輯期需手動同步「Tether 座標 = Boss 座標」否則永遠失同步
 *   3. 任何位置變動都得跨 Question 物件搜索更新，違反單一來源原則
 *
 * 改用 ID 引用後：
 *   - 連線端點 = 「指向某實體」的宣告，渲染期才解析座標
 *   - 任意實體拖曳後下一幀連線自動跟著重繪，零維護成本
 *   - schema 變得平面化：Tether 只認 ID，不重複實體位置
 * ============================================================
 *
 * 【ID 解析順序】（player 與 editor 共同遵守）
 *   sourceId / targetId 可以是：
 *     1. 字面量 'boss' - 指向 Question.boss
 *     2. enemies[].id  - 指向分身
 *     3. anchors[].id  - 指向自由錨點（無圖示，純座標提供者）
 *     4. WaymarkId     - 指向 waymark 座標
 *   前台按此順序解析；任一端找不到對應座標則不渲染該條連線（優雅降級）。
 *
 *   Editor 端額外支援第 5 種：RoleId（'MT' | 'ST' | 'H1' ...），
 *   fallback 到 arena.center 並用淡虛線示意（player 端因不知玩家站位
 *   而不解析）。
 *
 *   Anchor 排在 enemy 之後、waymark 之前的理由：anchor 與 enemy 同樣是
 *   「題目當下動態實體」優先級對齊；waymark 是攻略級共用設定，級別較低。
 */
export interface Tether {
  sourceId: string;
  targetId: string;
  /** 連線顏色（受限選單，對應常見遊戲內視覺）。前台自行映射實際色碼 */
  color: 'red' | 'blue' | 'purple' | 'yellow' | 'green';

  /**
   * 連線種類（Phase 3.6，選填，未提供視為 'tether'）。
   *
   *   - 'tether'  : 牽引/點名線（預設）。傳達「兩個實體間有羈絆」語意。
   *   - 'movement': 移動指示。語意是「從 source 走到 target」，視覺上會用
   *                 較粗的實線/不同 dash 樣式，並可在 target 端加上箭頭圖標。
   *
   * Why 同一個 schema 加 kind 而非分兩種型別：解析、渲染管線 100% 共用
   *   （sourceId/targetId 引用、color 字面聯合、tether 圖層），只是裝飾不同；
   *   分兩個型別會迫使所有 consumer 寫雙分支判別聯合，得不償失。
   */
  kind?: 'tether' | 'movement';

  /**
   * 是否在終點（target 端）渲染箭頭圖標（Phase 3.6，選填）。
   *
   * 預設行為（未提供時）：
   *   - kind = 'movement' → true（移動本來就需要終點指示）
   *   - kind = 'tether'   → false（牽線通常不畫箭頭）
   *
   * 出題者可獨立勾選/取消。圖標方向由前台用 atan2(end - start) 計算自動旋轉。
   */
  showEndIcon?: boolean;
}

/**
 * 選擇題的單一選項。
 */
export interface QuestionOption {
  id: string;
  label: string;
}

// ========================================================================
// RoleSolution 系列 - 依題型不同攜帶不同欄位
// ========================================================================

/**
 * 所有 RoleSolution 共用的基底欄位。
 */
interface RoleSolutionBase {
  /**
   * 該職能身上的 Debuff（按出現順序排列）。
   * 引用 debuffLibrary 中的 DebuffDefinition.id。
   *
   * 空陣列表示該職能在這題沒有 debuff。
   */
  debuffs: string[];

  /**
   * 解析文字 - 用於回顧模式顯示。
   * 例如：'王腳下接刀，注意不要轉到後面踩到 D3 的 AOE'。
   *
   * Why: CLAUDE.md 第 4 點要求回顧模式提供解析，
   *      此欄位是學習效果的關鍵。
   */
  note?: string;
}

/**
 * 選擇/排序題的解答結構（單選、多選、排序共用）。
 *
 * - 單選：correctOptionIds 應只有 1 個元素
 * - 多選：correctOptionIds 為正確的選項 ID 集合，順序不重要
 * - 排序：correctOptionIds 為正確順序排列的 ID 陣列
 *
 * Why 三者共用：判定邏輯近似（ID 比對），差異只在「是否在意順序」與「是否多選」，
 *      可由 question.type 統一決定。
 */
export interface ChoiceRoleSolution extends RoleSolutionBase {
  correctOptionIds: string[];
}

/**
 * 地圖點擊題的解答結構。
 *
 * 連續走位機制（clickCount > 1）：
 *   - safeAreas 的長度應等於 clickCount
 *   - safeAreas[i] 為「第 i+1 次點擊」應落在的安全區
 *   - 玩家依序點擊，每次點擊後場景可能變化（例如 debuff 倒數扣秒）
 *
 * 單次點擊（clickCount === 1）：
 *   - safeAreas 長度為 1，玩家一次點擊定生死
 */
export interface MapClickRoleSolution extends RoleSolutionBase {
  /**
   * 各次點擊的安全區，長度需等於 Question.clickCount。
   * 每個安全區可為圓/矩形/多邊形（見 geometry.ts）。
   */
  safeAreas: SafeArea[];

  /**
   * （選填）此職能的「理想點位」，用於回顧模式的視覺指引。
   * 若 safeArea 範圍很大，理想點位可標示出最佳位置（例如安全區中心）。
   * 長度應與 safeAreas 對齊。
   */
  idealPositions?: Point2D[];
}

/**
 * RoleSolution 判別聯合 - 依題型分派。
 *
 * 注意：判別欄位不在 RoleSolution 本身（為了避免 8 職能各自重複寫 type 欄位），
 *      而是由父層 Question.type 決定。型別守衛需從 Question 端 narrow 下來。
 */
export type RoleSolution = ChoiceRoleSolution | MapClickRoleSolution;

// ========================================================================
// Question 主型別
// ========================================================================

/**
 * Question 基底欄位。
 */
interface QuestionBase {
  /** 唯一識別碼，例如 'm1s-q01' */
  id: string;

  /** 所屬副本，外鍵 → Instance.id */
  instanceId: string;

  /**
   * 所屬攻略組，外鍵 → Strategy.id。
   *
   * 【為何題目綁攻略而非僅綁副本】
   * 不同攻略對同一機制的「站位/解答」差異很大（例如 Game8 的散開位置
   * 與 MMW 完全不同）。題目若不綁攻略，出題者就無法為不同攻略各自設計解答。
   *
   * Player 端的 startSession 會用此欄位過濾出當前攻略的題目；
   * Editor 端的 QuestionsPanel 也會依此欄位過濾顯示。
   *
   * 【孤兒題目】
   * 若 strategyId 對應的攻略已被刪除，題目仍會留在 dataset 中（避免誤刪），
   * 但 Player 載入時會自動忽略。出題者應在 Editor 看到 0 題時自行 review JSON。
   */
  strategyId: string;

  /** 機制名稱（顯示用，可與 boss.skillName 不同），例如 '連續分散散開' */
  name: string;

  /** 階段（P1/P2 等），用於分類顯示 */
  phase?: number;

  /** 出題順序（同階段內排序用） */
  order?: number;

  /** 王的狀態 */
  boss: BossState;

  /**
   * 敵方分身（選填）- 除王以外的可追蹤單位。
   *
   * 未提供則視為此題只有王一個實體。渲染時與王同層（Layer 5），
   * 樣式略異（縮小 + 灰紅色調），以便玩家辨識主從關係。
   */
  enemies?: EnemyEntity[];

  /**
   * 自由錨點（選填）- Tether 端點專用的無圖示座標。
   *
   * Editor 端可拖曳調整位置；player 端不渲染任何圖形（純座標提供者）。
   * 允許「孤兒 anchor」存在（未被任何 tether 引用）- 出題者可能先建錨點再連線。
   * 詳見 AnchorPoint 介面 JSDoc。
   */
  anchors?: AnchorPoint[];

  /**
   * 破損網格索引（選填，row-major）- 此題中無法站立的網格。
   *
   * 【索引規則 - 全專案唯一真實來源】
   *   正向：index = row * cols + col   （0-based，左上到右下）
   *   反向：row = Math.floor(index / cols)、col = index % cols
   *   範圍：0 ≤ index < arena.grid.rows * arena.grid.cols
   *
   * 範例（4×4 grid，cols=4）：
   *   ┌────┬────┬────┬────┐
   *   │  0 │  1 │  2 │  3 │   row 0
   *   ├────┼────┼────┼────┤
   *   │  4 │  5 │  6 │  7 │   row 1
   *   ├────┼────┼────┼────┤
   *   │  8 │  9 │ 10 │ 11 │   row 2
   *   ├────┼────┼────┼────┤
   *   │ 12 │ 13 │ 14 │ 15 │   row 3
   *   └────┴────┴────┴────┘
   *
   * 【Schema 強制】
   *   若使用此欄位（非空陣列），其所屬 Instance.arena 必須設定 grid，
   *   否則 validator 拒絕載入 - 避免 player 端 row/col 反推時除以 undefined。
   *
   * 【1D 陣列而非 2D bitmap 的取捨】
   *   typical use case 是「16 格中破 2~3 格」這類稀疏資料，1D index 陣列
   *   比 boolean[16] 省 JSON 體積，且 toggleArenaMask 邏輯更直接（O(n) include / filter）。
   *
   * 【向下相容】
   *   未使用此欄位（undefined 或空陣列）的題目 = 場地完整，與舊資料行為相同。
   */
  arenaMask?: number[];

  /**
   * 實體連線（選填）- 呈現「傾盆大貓」等牽線機制。
   * 渲染位於 safeAreas 之上、boss/enemies 之下，視覺上「線被圖示壓住」。
   */
  tethers?: Tether[];
}

/**
 * 單選/多選/排序題。
 */
export interface ChoiceQuestion extends QuestionBase {
  type: 'single-choice' | 'multi-choice' | 'ordering';

  /** 所有可選選項（顯示順序即為 UI 顯示順序） */
  options: QuestionOption[];

  /** 8 職能的解答 */
  roleSolutions: Record<RoleId, ChoiceRoleSolution>;
}

/**
 * 地圖點擊題。
 */
export interface MapClickQuestion extends QuestionBase {
  type: 'map-click';

  /**
   * 玩家需連續點擊的次數。
   * 每個職能的 safeAreas 長度應等於此值。
   */
  clickCount: number;

  /** 8 職能的解答 */
  roleSolutions: Record<RoleId, MapClickRoleSolution>;
}

/**
 * Question 判別聯合 - 對外統一型別。
 *
 * 用法範例：
 *   if (q.type === 'map-click') {
 *     // q 在此處被收斂為 MapClickQuestion
 *     q.clickCount; // OK
 *   }
 */
export type Question = ChoiceQuestion | MapClickQuestion;
