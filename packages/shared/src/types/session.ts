import type { RoleId } from '../constants/roles';
import type { Point2D } from './geometry';

/**
 * ========================================================================
 * 練習 Session 與作答紀錄型別
 * ========================================================================
 * 用於前台 Pinia store 與「結算/回顧」UI。
 *
 * 設計原則：
 *   1. 紀錄「玩家做了什麼」與「結果為何」，不冗餘儲存題目本身（題目從 store 引用）
 *   2. 所有時間以 epoch ms 紀錄（Date.now()），方便排序與計算耗時
 *   3. 回顧模式所需的所有資料都應可從 AnswerRecord 還原，不需要重新發 fetch
 * ========================================================================
 */

/**
 * 玩家在「地圖點擊題」中的單次點擊紀錄。
 */
export interface ClickRecord {
  /** 玩家點擊的座標（場地邏輯座標，左上原點） */
  position: Point2D;
  /** 點擊時間（epoch ms） */
  timestamp: number;
}

/**
 * 單題的玩家作答紀錄（判別聯合，依題型分派）。
 */
export type PlayerAnswer =
  | {
      type: 'single-choice' | 'multi-choice' | 'ordering';
      /**
       * 玩家選擇的 option ID 集合。
       * - 單選：長度 1
       * - 多選：任意長度（順序不重要，但保留輸入順序方便回顧）
       * - 排序：依玩家點擊順序排列
       */
      selectedOptionIds: string[];
    }
  | {
      type: 'map-click';
      /** 玩家依序點擊的所有座標 */
      clicks: ClickRecord[];
    };

/**
 * 單題作答結果紀錄。
 *
 * 一個 Session 內，每題都會產生一筆 AnswerRecord，
 * 全部存入 SessionResult.answers。
 */
export interface AnswerRecord {
  /** 對應 Question.id */
  questionId: string;

  /** 玩家當時選擇的職能（同 session 中固定，但冗餘儲存以便回顧） */
  roleId: RoleId;

  /** 玩家的作答內容 */
  answer: PlayerAnswer;

  /** 是否答對（由判定函式計算填入） */
  isCorrect: boolean;

  /** 開始作答時間（epoch ms），玩家看到題目的瞬間 */
  startedAt: number;

  /** 結束時間（epoch ms），玩家送出答案或讀條結束的瞬間 */
  finishedAt: number;

  /**
   * 是否為超時自動結算（讀條歸零時玩家還沒答完）。
   * 用於回顧模式區分「答錯」與「沒答完」。
   */
  timedOut: boolean;
}

/**
 * 整場練習的結算結果。
 */
export interface SessionResult {
  /** Session 唯一識別碼（uuid 或時間戳） */
  sessionId: string;

  /** 練習的副本 ID */
  instanceId: string;

  /** 練習採用的攻略組 ID */
  strategyId: string;

  /** 玩家選擇的職能 */
  roleId: RoleId;

  /** Session 開始時間 */
  startedAt: number;

  /** Session 結束時間 */
  finishedAt: number;

  /** 各題作答紀錄（順序即出題順序） */
  answers: AnswerRecord[];

  /** 總題數（= answers.length，冗餘儲存方便顯示） */
  totalCount: number;

  /** 答對題數 */
  correctCount: number;
}
