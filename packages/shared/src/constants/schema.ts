/**
 * Schema 版本常數。
 *
 * Why: 依照 CLAUDE.md 第 11 點「題庫檔案需有 Schema Versioning」，
 * 任何破壞性變更（欄位刪除、語意改變）必須升版，
 * 並由前台載入時驗證；非破壞性新增欄位則保持版本不變。
 *
 * 版本格式：major.minor
 *   - major：破壞性變更（前台必須拒絕載入舊版）
 *   - minor：新增欄位（前台可向下相容）
 */
export const SCHEMA_VERSION = '1.0' as const;

/**
 * 前台所能接受的最低 schema major 版本。
 * 載入 data.json 時若 majorVersion < MIN_SUPPORTED_MAJOR 應拒絕並顯示錯誤。
 */
export const MIN_SUPPORTED_MAJOR = 1;
