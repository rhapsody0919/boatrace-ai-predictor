/**
 * venueConfig - 会場別モーター成績スクレイピング設定（BOA-264）
 *
 * 戸田・平和島は該当データ自体が公式サイトに存在しないため対象外
 * （2026-09-13、全24会場調査でユーザー確認済み）。
 *
 * parser: "genericTable" は福岡フル型・下関/motordata型・簡易ランキング型の
 * 3系統をまとめてカバーする（列の並び順・見出し文言の違いを見出し名ベースで
 * 吸収するため、実質1つの実装で足りると判明した）。それ以外の系統
 * （丸亀・児島・蒲郡・住之江・宮島・大村）は個別のparser名を持つ。
 */
export const VENUE_MOTOR_STATS_CONFIG = [
  // ①福岡フル型
  {
    venueCode: 22,
    name: "福岡",
    parser: "genericTable",
    url: "https://www.boatrace-fukuoka.com/modules/datafile/?page=index_mrankdtl",
  },
  {
    venueCode: 11,
    name: "びわこ",
    parser: "genericTable",
    url: "https://www.boatrace-biwako.jp/modules/datafile/?page=index_mrankdtl",
  },
  // ②下関/motordata型
  {
    venueCode: 19,
    name: "下関",
    parser: "genericTable",
    url: "https://www.boatrace-shimonoseki.jp/modules/datafile/?page=index_motordata",
  },
  {
    venueCode: 20,
    name: "若松",
    parser: "genericTable",
    url: "https://www.wmb.jp/modules/datafile/?page=index_motordata",
  },
  {
    venueCode: 21,
    name: "芦屋",
    parser: "genericTable",
    url: "https://www.boatrace-ashiya.com/modules/datafile/?page=index_motordata",
  },
  {
    venueCode: 23,
    name: "唐津",
    parser: "genericTable",
    url: "https://www.boatrace-karatsu.jp/modules/datafile/?page=index_motordata",
    // 2026-09-13時点、新モーター切替期間中（9/21よりランキング再開予定）でデータ非表示。
    // parser自体は他5会場と共通で対応済みのため、データが復活次第自動的に取得できる
  },
  {
    venueCode: 5,
    name: "多摩川",
    parser: "genericTable",
    url: "https://www.boatrace-tamagawa.com/modules/datafile/?page=index_mrankdtl",
  },
  {
    venueCode: 14,
    name: "鳴門",
    parser: "genericTable",
    url: "https://www.n14.jp/modules/datafile/?page=index_mrankdtl",
  },
  // ③簡易ランキング型（節数・出走回数列を持たない会場が多い）
  {
    venueCode: 1,
    name: "桐生",
    parser: "genericTable",
    url: "https://www.kiryu-kyotei.com/modules/datafile/?page=index_motorrank",
  },
  {
    venueCode: 8,
    name: "常滑",
    parser: "genericTable",
    url: "https://www.boatrace-tokoname.jp/modules/datafile/",
  },
  {
    venueCode: 9,
    name: "津",
    parser: "genericTable",
    url: "https://www.boatrace-tsu.com/modules/datafile/?page=index_motorrank",
  },
  {
    venueCode: 10,
    name: "三国",
    parser: "genericTable",
    url: "https://www.boatrace-mikuni.jp/modules/datafile/",
  },
  {
    venueCode: 13,
    name: "尼崎",
    parser: "genericTable",
    url: "https://www.boatrace-amagasaki.jp/modules/datafile/",
  },

  // 以下、専用パーサーが必要な会場（実装予定）
  // ④asp/htmlmade型
  // { venueCode: 15, name: "丸亀", parser: "marugame", url: "..." }, // JS描画のため要ブラウザ取得
  // { venueCode: 16, name: "児島", parser: "kojima", url: "https://www.kojimaboat.jp/asp/htmlmade/kojima/motor/motor02.htm" },
  // ⑤独自asp legacy型
  // { venueCode: 7, name: "蒲郡", parser: "gamagori", url: "..." },
  // { venueCode: 12, name: "住之江", parser: "suminoe", url: "..." },
  // ⑦PDF配布/完全独自CMS
  // { venueCode: 17, name: "宮島", parser: "miyajimaPdf", url: "..." }, // PDF解析が必要
  // { venueCode: 24, name: "大村", parser: "omura", url: "https://omurakyotei.jp/data/motor.php" },
];

// 対象外会場（データ自体が存在しないため、明示的に除外理由を記録しておく）
export const EXCLUDED_VENUES = {
  2: "戸田 — 累積モーター成績ページという概念自体が公式サイトに存在しない",
  4: "平和島 — 累積モーター成績ページという概念自体が公式サイトに存在しない",
};
