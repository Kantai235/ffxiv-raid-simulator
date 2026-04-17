/**
 * @ffxiv-sim/shared - 對外總入口。
 *
 * Player 與 Editor 透過此檔案引用所有共用型別與常數，
 * 例如：
 *   import { Question, ROLE_IDS, SCHEMA_VERSION } from '@ffxiv-sim/shared';
 */
export * from './types';
export * from './constants';
export * from './utils';
