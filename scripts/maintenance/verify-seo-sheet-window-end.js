/**
 * seo-morning-sheet の察知の窓が今日でなく growth_gsc_daily の最新の日で終わり、GSC の約3日の遅れで直近の窓が欠けて伸びた語を見落とさないことを守る。DB には繋がない。行はメモリで渡す。
 */
import { buildSheetLines, signalWindowEnd } from "./seo-morning-sheet.js";
import { sourceFromRows } from "../lib/growth/localSheetSource.js";

const failures = [];
let checked = 0;
const check = (name, ok, detail = "") => {
  checked += 1;
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
};

const today = "2026-11-27";
const dayStr = (offset) => new Date(Date.parse(`${today}T00:00:00Z`) - offset * 86400000).toISOString().slice(0, 10);
const row = (offset, query, impressions) => ({ date: dayStr(offset), query, page: "https://example.test/p", clicks: 1, impressions, position: 8 });

// 最新の日は今日の3日前。データの最新の日で切ると直近70→前10の4倍で伸びた語。今日で切ると直近160・前160で動き無しに見える
const daily = [];
for (let o = 3; o <= 9; o++) daily.push(row(o, "伸びる語", 40));
for (let o = 10; o <= 16; o++) daily.push(row(o, "伸びる語", 10));

const args = { articles: null, changes: null, coreUpdates: null, tickets: 0 };
const text = (await buildSheetLines(sourceFromRows({ daily }), args, today)).join("\n");
check("最新の日で切ると伸びた語が出る", /伸びる語（rising/.test(text), text);
check("窓の終わりを書く", text.includes(`察知の窓の終わり: ${dayStr(3)}`), text);

check("最新の日が今日より前ならその日", signalWindowEnd([{ table: "growth_gsc_daily", maxDate: dayStr(3) }], today) === dayStr(3));
check("最新の日が無ければ今日", signalWindowEnd([{ table: "growth_gsc_daily", maxDate: null }], today) === today);
check("表が無ければ今日", signalWindowEnd([], today) === today);
check("最新の日が今日以降なら今日", signalWindowEnd([{ table: "growth_gsc_daily", maxDate: "2026-11-30" }], today) === today);

if (failures.length) {
  console.error(`verify-seo-sheet-window-end: ${failures.length}/${checked} 件が失敗\n${failures.join("\n")}`);
  process.exit(1);
}
console.log(`verify-seo-sheet-window-end: ${checked} 件 OK`);
