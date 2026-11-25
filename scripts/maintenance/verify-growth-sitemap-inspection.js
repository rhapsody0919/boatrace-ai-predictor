/**
 * verify-growth-sitemap-inspection.js - sitemap から作る URL Inspection の一覧（scripts/lib/growth/sitemapInspection.js、索引の数を毎日測る）を確かめる。
 * ネットワーク・DB・壁の時計には触れない（today は固定の文字列）。
 *
 * 守る物:
 *   - レース詳細は各会場の 1R・6R・12R だけ（公開日は race_id の日付）。/en/・/ko/・/zh-TW/ は除く
 *   - ほかの ja のページは weekly。直近7日に weekly の行がある URL は飛ばし、7日以上前か一度も無い URL は回す（曜日に依らない）
 *   - 1日の上限の中で、レース詳細が先、weekly が後。済みのレースは飛ばす
 */
import assert from "node:assert/strict";
import {
  SAMPLE_RACE_NUMBERS,
  buildInspectionTargets,
  dueWeekly,
  parseSitemapLocs,
  planSitemapInspections,
} from "../lib/growth/sitemapInspection.js";

const B = "https://www.boat-ai.jp";
const loc = (p) => `  <url>\n    <loc>${B}${p}</loc>\n    <xhtml:link rel="alternate" hreflang="en" href="${B}/en${p}" />\n  </url>`;
const races = [];
for (const venue of ["01", "02"]) for (let r = 1; r <= 12; r++) races.push(`/race/2026-11-24-${venue}-${String(r).padStart(2, "0")}`);
const paths = ["/", "/blog/a", "/venue/01", "/racer/4001", ...races, "/en/blog/a", "/ko/", "/zh-TW/blog/a", "/enjoy", "/racers"];
const xml = `<?xml version="1.0"?>\n<urlset>\n${[...paths, "/blog/a"].map(loc).join("\n")}\n</urlset>`;

assert.deepEqual([...SAMPLE_RACE_NUMBERS], [1, 6, 12]);
assert.equal(parseSitemapLocs(xml).length, paths.length, "同じ loc は1回。hreflang の href は拾わない");

const t = buildInspectionTargets(xml);
assert.deepEqual(
  t.races.map((r) => r.url.slice(B.length)),
  ["01", "02"].flatMap((v) => [1, 6, 12].map((r) => `/race/2026-11-24-${v}-${String(r).padStart(2, "0")}`)),
  "各会場の 1R・6R・12R だけ",
);
assert.ok(t.races.every((r) => r.publishDate === "2026-11-24"), "公開日は race_id の日付");
assert.deepEqual(
  t.weekly.map((u) => u.slice(B.length)),
  ["/", "/blog/a", "/venue/01", "/racer/4001", "/enjoy", "/racers"],
  "ja のほかのページだけ。/race/ の標本外・/en/・/ko/・/zh-TW/ は入らない（/enjoy は /en と接頭辞が似るだけで ja）",
);

// weekly の判定: 今日 2026-11-25。最後が 11/18（7日前）→ 回す、11/19（6日前）→ 飛ばす、無い → 回す。古い順・一度も無い物が先
const today = "2026-11-25";
const u = (p) => `${B}${p}`;
assert.deepEqual(
  dueWeekly(
    [u("/a"), u("/b"), u("/c"), u("/d")],
    [
      { url: u("/a"), inspected_on: "2026-11-18" },
      { url: u("/b"), inspected_on: "2026-11-19" },
      { url: u("/d"), inspected_on: "2026-11-01" },
      { url: u("/d"), inspected_on: "2026-11-10" },
    ],
    today,
  ),
  [u("/c"), u("/d"), u("/a")],
  "一度も無い → 古い順（同じ URL の行が複数なら最新）。6日前は飛ばす",
);
assert.deepEqual(dueWeekly([u("/a")], [{ url: u("/a"), inspected_on: "2026-11-25" }], today), [], "今日済みなら飛ばす");

// 並び: レース詳細（公開日の新しい順）が先、weekly が後。済みのレースは飛ばす
const xml2 = `<urlset>${["/blog/a", "/race/2026-11-20-01-01", "/race/2026-11-24-01-01", "/race/2026-11-24-01-06", "/race/2026-11-25-01-01"]
  .map(loc)
  .join("")}</urlset>`;
const plan = (extra) =>
  planSitemapInspections({ xml: xml2, done: [], lastWeekly: [], today, max: 100, ...extra }).map((x) => `${x.checkpoint} ${x.url.slice(B.length)}`);
assert.deepEqual(plan({}), [
  "D+1 /race/2026-11-24-01-01",
  "D+1 /race/2026-11-24-01-06",
  "D+3 /race/2026-11-20-01-01",
  "weekly /blog/a",
], "当日のレース（D+1 未満）は出ない。新しい公開日が先。weekly は最後");
assert.deepEqual(plan({ max: 2 }), ["D+1 /race/2026-11-24-01-01", "D+1 /race/2026-11-24-01-06"], "上限で切るとき weekly が先に落ちる");
assert.deepEqual(
  plan({ done: [{ url: u("/race/2026-11-24-01-01"), checkpoint: "D+1" }], lastWeekly: [{ url: u("/blog/a"), inspected_on: "2026-11-24" }] }),
  ["D+1 /race/2026-11-24-01-06", "D+3 /race/2026-11-20-01-01"],
  "済みのレースと、直近の weekly は飛ばす",
);

console.log("verify-growth-sitemap-inspection: OK");
