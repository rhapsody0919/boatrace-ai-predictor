// 更新のお知らせ（/updates・ja のトップの帯・メニュー）の中身。設計: docs/design/site-updates/
// 書き手は毎朝の定期の作業（docs/design/site-updates/spec.md の「書き手」）。候補は scripts/maintenance/site-updates-candidates.js が出す。
// 形と禁止語は scripts/maintenance/verify-site-updates.js が見る。
//
// 中身は月ごとのファイル（src/data/siteUpdates/YYYY-MM.js）に書く。1ファイルが大きさの線（実質400行）に近づいたら、
// その月を YYYY-MM-2.js のように分け、下の import と並びに足す（新しい月も同じ）。ここは月をつなぐだけ
//
// - 並びは date の新しい順（同じ日は書いた順）
// - date は本番に出た日（JST、ADR-0106 の定時）
// - kind: "feature"（新機能）| "improvement"（改善）| "minor"（細かい改善。月ごとに畳み、帯と NEW に出さない）
// - id は変えない（帯の×の記録に使う）。title は40字・body は90字まで。minor は body を書かない
// - path は「見てみる」の行き先（ja のパス）。blogId は src/data/blog-posts/{id}.json
// - prs は元の PR の番号（画面には出さない。候補の機械が既出を外すのに使う）
import m202611 from "./siteUpdates/2026-11.js";
import m202610 from "./siteUpdates/2026-10.js";

export const SITE_UPDATES = [...m202611, ...m202610];

export const SITE_MAKING = [
  { id: "analysis-tool", title: "データ分析ツールを見やすく" },
  { id: "racer-page", title: "選手ページの見直し" },
];
