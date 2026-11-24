/**
 * verify-growth-morning-sheet.js - SEO の朝の1枚の組み立て（scripts/lib/growth/morningSheet.js、SEO データの輪 PR6）を確かめる。
 * ネットワーク・DB には触れない。
 *
 * 守る物:
 *   - 見張りは growth 表の最新の日と行数で、0行・古い・表が無い（必須の物）は赤。赤のときは察知と効きを出さない
 *   - 1枚と票の雛形に、正確な件数・クリック・順位を出さない（桁と順位の帯だけ）
 *   - 旬の語・指名・開催起因は別の節に分ける。票の雛形は語・帯・桁・着地・重なる記事・推奨の手・測る日を持つ
 *   - 新記事の段・未測定・改稿の判定待ち（T+28 まで）を1行ずつ出す
 */
import assert from "node:assert/strict";
import {
  articleLines,
  buildSignals,
  freshnessReport,
  isGreen,
  positionBand,
  renderSheet,
  rewriteLine,
  ticketTemplate,
} from "../lib/growth/morningSheet.js";

// 見張り
const today = "2026-11-25";
const ok = { table: "growth_gsc_daily", required: true, maxDate: "2026-11-23", rowCount: 900 };
assert.equal(freshnessReport([ok], today)[0].status, "ok");
assert.equal(freshnessReport([{ ...ok, maxDate: "2026-11-20" }], today)[0].status, "stale");
assert.equal(freshnessReport([{ ...ok, rowCount: 0, maxDate: null }], today)[0].status, "empty");
assert.equal(isGreen(freshnessReport([ok, { table: "growth_gsc_page_daily", required: false, missing: true }], today)), true, "必須でない未適用の表は赤にしない");
assert.equal(isGreen(freshnessReport([{ table: "growth_gsc_daily", required: true, missing: true }], today)), false);
assert.equal(isGreen(freshnessReport([ok, { ...ok, table: "x", maxDate: "2026-11-01" }], today)), false);

// 順位の帯
assert.deepEqual([2, 8, 15, 40, null].map(positionBand), ["1〜3位", "4〜10位", "11〜20位", "21位以下", "不明"]);

// 察知の信号
const r = (date, query, impressions, position, page = "https://www.boat-ai.jp/a", clicks = 0) => ({ date, query, page, clicks, impressions, position });
const rows = [
  r("2026-11-22", "艇国データバンク 閉鎖", 400, 6),
  r("2026-11-22", "予想 コツ", 150, 14),
  r("2026-11-22", "龍神レーダー", 90, 2, "https://www.boat-ai.jp/", 30),
  r("2026-11-22", "桐生 sg 予想", 70, 9),
  r("2026-11-22", "遠すぎる語", 80, 45),
  r("2026-11-22", "割れる語", 80, 5, "https://www.boat-ai.jp/a"), r("2026-11-22", "割れる語", 40, 6, "https://www.boat-ai.jp/b"),
];
const series = [{ venue_code: "01", start_date: "2026-11-20", end_date: "2026-11-25", title: "ボートレースクラシック", grade: "SG" }];
const signals = buildSignals(rows, today, { series });
const by = Object.fromEntries(signals.map((s) => [s.query, s]));
assert.equal(by["艇国データバンク 閉鎖"].seasonal, true);
assert.equal(by["予想 コツ"].action, "rewrite_or_internal_link");
assert.equal(by["龍神レーダー"].intent, "brand");
assert.equal(by["桐生 sg 予想"].event, true);
assert.equal(by["遠すぎる語"].action, "new_article", "30位より下は答えるページが無いものとして新記事");
assert.equal(by["割れる語"].action, "consolidate_canonical", "カニバリ");
assert.deepEqual(by["割れる語"].overlapPages, ["boat-ai.jp/a", "boat-ai.jp/b"]);
const withInsp = buildSignals(rows, today, { series, inspections: { "boat-ai.jp/a": false } });
assert.equal(withInsp.find((s) => s.query === "予想 コツ").action, "consolidate_canonical", "canonical が別なら統合");

// 1枚: 緑なら節に分ける。数字を出さない
const green = freshnessReport([ok], today);
const sheet = renderSheet({ today, freshness: green, signals, articleLinesOut: ["a: 段=indexed"], fallingCount: 37 });
assert.match(sheet, /\[旬の語: 当日中に票まで\]\n- 艇国データバンク 閉鎖/);
assert.match(sheet, /\[察知: 指名の語\]/);
assert.match(sheet, /\[察知: 開催起因の語（一般と混ぜない）\]\n- 桐生 sg 予想/);
assert.match(sheet, /落ちた語: 10台件/);
for (const exact of ["400", "150", "14.", "37"]) assert.ok(!sheet.includes(exact), `正確な数字を出さない: ${exact}`);
assert.match(sheet, /表示100台|表示10台/);
// 赤なら察知と効きを出さない
const red = renderSheet({ today, freshness: freshnessReport([{ ...ok, maxDate: "2026-11-01" }], today), signals });
assert.match(red, /見張りが緑でないので/);
assert.ok(!red.includes("[察知"));

// 票の雛形
const t = ticketTemplate(by["予想 コツ"], today);
assert.match(t, /^タイトル: SEO: 予想 コツ → 改稿か内部リンク/);
assert.match(t, /順位の帯: 11〜20位／表示の桁: 100台/);
assert.match(t, /測る日: 2026-12-23（T\+28/);
assert.match(t, /着地ページ: boat-ai\.jp\/a/);
assert.ok(!/\b150\b|14\.\d/.test(t), "票に正確な数字を書かない");
assert.match(ticketTemplate(by["艇国データバンク 閉鎖"], today), /旬の語: 当日中/);

// 新記事の段・未測定
const lines = articleLines(
  [
    { id: "new1", url: "https://www.boat-ai.jp/blog/n1", publishDate: "2026-11-22" },
    { id: "old1", url: "https://www.boat-ai.jp/blog/o1", publishDate: "2026-10-01", measuredAt: null },
  ],
  today,
  { totals: { "boat-ai.jp/blog/n1": { impressions: 10, clicks: 0 } }, inspectionRows: { "https://www.boat-ai.jp/blog/n1": { verdict: "PASS" } } },
);
assert.match(lines[0], /new1: 段=impressions（clicksで止まっている）・来ている確認=D\+1・D\+3/);
assert.match(lines[1], /old1: 段=index_unknown/);
assert.match(lines.at(-1), /未測定.*old1/);

// 改稿: T+28 まで判定待ち
assert.equal(rewriteLine({ id: "e1", page: "boat-ai.jp/a", editDate: "2026-11-20", mergedAt: "2026-11-20T01:00:00Z" }, [], today), "e1: 判定待ち（T+28 は 2026-12-18）");
assert.match(rewriteLine({ id: "e2", page: "boat-ai.jp/a", editDate: "2026-10-01", mergedAt: "2026-10-01T01:00:00Z" }, [], today), /e2: 分けられない（baseline_too_short）/);

console.log("verify-growth-morning-sheet: OK（見張り・信号の分け・票の雛形・数字を出さない・新記事の段・改稿の判定待ち）");
