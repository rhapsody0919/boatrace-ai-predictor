/**
 * GA4 の日別の PV（scripts/lib/growth/ga4Daily.js）が、型ごとの正規表現と hostName・google の自然検索の絞りで要求を組み、今週・前週・4週前の7日の和を比べ、計測の切れ目をまたぐ比を出さず、着地 sessions ÷ GSC クリックの比を出し、朝の1枚（--local-dir）に PV の週の節を足すことを守る。
 * API・ファイルには触れない（メモリの行）。
 */
import { buildSheetLines } from "./seo-morning-sheet.js";
import { PAGE_TYPES, change, ga4Date, ga4DailyQueries, pageTypeOf, pvWeekLines, weekWindows } from "../lib/growth/ga4Daily.js";
import { sourceFromRows } from "../lib/growth/localSheetSource.js";

const failures = [];
let checked = 0;
const check = (name, ok, detail = "") => {
  checked += 1;
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
};

// 1. 要求: 全部に hostName、着地は google・organic、型は pagePath・landingPage の正規表現
const qs = ga4DailyQueries("www.boat-ai.jp");
const fields = (q) => q.dimensionFilter.andGroup.expressions.map((e) => `${e.filter.fieldName}=${e.filter.stringFilter.value}`);
check("型の数だけ PV と着地の要求", qs.length === 3 + PAGE_TYPES.length * 2, String(qs.length));
check("全部に hostName", qs.every((q) => fields(q).includes("hostName=www.boat-ai.jp")));
const landing = qs.find((q) => q.name === "landing:記事");
check("着地は google・organic・landingPage", JSON.stringify(fields(landing)) === JSON.stringify(["hostName=www.boat-ai.jp", "sessionSource=google", "sessionMedium=organic", "landingPage=^/blog(/|$)"]), JSON.stringify(fields(landing)));
check("PV は [date, channel] の screenPageViews", qs.find((q) => q.name === "pv_total").dimensions.join() === "date,sessionDefaultChannelGroup" && qs[0].metrics[0] === "screenPageViews");

// 2. 型の分類: race と races と racer を分ける。ja でない・その他は null
const S = "https://www.boat-ai.jp";
check("型の分類", [`${S}/`, `${S}/race/2026-11-24-01-01`, `${S}/races/2026-11-24`, `${S}/racers`, `${S}/racer/4444`, `${S}/blog/a/`, `${S}/en/blog/a`, `${S}/today`].map(pageTypeOf).join() === "トップ,レース詳細,日付のレース一覧,選手,選手,記事,,", [`${S}/`, `${S}/en/blog/a`].map(pageTypeOf).join());
check("GA4 の日付", ga4Date("20261124") === "2026-11-24");

// 3. 窓と比
const W = weekWindows("2026-11-24");
check("今週・前週・4週前", JSON.stringify(W) === JSON.stringify({ cur: { from: "2026-11-18", to: "2026-11-24" }, prev: { from: "2026-11-11", to: "2026-11-17" }, base: { from: "2026-10-21", to: "2026-10-27" } }), JSON.stringify(W));
check("増えた比", change(110, 100, W.prev, W.cur, "2026-09-26") === "+10%");
check("期間外", change(110, 100, W.base, W.cur, "2026-10-25") === "期間外");
const old = weekWindows("2026-10-05");
check("計測の切れ目（10/1）をまたぐ比は出さない", /比べない（計測の切れ目 .*2026-10-01）/.test(change(1, 1, old.prev, old.cur, "2026-08-01")), change(1, 1, old.prev, old.cur, "2026-08-01"));
check("前が0なら比べない", change(5, 0, W.prev, W.cur, "2026-09-26") === "0 なので比べない");

// 4. 週の行: 7日の和・自然検索のセッションだけの PV・比
const days = (from, n) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10).replaceAll("-", ""));
const pvRows = days("2026-10-21", 35).flatMap((d) => [
  { date: d, sessionDefaultChannelGroup: "Organic Search", screenPageViews: d >= "20261118" ? 20 : 10 },
  { date: d, sessionDefaultChannelGroup: "Direct", screenPageViews: 5 },
]).filter((r) => r.date !== "20261124");
const series = Object.fromEntries(ga4DailyQueries("h").map((q) => [q.name, []]));
series.pv_total = pvRows;
series.landing_total = days("2026-11-18", 7).map((d) => ({ date: d, sessions: 4 }));
const ga4 = { meta: { from: "2026-10-21", to: "2026-11-24", ga4_timezone: null }, series };
const gsc = days("2026-11-18", 7).map((d) => ({ date: ga4Date(d), page: `${S}/blog/a`, clicks: 2, impressions: 9 }));
const lines = pvWeekLines(ga4, gsc).join("\n");
check("全体 PV は今週の和と前週比", lines.includes("- 全体 PV: 150（前週 +43%・4週前 +43%）"), lines);
check("自然検索のセッションの PV", lines.includes("Organic Search。回遊を含む）: 120（前週 +71%"), lines);
check("欠けた日を数える", lines.includes("今週の欠けた日: 1"), lines);
check("時間帯が設定に無ければ未確認", lines.includes("GA4 の時間帯 未確認"), lines);
check("着地 ÷ GSC クリック", lines.includes("今週 2.00・前週 -"), lines);
check("型の比は型の GSC クリックと", lines.includes("  - 記事: 今週 0.00"), lines);
let threw = "";
try {
  pvWeekLines({ meta: ga4.meta, series: { pv_total: [] } });
} catch (e) {
  threw = e.message;
}
check("系列が欠けたら黙って0にしない", /が無い/.test(threw), threw);

// 5. 朝の1枚: ga4_daily があれば節を足す。無ければ足さない
const daily = [3, 4, 5].map((o) => ({ date: new Date(Date.parse("2026-11-25T00:00:00Z") - o * 86400000).toISOString().slice(0, 10), query: "語", page: `${S}/blog/a`, clicks: 1, impressions: 10, position: 8 }));
const args = { articles: null, changes: null, coreUpdates: null, tickets: 0 };
const src = () => sourceFromRows({ daily, pageDaily: gsc });
const withPv = (await buildSheetLines(src(), args, "2026-11-25", [], ga4)).join("\n");
check("1枚に PV の週の節", withPv.includes("[PV の週（GA4。") && withPv.includes("- 全体 PV: 150"), withPv);
const without = (await buildSheetLines(src(), args, "2026-11-25", [])).join("\n");
check("ga4_daily が無ければ節を出さない", !without.includes("[PV の週"), without);

if (failures.length > 0) {
  console.error(`verify-ga4-pv-weekly: ${failures.length}/${checked} 件が落ちた\n${failures.join("\n")}`);
  process.exit(1);
}
console.log(`verify-ga4-pv-weekly: ${checked} 件 OK`);
