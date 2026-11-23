#!/usr/bin/env node
// 更新のお知らせのデータ（src/data/siteUpdates.js）の形と計算（src/pure/siteUpdates.js）。設計 docs/design/site-updates/
// 今の時刻に依存しない（先の日付の件は見ない。画面・帯・NEW は visibleUpdates で今日までに絞る）
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { SITE_MAKING, SITE_UPDATES } from "../../src/data/siteUpdates.js";
import {
  MAKING_MAX,
  groupUpdatesByMonth,
  hasRecentUpdate,
  isWithinJstDays,
  pickBannerItem,
  visibleUpdates,
} from "../../src/pure/siteUpdates.js";

const KINDS = ["feature", "improvement", "minor"];
const TITLE_MAX = 40;
const BODY_MAX = 90;
// 「競艇」（verify-kyotei-wording.js と同じ決まり）と、eslint.config.js の bannedWords と同じ語
const BANNED = ["競艇", "数える", "似た", "ふつう", "いつも", "必ず当たる", "的中保証", "鉄板"];

const blogExists = (id) =>
  existsSync(new URL(`../../src/data/blog-posts/${id}.json`, import.meta.url));

const charLen = (s) => [...(s ?? "")].length;
const bannedIn = (text) => BANNED.filter((w) => (text ?? "").includes(w));

// 1件の規則。[誤りなら真, 文]
const itemRules = (u, hasBlog) => [
  [!/^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+$/.test(u.id ?? ""), "id は「日付-英小文字」"],
  [!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(u.date ?? ""), "date は YYYY-MM-DD"],
  [!KINDS.includes(u.kind), `kind は ${KINDS.join("・")}`],
  [charLen(u.title) < 1 || charLen(u.title) > TITLE_MAX, `title は1〜${TITLE_MAX}字`],
  [u.kind === "minor" && Boolean(u.body), "minor は body を書かない"],
  [
    u.kind !== "minor" && (charLen(u.body) < 1 || charLen(u.body) > BODY_MAX),
    `body は1〜${BODY_MAX}字`,
  ],
  [u.path !== undefined && !/^\/(?!\/)/.test(u.path), "path は / で始まるサイトの中のパス"],
  [u.blogId !== undefined && !hasBlog(u.blogId), `blogId ${u.blogId} の記事が無い`],
  [!Array.isArray(u.prs) || u.prs.some((n) => !Number.isInteger(n)), "prs は PR 番号の配列"],
  ...bannedIn(`${u.title ?? ""}${u.body ?? ""}`).map((w) => [true, `禁止語「${w}」`]),
];

const checkItem = (u, i, updates, seen, hasBlog) => {
  const at = `SITE_UPDATES[${i}] (${u.id})`;
  const rules = [
    ...itemRules(u, hasBlog),
    [seen.has(u.id), "id が重複"],
    [i > 0 && updates[i - 1].date < u.date, "日付の新しい順になっていない"],
  ];
  seen.add(u.id);
  return rules.filter(([bad]) => bad).map(([, msg]) => `${at}: ${msg}`);
};

export function checkSiteUpdates(updates, making, hasBlog = blogExists) {
  const seen = new Set();
  const errors = updates.flatMap((u, i) => checkItem(u, i, updates, seen, hasBlog));
  if (making.length > MAKING_MAX)
    errors.push(`SITE_MAKING: ${MAKING_MAX}件まで（今 ${making.length}件）`);
  making.forEach((m, i) => {
    if (!m.id || !m.title) errors.push(`SITE_MAKING[${i}]: id と title が要る`);
    for (const w of bannedIn(m.title)) errors.push(`SITE_MAKING[${i}]: 禁止語「${w}」`);
  });
  return errors;
}

// 1. 本物のデータ
const errors = checkSiteUpdates(SITE_UPDATES, SITE_MAKING);
if (errors.length > 0) {
  console.error(`NG: 更新のお知らせのデータに ${errors.length} 件の誤り`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`OK データ（更新 ${SITE_UPDATES.length} 件・今つくっている物 ${SITE_MAKING.length} 件）`);

// 2. 壊したデータは落ちる
const base = { id: "2026-11-02-a", date: "2026-11-02", kind: "feature", title: "見出し", body: "本文", prs: [1] };
const broken = [
  ["日付の逆順", [{ ...base, date: "2026-11-01", id: "2026-11-01-a" }, base]],
  ["禁止語", [{ ...base, title: "似たレース" }]],
  ["id の重複", [base, base]],
  ["minor に本文", [{ ...base, kind: "minor" }]],
  ["見出しが長い", [{ ...base, title: "あ".repeat(41) }]],
  ["外のリンク", [{ ...base, path: "//example.com" }]],
  ["無い記事", [{ ...base, blogId: "no-such-post-xyz" }]],
];
for (const [label, updates] of broken) {
  assert.ok(checkSiteUpdates(updates, []).length > 0, `壊したデータ（${label}）が通った`);
  console.log(`OK 壊したデータは落ちる: ${label}`);
}
assert.ok(
  checkSiteUpdates([], [1, 2, 3, 4].map((n) => ({ id: `m${n}`, title: "x" }))).length > 0,
  "今つくっている物の4件目が通った",
);
console.log("OK 壊したデータは落ちる: 今つくっている物の4件目");

// 3. 計算（時計は固定。JST の日付の境目）
const at = (iso) => new Date(iso);
const jst2359 = at("2026-11-22T14:59:00Z"); // JST 11/22 23:59
const jst0000 = at("2026-11-22T15:00:00Z"); // JST 11/23 00:00
assert.equal(isWithinJstDays("2026-11-22", 1, jst2359), true, "今日は1日に入る");
assert.equal(isWithinJstDays("2026-11-22", 1, jst0000), false, "日付が変わると昨日");
assert.equal(isWithinJstDays("2026-11-16", 7, jst0000), false, "7日は今日を含め 11/17〜11/23");
assert.equal(isWithinJstDays("2026-11-17", 7, jst0000), true, "7日の端");
assert.equal(isWithinJstDays("2026-11-24", 7, jst0000), false, "未来の日付は出さない");
console.log("OK JST の暦日の境目");

const items = [
  { id: "2026-11-22-m", date: "2026-11-22", kind: "minor", title: "細" },
  { id: "2026-11-20-f", date: "2026-11-20", kind: "feature", title: "新" },
  { id: "2026-10-30-i", date: "2026-10-30", kind: "improvement", title: "改" },
];
assert.equal(pickBannerItem(items, jst0000)?.id, "2026-11-20-f", "帯は minor を飛ばした最新");
assert.equal(pickBannerItem(items, jst0000, "2026-11-20-f"), null, "閉じた件は出さない");
// 11/20 の件は JST 12/03（11/20 を含む14日目）まで出て、12/04 00:00 に消える
assert.equal(pickBannerItem(items, at("2026-12-03T15:00:00Z")), null, "14日を過ぎたら出さない");
assert.equal(pickBannerItem(items, at("2026-12-03T14:59:00Z"))?.id, "2026-11-20-f", "14日の端");
const future = { id: "2026-11-30-x", date: "2026-11-30", kind: "feature", title: "先" };
assert.equal(pickBannerItem([future, ...items], jst0000)?.id, "2026-11-20-f", "先の日付の件は飛ばす");
assert.equal(visibleUpdates([future, ...items], jst0000).length, items.length, "画面にも先の日付を出さない");
assert.equal(hasRecentUpdate(items, jst0000), true, "7日以内の新機能で NEW");
assert.equal(hasRecentUpdate(items.slice(0, 1), jst0000), false, "minor だけでは NEW を出さない");
console.log("OK 帯の1件と NEW");

const months = groupUpdatesByMonth(items);
assert.deepEqual(months.map((m) => [m.label, m.main.length, m.minor.length]), [
  ["2026年11月", 1, 1],
  ["2026年10月", 1, 0],
]);
console.log("OK 月の束ね");
