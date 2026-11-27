/**
 * 手元の URL 検査（scripts/lib/growth/localInspection.js）が、前の日の写しから済みを飛ばし、URL ごとの最新の1行を残し、Google が別の正規ページを選んだ URL を並べ、朝の1枚（--local-dir）が索引の段とその一覧を出すことを守る。
 * API・DB・ファイルには触れない（偽の client とメモリの行）。
 */
import { buildSheetLines, canonicalLines } from "./seo-morning-sheet.js";
import { canonicalMismatches, collectInspections, mergeSnapshot, planLocalInspections, previousDates } from "../lib/growth/localInspection.js";
import { sourceFromRows } from "../lib/growth/localSheetSource.js";

const failures = [];
let checked = 0;
const check = (name, ok, detail = "") => {
  checked += 1;
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
};
const S = "https://www.boat-ai.jp";
const today = "2026-11-25";
const xml = [
  "/",
  "/blog/a",
  "/blog/b",
  "/en/blog/a",
  "/race/2026-11-24-01-01",
  "/race/2026-11-24-01-02",
].map((p) => `<url><loc>${S}${p}</loc></url>`).join("");
const row = (path, inspectedOn, checkpoint, extra = {}) => ({ url: `${S}${path}`, inspected_on: inspectedOn, checkpoint, verdict: "PASS", google_canonical: `${S}${path}`, user_canonical: `${S}${path}`, coverage_state: "Submitted and indexed", ...extra });

// 1. 初回（前の写しが無い）: ja の記事と主要ページだけ。レース詳細（Actions の版が見る）と en は除く
const first = planLocalInspections({ xml, prevRows: [], today, max: 10 }).map((t) => `${t.url.replace(S, "")} ${t.checkpoint}`);
check("初回は ja の記事と主要ページ", JSON.stringify(first) === JSON.stringify(["/ weekly", "/blog/a weekly", "/blog/b weekly"]), JSON.stringify(first));
check("上限で切る", planLocalInspections({ xml, prevRows: [], today, max: 2 }).length === 2);

// 2. 前の写しで済みを飛ばす: 6日前に見たページは今日は見ない。7日前のページは見る
const prev = [row("/blog/a", "2026-11-19", "weekly"), row("/blog/b", "2026-11-18", "weekly")];
const second = planLocalInspections({ xml, prevRows: prev, today, max: 10 }).map((t) => t.url.replace(S, ""));
check("済みを飛ばす", JSON.stringify(second) === JSON.stringify(["/", "/blog/b"]), JSON.stringify(second));

// 3. 写し: URL ごとに最新の1行、35日より古い行は落とす
const merged = mergeSnapshot([row("/blog/a", "2026-11-18", "weekly", { verdict: "NEUTRAL" }), row("/blog/old", "2026-10-01", "weekly")], [row("/blog/a", "2026-11-25", "weekly")], today);
check("最新の1行を残す", merged.length === 1 && merged[0].verdict === "PASS" && merged[0].inspected_on === today, JSON.stringify(merged));
check("前の写しを探す日は前の日から", previousDates(today, 2).join(",") === "2026-11-24,2026-11-23");

// 4. 正規ページの食い違い: www・末尾の / は同じ。googleCanonical が無ければ未確認で出さない。指定が無ければ URL 自身と比べる
const mism = canonicalMismatches([
  row("/racer/1", today, "weekly", { google_canonical: `${S}/racer/2`, coverage_state: "Duplicate, Google chose different canonical than user" }),
  row("/blog/a", today, "weekly", { google_canonical: "https://boat-ai.jp/blog/a/" }),
  row("/blog/b", today, "weekly", { google_canonical: null }),
  row("/venue/1", today, "weekly", { user_canonical: null, google_canonical: `${S}/venue` }),
]);
check("別を選んだ URL だけ", JSON.stringify(mism.map((m) => m.url.replace(S, ""))) === JSON.stringify(["/racer/1", "/venue/1"]), JSON.stringify(mism));
const lines = canonicalLines([row("/racer/1", today, "weekly", { google_canonical: `${S}/racer/2` })]);
check("節は URL と Google の選んだページを出す", lines.length === 2 && lines[1].includes(`${S}/racer/1 → Google: ${S}/racer/2`), lines.join("\n"));
const pile = canonicalLines([row("/racer/1", today, "weekly", { google_canonical: `${S}/racer/9` }), row("/racer/2", today, "weekly", { google_canonical: `${S}/racer/9/` })]);
check("同じページに集まったら集まりの行を出す", pile.some((l) => l.includes("集まり:") && l.includes("に 2 URL")), pile.join("\n"));
check("検査の行が無ければ節を出さない", canonicalLines([]).length === 0);

// 5. 収集: 1件の失敗は数えて続け、全部落ちたら投げる（権限の誤りを「検査なし」にしない）
const fakeSc = (fail) => ({
  urlInspection: { index: { inspect: async ({ requestBody }) => {
    if (fail(requestBody.inspectionUrl)) throw Object.assign(new Error("x"), { code: 403 });
    return { data: { inspectionResult: { indexStatusResult: { verdict: "PASS", googleCanonical: requestBody.inspectionUrl } } } };
  } } },
});
const now = new Date("2026-11-25T15:00:00Z");
const got = await collectInspections(fakeSc((u) => u.endsWith("/blog/b")), { siteUrl: `${S}/`, xml, prevRows: [], max: 10 }, today, now);
check("1件落ちても他を書く", got.meta.planned === 3 && got.meta.inspected === 2 && got.meta.failed === 1 && got.rows.length === 2, JSON.stringify(got.meta));
let threw = "";
try {
  await collectInspections(fakeSc(() => true), { siteUrl: `${S}/`, xml, prevRows: [], max: 10 }, today, now);
} catch (e) {
  threw = e.message;
}
check("全部落ちたら投げる", /全部落ちた/.test(threw), threw);

// 6. 朝の1枚: url_inspection の行があれば見張りが ok、新しい記事の段が索引済み、食い違いの節が出る。無ければ「表が無い」注記で緑のまま
const dayStr = (o) => new Date(Date.parse(`${today}T00:00:00Z`) - o * 86400000).toISOString().slice(0, 10);
const daily = [3, 4, 5, 8, 9].map((o) => ({ date: dayStr(o), query: "語", page: `${S}/blog/a`, clicks: 1, impressions: 10, position: 8 }));
const pageDaily = [{ date: dayStr(3), page: `${S}/blog/a`, clicks: 0, impressions: 5 }];
const args = { articles: null, changes: null, coreUpdates: null, tickets: 0 };
const articles = [{ id: "pr-1", url: `${S}/blog/a`, publishDate: dayStr(4) }];
const insp = [row("/blog/a", dayStr(1), "weekly"), row("/racer/1", dayStr(1), "weekly", { google_canonical: `${S}/racer/2` })];
const sheet = (await buildSheetLines(sourceFromRows({ daily, pageDaily, inspections: insp }), args, today, articles)).join("\n");
check("見張りが ok", /growth_url_inspection: ok/.test(sheet), sheet);
check("新しい記事は索引の段を越える（index_unknown で止まらない）", /pr-1: 段=impressions/.test(sheet), sheet);
check("食い違いの節が出る", sheet.includes(`${S}/racer/1 → Google: ${S}/racer/2`), sheet);
const none = (await buildSheetLines(sourceFromRows({ daily, pageDaily, inspections: null }), args, today, articles)).join("\n");
check("検査が無ければ missing で緑のまま", /growth_url_inspection: missing（必須でない/.test(none) && !/見張りが緑でない/.test(none) && !/\[正規ページ/.test(none), none);

if (failures.length > 0) {
  console.error(`verify-local-url-inspection: ${failures.length}/${checked} 件が落ちた\n${failures.join("\n")}`);
  process.exit(1);
}
console.log(`verify-local-url-inspection: ${checked} 件 OK`);
