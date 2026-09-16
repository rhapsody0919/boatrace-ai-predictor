/**
 * venueConfig - 進入コース別選手成績スクレイピング対象会場設定（BOA-293）
 *
 * 対象は「/modules/raceinfo/?page=index_racecourse」で選手個別データを公開する
 * 11会場のうち、浜名湖を除いた10会場（2026-09-16 Phase 6a調査で確定）。
 * 全10会場でURL・テーブル構造（列: 枠/選手名/進入/進入率/平均ST/1〜6着率）が
 * 完全に一致しているため、単一の共有パーサー（parser.js）で対応する。
 *
 * 除外理由:
 * - 戸田・浜名湖: ToS本文に複製・転載を制限する明示的な著作権条項あり
 *   （docs/issues/DATA_SCRAPING_GAPS.md「2026-09-16 横断調査（第4弾）」参照）
 * - 児島: 別CMS（/asp/htmlmade/kojima/）で本テンプレート対象外、かつ非開催期間で
 *   実データ未確認のため別タスク送り
 */
export const VENUE_ENTRY_COURSE_STATS_CONFIG = [
  { venueCode: 5, name: "多摩川", baseUrl: "http://www.boatrace-tamagawa.com" },
  { venueCode: 8, name: "常滑", baseUrl: "http://www.boatrace-tokoname.jp" },
  { venueCode: 10, name: "三国", baseUrl: "https://www.boatrace-mikuni.jp" },
  { venueCode: 11, name: "びわこ", baseUrl: "https://www.boatrace-biwako.jp" },
  { venueCode: 13, name: "尼崎", baseUrl: "https://www.boatrace-amagasaki.jp" },
  { venueCode: 18, name: "徳山", baseUrl: "http://www.boatrace-tokuyama.jp" },
  {
    venueCode: 19,
    name: "下関",
    baseUrl: "https://www.boatrace-shimonoseki.jp",
  },
  { venueCode: 20, name: "若松", baseUrl: "https://www.wmb.jp" },
  { venueCode: 21, name: "芦屋", baseUrl: "https://www.boatrace-ashiya.com" },
  { venueCode: 23, name: "唐津", baseUrl: "https://www.boatrace-karatsu.jp" },
];

export function buildEntryCourseUrl(venue, raceNumber) {
  return `${venue.baseUrl}/modules/raceinfo/?page=index_racecourse&race=${raceNumber}`;
}

export const EXCLUDED_VENUES = {
  2: "戸田: ToS（/agreement.html）に複製・転載を制限する明示的な著作権条項があるため対象外",
  6: "浜名湖: ToS（/modules/other/?page=index_website）に戸田と同一の著作権条項があるため対象外（テンプレート自体は11会場共通の対象だった）",
  16: "児島: 別CMS（/asp/htmlmade/kojima/course/course.htm）のため本共有テンプレート対象外、かつ非開催期間で実データ未確認",
};
