/**
 * verify-growth-url-inspection.js - URL Inspection の部品（scripts/lib/growth/urlInspection.js、SEO データの輪 PR5）を確かめる。
 * ネットワーク・DB には触れない（偽の client を使う）。
 *
 * 守る物:
 *   - 確かめる日は D+1・D+3・D+7。遅れて来たときは最後の1つだけ（古い確認を後追いしない）。済みは飛ばす
 *   - canonical は www・無印・末尾の / を同じとみなし、応答に無ければ null（未確認を誤りにしない）
 *   - 行の列の集合が全行で同じ。verdict PASS だけが索引済み
 *   - 表が無い間は何を適用するかを書いて止まる。他の失敗は別の文で、行の中身を出さない
 */
import assert from "node:assert/strict";
import {
  CHECKPOINT_DAYS,
  assertInspectionTableExists,
  canonicalOk,
  indexStatusOf,
  inspectUrl,
  latestDueCheckpoint,
  pendingInspections,
  toInspectionRow,
  writeInspections,
} from "../lib/growth/urlInspection.js";

assert.deepEqual([...CHECKPOINT_DAYS], [1, 3, 7]);
assert.equal(latestDueCheckpoint("2026-11-20", "2026-11-20"), null);
assert.equal(latestDueCheckpoint("2026-11-20", "2026-11-21"), "D+1");
assert.equal(latestDueCheckpoint("2026-11-20", "2026-11-25"), "D+3", "5日目は D+3");
assert.equal(latestDueCheckpoint("2026-11-20", "2026-12-30"), "D+7", "遅れても D+7 まで");

const articles = [
  { url: "https://www.boat-ai.jp/blog/a", publishDate: "2026-11-20" },
  { url: "https://www.boat-ai.jp/blog/b", publishDate: "2026-11-24" },
  { url: "https://www.boat-ai.jp/blog/c", publishDate: "2026-11-25" },
];
assert.deepEqual(pendingInspections(articles, [], "2026-11-25"), [
  { url: articles[0].url, checkpoint: "D+3" },
  { url: articles[1].url, checkpoint: "D+1" },
]);
assert.deepEqual(
  pendingInspections(articles, [{ url: articles[0].url, checkpoint: "D+3" }], "2026-11-25"),
  [{ url: articles[1].url, checkpoint: "D+1" }],
  "済みの確認は飛ばす",
);

assert.equal(canonicalOk("https://www.boat-ai.jp/blog/a", "https://boat-ai.jp/blog/a/"), true);
assert.equal(canonicalOk("https://www.boat-ai.jp/blog/a", "https://www.boat-ai.jp/blog/other"), false);
assert.equal(canonicalOk("https://www.boat-ai.jp/blog/a", undefined), null, "応答に無ければ未確認");

const full = toInspectionRow({
  url: articles[0].url, checkpoint: "D+3", inspectedOn: "2026-11-25", fetchedAt: "t",
  result: { indexStatusResult: { verdict: "PASS", coverageState: "Submitted and indexed", googleCanonical: "https://www.boat-ai.jp/blog/a", lastCrawlTime: "2026-11-24T01:00:00Z" } },
});
const empty = toInspectionRow({ url: articles[1].url, checkpoint: "D+1", inspectedOn: "2026-11-25", fetchedAt: "t", result: undefined });
assert.deepEqual(Object.keys(full).sort(), Object.keys(empty).sort(), "列の集合が全行で同じ");
assert.equal(full.canonical_ok, true);
assert.equal(empty.verdict, null);
assert.equal(indexStatusOf(full), "indexed");
assert.equal(indexStatusOf({ verdict: "NEUTRAL" }), "not_indexed");
assert.equal(indexStatusOf({ verdict: "FAIL" }), "not_indexed");
assert.equal(indexStatusOf(empty), "unknown");
assert.equal(indexStatusOf({ verdict: "VERDICT_UNSPECIFIED" }), "unknown");

// 取得の口: 検査の URL・サイト・言語を渡す
let sent;
const sc = { urlInspection: { index: { inspect: async (r) => ((sent = r.requestBody), { data: { inspectionResult: { x: 1 } } }) } } };
assert.deepEqual(await inspectUrl(sc, "sc-domain:boat-ai.jp", articles[0].url), { x: 1 });
assert.deepEqual(sent, { inspectionUrl: articles[0].url, siteUrl: "sc-domain:boat-ai.jp", languageCode: "ja" });

// 表が無い・他の失敗
const missing = { code: "PGRST205", message: "Could not find the table" };
const dbWith = (error, calls = []) => ({
  from: () => ({
    select: () => ({ limit: async () => ({ error }) }),
    upsert: async (rows, o) => (calls.push([rows.length, o.onConflict]), { error }),
  }),
});
await assert.rejects(assertInspectionTableExists(dbWith(missing)), /db-draft-url-inspection\.md.*db-apply/s);
await assert.rejects(writeInspections(dbWith(missing), [full]), /growth_url_inspection が無い/);
await assert.rejects(writeInspections(dbWith({ code: "42501", message: "denied (Failing row contains (x))" }), [full]), (e) => {
  assert.ok(e.message.includes("code=42501") && !e.message.includes("Failing row"), e.message);
  return true;
});
const calls = [];
await writeInspections(dbWith(null, calls), [full, empty]);
assert.deepEqual(calls, [[2, "url,inspected_on"]]);
await writeInspections(dbWith(null, calls), []);
assert.equal(calls.length, 1, "0行なら書かない");
await assertInspectionTableExists(dbWith(null));

console.log("verify-growth-url-inspection: OK（D+1/D+3/D+7・済みを飛ばす・canonical・列の集合・表が無いときの文）");
