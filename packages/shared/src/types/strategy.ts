import type { WaymarkId } from '../constants/waymarks';
import type { Point2D } from './geometry';

/**
 * 攻略組（Strategy）- 描述某個副本「特定流派」的場地標記擺法。
 *
 * 同一副本下可有多組攻略（例如 M1S Game8 / 蘇帕醬 / 自家固定隊版本），
 * 每組擁有自己的 waymarks 配置。題目本身與攻略解耦，
 * 攻略只負責提供「場地上的視覺參考點」。
 *
 * Why 不把站位也放進來：站位（誰站哪）屬於「題目的解答」，
 *     依職能而異，因此放在 Question.roleSolutions 中而非 Strategy。
 */
export interface Strategy {
  /** 唯一識別碼，例如 'm1s-game8' */
  id: string;

  /** 所屬副本，外鍵 → Instance.id */
  instanceId: string;

  /** 攻略名稱，例如 'Game8 攻略' */
  name: string;

  /** 攻略作者/來源（選填） */
  author?: string;

  /** 補充說明，例如版本適用範圍、巨集連結等 */
  description?: string;

  /**
   * 場地標記座標表 - key 為 WaymarkId（A~D, 1~4），value 為座標。
   *
   * 設計為 Partial：攻略組可只使用部分標記（例如只用 A、1、2、3、4），
   * 未定義的 key 表示「該攻略不使用此標記」，前台不繪製。
   */
  waymarks: Partial<Record<WaymarkId, Point2D>>;
}
