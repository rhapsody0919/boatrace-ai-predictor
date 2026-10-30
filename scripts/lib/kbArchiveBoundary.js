/**
 * K/B の長期アーカイブ（kb_archive_*）と本体テーブル（races ほか）の境目の日。
 *
 * 2025-12-02 は両方にある（races に12レース、kb に120レース）。重ねて数えないよう、
 * kb は KB_LAST_DATE 以前、本体は MAIN_TABLES_START 以降だけを読む（kb-backfill.js・
 * マイグレーション 190 の SQL の日付の定数と同じ値。verify-racer-career-stats.js が照合する）。
 */
export const MAIN_TABLES_START = "2025-12-03";
export const KB_LAST_DATE = "2025-12-02";
/** kb_archive の最初の日（kb-longterm-backfill の投入範囲） */
export const KB_FIRST_DATE = "2019-04-01";
