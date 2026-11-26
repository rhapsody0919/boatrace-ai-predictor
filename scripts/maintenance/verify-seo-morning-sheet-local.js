/**
 * seo-morning-sheet の --local-dir（手元の JSON。Supabase の鍵なし）が、gsc_daily.json・gsc_page_daily.json から
 * 見張り（最新の date の遅れ）・察知・効きを Supabase の版と同じ規則で出し、無いファイルや誤りを黙って空にしないことを守る。DB には繋がない。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSheetLines } from "./seo-morning-sheet.js";
import { localSource } from "../lib/growth/localSheetSource.js";

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seo-sheet-local-"));
const write = (name, data) => {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, JSON.stringify(data));
  return file;
};
const args = { articles: null, changes: null, coreUpdates: null, tickets: 0 };
const text = async (dir, series, a = args) => (await buildSheetLines(localSource(dir, series), a, today)).join("\n");

try {
  // 1. {meta, rows} の形（google-detail-collect の出力）で読める。緑・語が出る・本物の数字は出さない
  const dirA = path.join(tmp, "a");
  fs.mkdirSync(dirA);
  fs.writeFileSync(path.join(dirA, "gsc_daily.json"), JSON.stringify({ meta: {}, rows: rising }));
  fs.writeFileSync(path.join(dirA, "gsc_page_daily.json"), JSON.stringify({ meta: {}, rows: pageRows }));
  const a = await text(dirA, null);
  check("growth_gsc_daily が ok", /growth_gsc_daily: ok（直近の日 2026-11-22）/.test(a), a);
  check("growth_gsc_page_daily が ok", /growth_gsc_page_daily: ok（直近の日 2026-11-21）/.test(a), a);
  check("growth_url_inspection は表が無い扱いで緑を妨げない", /growth_url_inspection: missing（必須でない/.test(a) && !/見張りが緑でない/.test(a), a);
  check("伸びた語が出る", /伸びる語（rising/.test(a), a);
  check("落ちた語は数だけ", /落ちた語: /.test(a) && !/落ちる語（/.test(a), a);

  // 2. 行の配列だけの形も読める
  const dirB = path.join(tmp, "b");
  fs.mkdirSync(dirB);
  fs.writeFileSync(path.join(dirB, "gsc_daily.json"), JSON.stringify(rising));
  const b = await text(dirB, null);
  check("配列の形でも読める・page_daily が無ければ missing（必須でない）", /伸びる語（rising/.test(b) && /growth_gsc_page_daily: missing/.test(b), b);

  // 3. 見張り: 最新の date が古い（4日超）と赤で、察知を出さない
  const dirC = path.join(tmp, "c");
  fs.mkdirSync(dirC);
  fs.writeFileSync(path.join(dirC, "gsc_daily.json"), JSON.stringify(rising.map((r) => ({ ...r, date: new Date(Date.parse(r.date) - 3 * 86400000).toISOString().slice(0, 10) }))));
  const c = await text(dirC, null);
  check("古いと stale・察知を出さない", /growth_gsc_daily: stale/.test(c) && /見張りが緑でない/.test(c) && !/伸びる語/.test(c), c);

  // 4. 空の行は empty で赤
  const dirD = path.join(tmp, "d");
  fs.mkdirSync(dirD);
  fs.writeFileSync(path.join(dirD, "gsc_daily.json"), "[]");
  const d = await text(dirD, null);
  check("0行は empty で赤", /growth_gsc_daily: empty/.test(d) && /見張りが緑でない/.test(d), d);

  // 5. 無いファイル・誤りは黙って空にしない
  const fail = async (fn) => {
    try {
      await fn();
      return "";
    } catch (e) {
      return e.message;
    }
  };
  check("gsc_daily.json が無ければ失敗", /gsc_daily\.json が無い/.test(await fail(() => localSource(path.join(tmp, "none")))));
  check("--series のファイルが無ければ失敗", /が無い/.test(await fail(() => localSource(dirA, path.join(tmp, "no-series.json")))));
  const dirE = path.join(tmp, "e");
  fs.mkdirSync(dirE);
  fs.writeFileSync(path.join(dirE, "gsc_daily.json"), JSON.stringify({ rows: "x" }));
  check("行が配列でなければ失敗", /行の配列/.test(await fail(() => localSource(dirE))));

  // 6. --series: 窓と重なる開催だけ使う
  const seriesFile = write("series.json", [
    { venue_code: "01", start_date: dayStr(20), end_date: dayStr(18), title: "古い", grade: "G1" },
    { venue_code: "02", start_date: dayStr(5), end_date: dayStr(1), title: "今", grade: "SG" },
  ]);
  const src = localSource(dirA, seriesFile);
  check("series は窓と重なる物だけ", JSON.stringify((await src.series(dayStr(13), today)).map((s) => s.title)) === JSON.stringify(["今"]));
  check("series が無ければ空", (await localSource(dirA, null).series(dayStr(13), today)).length === 0);
  check("inspections は空", (await src.inspections()).length === 0);
  check("daily は期間で切る", (await src.daily(dayStr(5), dayStr(3))).every((r) => r.date >= dayStr(5) && r.date <= dayStr(3)));

  // 7. 効き: 記事は page_daily の合計を物差しにする（出力が出る）
  const articles = write("articles.json", [{ id: "a", url: "https://example.test/blog/a", publishDate: dayStr(10) }]);
  const withArticle = await text(dirA, null, { ...args, articles });
  check("記事の行が出る", /効き: 新記事の段/.test(withArticle), withArticle);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`verify-seo-morning-sheet-local: ${failures.length}/${checked} 件が失敗\n${failures.join("\n")}`);
  process.exit(1);
}
console.log(`verify-seo-morning-sheet-local: ${checked} 件 OK`);
