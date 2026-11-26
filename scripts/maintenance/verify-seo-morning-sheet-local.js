/**
 * seo-morning-sheet の --local-dir（手元の JSON。Supabase の鍵なし）が、gsc_daily.json・gsc_page_daily.json から
 * 見張り（最新の date の遅れ）・察知・効きを Supabase の版と同じ規則で出し、無いファイルや誤りを黙って空にしないことを守る。DB には繋がない。ファイルは書かず、行はメモリで渡す。
 */
import { buildSheetLines } from "./seo-morning-sheet.js";
import { parseRows, readRowsFile, sourceFromRows } from "../lib/growth/localSheetSource.js";

const failures = [];
let checked = 0;
const check = (name, ok, detail = "") => {
  checked += 1;
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
};

const today = "2026-11-25";
const dayStr = (offset) => new Date(Date.parse(`${today}T00:00:00Z`) - offset * 86400000).toISOString().slice(0, 10);
const row = (offset, query, impressions) => ({ date: dayStr(offset), query, page: "https://example.test/p", clicks: 1, impressions, position: 8 });

// 伸びた語（前の窓70 → 直近の窓160）と落ちた語（140 → 16）。窓は today を含む7日と、その前の7日。最新の日は today の3日前（GSC の遅れ）
const rising = [];
for (let o = 3; o <= 6; o++) rising.push(row(o, "伸びる語", 40), row(o, "落ちる語", 4));
for (let o = 7; o <= 13; o++) rising.push(row(o, "伸びる語", 10), row(o, "落ちる語", 20));
const pageRows = [
  { date: dayStr(4), page: "https://example.test/blog/a", clicks: 3, impressions: 120 },
  { date: dayStr(5), page: "https://example.test/blog/a", clicks: 2, impressions: 80 },
];

const args = { articles: null, changes: null, coreUpdates: null, tickets: 0 };
const text = async (parts, a = args) => (await buildSheetLines(sourceFromRows(parts), a, today)).join("\n");
const fail = async (fn) => {
  try {
    await fn();
    return "";
  } catch (e) {
    return e.message;
  }
};

// 1. 緑・語が出る・落ちた語は数だけ
const a = await text({ daily: rising, pageDaily: pageRows });
check("growth_gsc_daily が ok", /growth_gsc_daily: ok（直近の日 2026-11-22）/.test(a), a);
check("growth_gsc_page_daily が ok", /growth_gsc_page_daily: ok（直近の日 2026-11-21）/.test(a), a);
check("growth_url_inspection は表が無い扱いで緑を妨げない", /growth_url_inspection: missing（必須でない/.test(a) && !/見張りが緑でない/.test(a), a);
check("伸びた語が出る", /伸びる語（rising/.test(a), a);
check("落ちた語は数だけ", /落ちた語: /.test(a) && !/落ちる語（/.test(a), a);

// 2. page_daily が無ければ missing（必須でない）
const b = await text({ daily: rising });
check("page_daily が無くても出る", /伸びる語（rising/.test(b) && /growth_gsc_page_daily: missing/.test(b), b);

// 3. 見張り: 最新の date が古い（4日超）と赤で、察知を出さない
const shift = (r) => ({ ...r, date: new Date(Date.parse(r.date) - 3 * 86400000).toISOString().slice(0, 10) });
const c = await text({ daily: rising.map(shift) });
check("古いと stale・察知を出さない", /growth_gsc_daily: stale/.test(c) && /見張りが緑でない/.test(c) && !/伸びる語/.test(c), c);

// 4. 空の行は empty で赤
const d = await text({ daily: [] });
check("0行は empty で赤", /growth_gsc_daily: empty/.test(d) && /見張りが緑でない/.test(d), d);

// 5. 形の誤りは黙って空にしない（ファイルの有無は readRowsFile が null で返し、localSource が投げる）
check("行が配列でなければ失敗", /行の配列/.test(await fail(() => parseRows({ rows: "x" }, "x.json"))));
check("{meta, rows} も配列も読める", parseRows({ meta: {}, rows: [1] }, "x").length === 1 && parseRows([1, 2], "x").length === 2);
check("無いファイルは null", readRowsFile("/nonexistent/seo-sheet-local/gsc_daily.json") === null);

// 6. series: 窓と重なる開催だけ使う
const src = sourceFromRows({
  daily: rising,
  series: [
    { venue_code: "01", start_date: dayStr(20), end_date: dayStr(18), title: "古い", grade: "G1" },
    { venue_code: "02", start_date: dayStr(5), end_date: dayStr(1), title: "今", grade: "SG" },
  ],
});
check("series は窓と重なる物だけ", JSON.stringify((await src.series(dayStr(13), today)).map((s) => s.title)) === JSON.stringify(["今"]));
check("series が無ければ空", (await sourceFromRows({ daily: rising }).series(dayStr(13), today)).length === 0);
check("inspections は空", (await src.inspections()).length === 0);
check("daily は期間で切る", (await src.daily(dayStr(5), dayStr(3))).every((r) => r.date >= dayStr(5) && r.date <= dayStr(3)));

// 7. 効き: 記事（メモリで渡す）は page_daily の合計を物差しにする
const withArticle = (await buildSheetLines(sourceFromRows({ daily: rising, pageDaily: pageRows }), args, today, [{ id: "a", url: "https://example.test/blog/a", publishDate: dayStr(10) }])).join("\n");
check("記事の行が出る", /効き: 新記事の段/.test(withArticle), withArticle);
check("記事が無ければ効きの欄は出ない", !/効き: 新記事の段/.test(a));

if (failures.length) {
  console.error(`verify-seo-morning-sheet-local: ${failures.length}/${checked} 件が失敗\n${failures.join("\n")}`);
  process.exit(1);
}
console.log(`verify-seo-morning-sheet-local: ${checked} 件 OK`);
