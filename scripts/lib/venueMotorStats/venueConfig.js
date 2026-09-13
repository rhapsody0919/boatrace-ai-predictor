/**
 * venueConfig - 会場別モーター成績スクレイピング設定（BOA-264）
 *
 * 戸田・平和島は該当データ自体が公式サイトに存在しないため対象外
 * （2026-09-13、全24会場調査でユーザー確認済み）。
 *
 * parser: "genericTable" は見出し名ベースで列位置を解決するため、当初想定していた
 * 7系統のテンプレートのうち実に20会場（福岡フル型・下関/motordata型・簡易
 * ランキング型・asp/htmlmade型・大村の独自CMS）をこれ1つでカバーできることが
 * 実データ検証で判明した。蒲郡（rowspan/colspanを多用した独自レイアウト）と
 * 宮島（HTML表ではなくPDF配布）の2会場のみ個別のparser名を持つ。
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

  // ④asp/htmlmade型 — 児島は実データで汎用パーサーが動作することを確認済み
  // （見出しが「優勝」等の略記だったため、genericTable側でルート語の前方一致に対応した）
  {
    venueCode: 16,
    name: "児島",
    parser: "genericTable",
    url: "https://www.kojimaboat.jp/asp/htmlmade/kojima/motor/motor02.htm",
  },
  {
    venueCode: 15,
    name: "丸亀",
    parser: "genericTable",
    url: "https://www.marugameboat.jp/asp/htmlmade/marugame/motor/motor02.htm",
    // 2026-09-13時点、新モーター切替期間中（9/17より新モーター使用）でデータ非表示。
    // 児島と同一ベンダーテンプレートのため、データ復活後は同じparserで動作する見込み
    // （唐津と同様、当時は実データで検証できなかった）
  },

  // ⑦完全独自CMS — 大村は実データで汎用パーサーが動作することを確認済み
  // （1モーターにつき主要13列の行＋4/5/6着数のみの3列継続行、という2行1組の構成
  // だったため、見出しよりセル数が少ない行は継続行とみなしてスキップするよう対応した）
  {
    venueCode: 24,
    name: "大村",
    parser: "genericTable",
    url: "https://omurakyotei.jp/data/motor.php",
  },

  // 江戸川・浜名湖・徳山 — 当初の7系統分類では見落としていたが、実際にはいずれも
  // 汎用パーサーでそのまま動作することを確認済み（2026-09-13追加検証）
  {
    venueCode: 3,
    name: "江戸川",
    parser: "genericTable",
    url: "https://www.boatrace-edogawa.com/modules/kouryaku/motor_seiseki.php",
  },
  {
    venueCode: 6,
    name: "浜名湖",
    parser: "genericTable",
    url: "https://www.boatrace-hamanako.jp/modules/datafile/?page=index_mrankdtl",
  },
  {
    venueCode: 18,
    name: "徳山",
    parser: "genericTable",
    url: "https://www.boatrace-tokuyama.jp/modules/datafile/?page=index_mrankdtl",
  },

  // ⑤独自asp legacy型 — 蒲郡はrowspan/colspanを多用した独自レイアウトのため
  // 専用パーサーが必要（gamagori.js）。住之江は簡易ランキングページが
  // 汎用パーサーでそのまま動作することを確認済み（出走回数は別のページネーション
  // 詳細ページが必要で複雑なため今回は対象外、優出・優勝・2連対率・勝率のみ取得）
  {
    venueCode: 7,
    name: "蒲郡",
    parser: "gamagori",
    url: "https://www.gamagori-kyotei.com/asp/gamagori/kyogi/kyogihtml/contents/01history/01history_motor0703.htm",
  },
  {
    venueCode: 12,
    name: "住之江",
    parser: "genericTable",
    url: "https://www.boatrace-suminoe.jp/asp/suminoe/contents/01history/ranking_motor.php",
  },

  // ⑦PDF配布のみ — 宮島は唯一HTML表ではなくPDFで公開している会場。
  // PDFはテキスト埋め込み済み（画像スキャンではない）で座標ベースの専用パーサー
  // （miyajimaPdf.js）で対応。URLは前検日ごとに変わる可能性があるため、
  // racedata.htmlから当日リンクを解決する処理が呼び出し側で必要
  {
    venueCode: 17,
    name: "宮島",
    parser: "miyajimaPdf",
    // PDFの実URLは https://www.boatrace-miyajima.com/racedata.html 内の
    // 「モーター成績集計表」リンク（*_motor_seiseki.pdf）を都度解決する
    listingUrl: "https://www.boatrace-miyajima.com/racedata.html",
  },
];

// 対象外会場（データ自体が存在しないため、明示的に除外理由を記録しておく）
export const EXCLUDED_VENUES = {
  2: "戸田 — 累積モーター成績ページという概念自体が公式サイトに存在しない",
  4: "平和島 — 累積モーター成績ページという概念自体が公式サイトに存在しない",
};
