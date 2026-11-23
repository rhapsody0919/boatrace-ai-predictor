// 更新のお知らせ（/updates・ja のトップの帯・メニュー）の中身。設計: docs/design/site-updates/
// 書き手は窓口。候補は scripts/maintenance/site-updates-candidates.js が出す。形と禁止語は
// scripts/maintenance/verify-site-updates.js が見る。
//
// - 並びは date の新しい順（同じ日は書いた順）
// - date は本番に出た日（JST、ADR-0106 の定時）
// - kind: "feature"（新機能）| "improvement"（改善）| "minor"（細かい改善。月ごとに畳み、帯と NEW に出さない）
// - id は変えない（帯の×の記録に使う）。title は40字・body は90字まで。minor は body を書かない
// - path は「見てみる」の行き先（ja のパス）。blogId は src/data/blog-posts/{id}.json
// - prs は元の PR の番号（画面には出さない。候補の機械が既出を外すのに使う）
export const SITE_UPDATES = [
  {
    id: "2026-11-22-closed-venue-card-link",
    date: "2026-11-22",
    kind: "improvement",
    title: "開催の無い会場のカードからも、会場のページへ進めるように",
    body: "今日レースの無い会場でも、直近1年の傾向や次の開催をトップから1タップで確かめられます。",
    path: "/",
    prs: [3243],
  },
  {
    id: "2026-11-20-b2-badge-contrast",
    date: "2026-11-20",
    kind: "minor",
    title: "選手一覧の B2 の札の文字を読みやすい色に",
    prs: [3107],
  },
  {
    id: "2026-11-05-favorite-racers",
    date: "2026-11-05",
    kind: "feature",
    title: "お気に入りの選手に☆、トップに「お気に入り選手の出走」",
    body: "データ出走表の名前の横の☆で登録すると、その選手が今日走るレースがトップに並びます。",
    path: "/",
    prs: [2259, 2239, 2242],
  },
  {
    id: "2026-11-05-expected-course-win-rate",
    date: "2026-11-05",
    kind: "improvement",
    title: "データ出走表に「想定コース1着率」",
    body: "枠番でなく、その選手が入りそうなコースでの直近3期の1着率を出します。",
    prs: [2273],
  },
  {
    id: "2026-11-05-waku-tab-local",
    date: "2026-11-05",
    kind: "improvement",
    title: "枠別情報タブで当地の成績に切り替え",
    body: "6艇の表を当地だけの成績に切り替えられ、直近3期の行も並びます。",
    prs: [2269],
  },
  {
    id: "2026-11-01-race-strip",
    date: "2026-11-01",
    kind: "feature",
    title: "レース詳細の上に1R〜12Rの帯と出走6艇",
    body: "同じ会場の別のレースへ1タップで移れ、タブを開く前に6艇の顔ぶれが分かります。",
    prs: [2073],
  },
  {
    id: "2026-11-01-venue-summary",
    date: "2026-11-01",
    kind: "improvement",
    title: "会場のページに直近1年の要約と、節のページへの入口",
    body: "会場ごとの傾向を2行で読み、開催中の節のページへそのまま進めます。",
    prs: [2077],
  },
  {
    id: "2026-10-31-assist-bet-types",
    date: "2026-10-31",
    kind: "feature",
    title: "思考アシストの買い目で券種を切り替え",
    body: "2連単・2連複・3連複・拡連複を、同じ候補のまま比べられます。",
    blogId: "assist-guide",
    prs: [2027, 2039, 2061],
  },
  {
    id: "2026-10-31-meet-day-label",
    date: "2026-10-31",
    kind: "improvement",
    title: "トップの会場カードに「何日目」の札",
    body: "初日・準優勝戦の日・最終日などが、会場を開く前に分かります。",
    path: "/",
    prs: [2074],
  },
  {
    id: "2026-10-28-racer-period-stats",
    date: "2026-10-28",
    kind: "feature",
    title: "選手ページに期別成績の推移とコース別成績",
    body: "公式の期別の勝率を折れ線で、進入コースごとの2連対率を横棒で見られます。",
    blogId: "racer-profile-page-guide",
    prs: [2051],
  },
];

// 今つくっている物。0〜3件。時期を書かない。できたら SITE_UPDATES へ移し、見送ったら消す
// （オーナー決定 2026-11-23）
export const SITE_MAKING = [
  { id: "analysis-tool", title: "データ分析ツールを見やすく" },
  { id: "racer-page", title: "選手ページの見直し" },
];
