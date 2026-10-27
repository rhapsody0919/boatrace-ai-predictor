/**
 * /api の関門が検索ボットを通すときの IP の範囲の表（api/_lib/searchBotIpRanges.json）が、
 * Google の公開の表と一致するかを確かめる（BOA-1110、plan §2.2「範囲の表の置き場」）。
 *
 *   node scripts/maintenance/verify-search-bot-ip-ranges.js          # 照合だけ。違えば非ゼロで終わる
 *   node scripts/maintenance/verify-search-bot-ip-ranges.js --write  # 公開の表を取って JSON を書き直す
 *
 * 表は手で書かない。このスクリプトの --write だけが書く（Vercel のビルドの中では取りに行かない）。
 * 範囲（prefixes）が変わらず creationTime だけが新しいときは書き直さない（毎日の差分を作らない）。
 *
 * 取得元（Google 公式「Googlebot の確認」）:
 *   common-crawlers.json  Googlebot・Google-InspectionTool を含む共通のクローラー
 *                         （旧 /static/search/apis/ipranges/googlebot.json は 301 でここへ転送される。2026-10-27 に確認）
 *   special-crawlers.json 特別なクローラー（plan §2.2 が挙げる2つ目の表）
 */
import { readFileSync, writeFileSync } from "node:fs";
import { compileIpRanges } from "../../api/_lib/apiGate.js";

const TABLE_PATH = new URL(
  "../../api/_lib/searchBotIpRanges.json",
  import.meta.url,
);
export const SOURCES = [
  "https://developers.google.com/static/crawling/ipranges/common-crawlers.json",
  "https://developers.google.com/static/crawling/ipranges/special-crawlers.json",
];

async function fetchSource(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json.prefixes) || json.prefixes.length === 0) {
    throw new Error(`${url}: prefixes が空か配列でない`);
  }
  const prefixes = json.prefixes
    .map((p) => p.ipv4Prefix ?? p.ipv6Prefix)
    .filter((p) => typeof p === "string");
  if (prefixes.length !== json.prefixes.length) {
    throw new Error(`${url}: ipv4Prefix・ipv6Prefix のどちらも無い行がある`);
  }
  return {
    url,
    creationTime: json.creationTime ?? null,
    prefixes: [...new Set(prefixes)].sort(),
  };
}

const sameSet = (a, b) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

const write = process.argv.includes("--write");
const fetched = await Promise.all(SOURCES.map(fetchSource));
// 書く前に関門と同じ読み方で読めることを確かめる（読めない範囲を表に入れない）
compileIpRanges({ sources: fetched });

let stored = null;
try {
  stored = JSON.parse(readFileSync(TABLE_PATH, "utf8"));
} catch (error) {
  if (!write) throw new Error(`表を読めない: ${error.message}`);
}

const diffs = fetched.flatMap((source) => {
  const old = stored?.sources?.find((s) => s.url === source.url);
  if (!old) return [`${source.url}: 表に無い`];
  if (sameSet([...old.prefixes].sort(), source.prefixes)) return [];
  const added = source.prefixes.filter((p) => !old.prefixes.includes(p));
  const removed = old.prefixes.filter((p) => !source.prefixes.includes(p));
  return [
    `${source.url}: 追加 ${added.length}（${added.slice(0, 5).join(", ")}）・削除 ${removed.length}（${removed.slice(0, 5).join(", ")}）`,
  ];
});
const extra = (stored?.sources ?? []).filter((s) => !SOURCES.includes(s.url));
for (const s of extra) diffs.push(`${s.url}: 取得元に無い表が残っている`);

if (diffs.length === 0) {
  console.log(
    `OK: 範囲の表は公開の表と一致（${fetched.map((s) => `${s.prefixes.length}件`).join("・")}）`,
  );
  process.exit(0);
}
if (!write) {
  console.error(
    `NG: 範囲の表が公開の表と違う。--write で書き直して PR にする\n  ${diffs.join("\n  ")}`,
  );
  process.exit(1);
}
const table = {
  note: "scripts/maintenance/verify-search-bot-ip-ranges.js --write が書く。手で書き換えない（BOA-1110）",
  sources: fetched,
};
writeFileSync(TABLE_PATH, `${JSON.stringify(table, null, 2)}\n`);
console.log(`書き直した:\n  ${diffs.join("\n  ")}`);
