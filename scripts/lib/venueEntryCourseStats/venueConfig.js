/**
 * venueConfig - 進入コース別選手成績スクレイピング対象会場設定（BOA-293）
 *
 * 対象は「/modules/raceinfo/?page=index_racecourse」で選手個別データを公開する
 * 11会場のうち、浜名湖を除いた10会場（2026-09-16 Phase 6a調査で確定）から、
 * 若松を一時的に外した9会場（BOA-1165、2026-10-27）。
 * 9会場でURL・テーブル構造（列: 枠/選手名/進入/進入率/平均ST/1〜6着率）が
 * 一致しているため、単一の共有パーサー（parser.js）で対応する。
 *
 * 除外理由:
 * - 戸田・浜名湖: ToS本文に複製・転載を制限する明示的な著作権条項あり
 *   （docs/issues/DATA_SCRAPING_GAPS.md「2026-09-16 横断調査（第4弾）」参照）
 * - 児島: 別CMS（/asp/htmlmade/kojima/）で本テンプレート対象外、かつ非開催期間で
 *   実データ未確認のため別タスク送り
 * - 若松（一時除外、BOA-1165）: 9/22 以降の開催日22日すべて entry_course_table_not_found で、
 *   venue_entry_course_stats に若松の行は0件（取れたことが一度も無い）。導入時は非開催で
 *   開催中の表の形を確かめておらず fixture も無いため、パーサーの前提（thead th 11列）と
 *   合っていない見込み。drift の知らせが毎日出続け、公式へ無駄な取得もしていたので外す
 *   （失うデータは無い）。
 *   戻す条件: 次の開催（11/13〜11/18）に同じ URL を1回取って __fixtures__ に保存し、
 *   パーサーを合わせ、verify-venue-entry-course-stats-parser.js に若松の fixture を足してから、
 *   下の配列に { venueCode: 20, name: "若松", baseUrl: "https://www.wmb.jp" } を戻し、
 *   EXCLUDED_VENUES から 20 を消す
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
  // 一時除外。理由と戻す条件はファイル冒頭（BOA-1165）
  20: "若松: 開催中の表の形が未確認で一度も取れていない（entry_course_table_not_found）。11/13〜11/18 の開催で fixture を取りパーサーを合わせてから戻す（BOA-1165）",
};
