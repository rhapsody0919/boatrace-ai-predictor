/**
 * verify-growth-seo-detect.js - 察知の純関数（scripts/lib/growth/seoDetect.js、SEO データの輪 PR3）を確かめる。
 * ネットワーク・DB には触れない。
 *
 * 守る物:
 *   - 順位は表示で重みを付けた平均（単純平均にしない）。page は www・無印・末尾の / で別の行にならない
 *   - 指名と一般を分け、ボートアイ・boat ai は競合名と同じなので印を付ける（定義は seoKeywordKpi.js の表）
 *   - 開催起因の語は、開催中の節の会場名＋開催を指す語のときだけ。一般の語の「伸び」に混ぜず印を付ける
 *   - 伸びた・新しい・落ちた語は7日の和で比べる。カニバリは正規化した page の上位2ページ
 *   - 判定木は書いた順に1つの手を返す。AIO の語は CTR 改稿から外す。旬の語を見分ける
 */
import assert from "node:assert/strict";
import {
  THRESHOLDS,
  approxMagnitude,
  classifyIntent,
  ctrMedianByPosition,
  decideAction,
  detectCannibal,
  detectMovers,
  isEventDriven,
  isSeasonalTerm,
  normalizePage,
  weightedPosition,
  windows,
} from "../lib/growth/seoDetect.js";

// page の正規化
const p = "boat-ai.jp/venue/2";
assert.equal(normalizePage("https://www.boat-ai.jp/venue/2"), p);
assert.equal(normalizePage("https://boat-ai.jp/venue/2/"), p);
assert.equal(normalizePage("https://www.boat-ai.jp/venue/2?utm=x#a"), p);
assert.equal(normalizePage("https://www.boat-ai.jp/"), "boat-ai.jp/");

// 表示で重みを付けた順位
const wp = weightedPosition([
  { position: 2, impressions: 900 },
  { position: 20, impressions: 100 },
]);
assert.ok(Math.abs(wp - 3.8) < 1e-9, `単純平均(11)でなく 3.8: ${wp}`);
assert.equal(weightedPosition([{ position: 5, impressions: 0 }]), null);

// 指名と一般
assert.deepEqual(classifyIntent("龍神レーダー"), { intent: "brand", competitorOverlap: false });
assert.deepEqual(classifyIntent("ボートアイ"), { intent: "brand", competitorOverlap: true });
assert.deepEqual(classifyIntent("boat ai 予想"), { intent: "brand", competitorOverlap: true });
assert.equal(classifyIntent("戸田 ai 予想").intent, "general");
assert.equal(classifyIntent("競艇 予想 無料").intent, "general");

// 開催の暦（race_series の行）
const series = [
  { venue_code: "01", start_date: "2026-11-20", end_date: "2026-11-25", title: "ボートレースクラシック", grade: "SG" },
];
assert.equal(isEventDriven("桐生 sg 予想", "2026-11-22", series), true);
assert.equal(isEventDriven("桐生 ボートレースクラシック", "2026-11-22", series), true);
assert.equal(isEventDriven("桐生 ai 予想", "2026-11-22", series), false, "開催を指す語が無い");
assert.equal(isEventDriven("戸田 sg", "2026-11-22", series), false, "開催中の会場ではない");
assert.equal(isEventDriven("桐生 sg", "2026-11-26", series), false, "開催の外の日");

// 旬の語
assert.equal(isSeasonalTerm("艇国データバンク 閉鎖"), true);
assert.equal(isSeasonalTerm("艇国データバンク 代わり"), true);
assert.equal(isSeasonalTerm("ボートレース ai 予想"), false);

// 窓
assert.deepEqual(windows("2026-11-21"), {
  recent: { from: "2026-11-15", to: "2026-11-21" },
  prev: { from: "2026-11-08", to: "2026-11-14" },
});

// 伸びた・新しい・落ちた
const day = (date, query, impressions, page = "https://www.boat-ai.jp/a", position = 8) => ({
  date, query, page, clicks: 0, impressions, position,
});
const rows = [
  day("2026-11-16", "新語", 40), // 新しい（前の窓に無い）
  day("2026-11-10", "伸語", 20), day("2026-11-17", "伸語", 60), // 3倍
  day("2026-11-10", "落語", 100), day("2026-11-17", "落語", 10), // 1/10
  day("2026-11-10", "横語", 100), day("2026-11-17", "横語", 110), // 動かず
  day("2026-11-17", "少語", 5), // 表示が少ない
  day("2026-11-17", "桐生 sg 予想", 50), // 開催起因
];
const movers = Object.fromEntries(detectMovers(rows, "2026-11-21", { series }).map((m) => [m.query, m]));
assert.equal(movers["新語"].kind, "new");
assert.equal(movers["伸語"].kind, "rising");
assert.equal(movers["落語"].kind, "falling");
assert.ok(!("横語" in movers) && !("少語" in movers));
assert.equal(movers["桐生 sg 予想"].event, true);
assert.equal(movers["新語"].event, false);
assert.equal(movers["新語"].intent, "general");

// カニバリ: www と無印は同じページなので割れない。別ページが2位に20%以上で割れる
const cn = [
  day("2026-11-17", "q1", 80, "https://www.boat-ai.jp/a"), day("2026-11-17", "q1", 40, "https://boat-ai.jp/a/"),
  day("2026-11-17", "q2", 80, "https://www.boat-ai.jp/a"), day("2026-11-17", "q2", 40, "https://www.boat-ai.jp/b"),
  day("2026-11-17", "q3", 95, "https://www.boat-ai.jp/a"), day("2026-11-17", "q3", 5, "https://www.boat-ai.jp/b"),
];
const cannibal = detectCannibal(cn, { from: "2026-11-15", to: "2026-11-21" });
assert.deepEqual(cannibal, [{ query: "q2", pages: ["boat-ai.jp/a", "boat-ai.jp/b"] }]);

// 順位帯ごとの CTR の中央値
const med = ctrMedianByPosition([
  { position: 3.2, impressions: 100, clicks: 20 },
  { position: 3.9, impressions: 100, clicks: 10 },
  { position: 3.5, impressions: 100, clicks: 30 },
  { position: 3.5, impressions: 5, clicks: 5 }, // 表示が少ない
  { position: 15, impressions: 100, clicks: 1 }, // 11位以降は対象外
]);
assert.equal(med.get(4), 0.2);
assert.equal(med.size, 1);

// 判定木（上から順に当たる）
const base = { hasAnsweringPage: true, canonicalOk: true, cannibal: false, position: 5, impressions: 200, ctr: 0.1, medianCtr: 0.1, aio: false, orphan: false };
assert.equal(decideAction({ ...base, hasAnsweringPage: false }), "new_article");
assert.equal(decideAction({ ...base, canonicalOk: false }), "consolidate_canonical");
assert.equal(decideAction({ ...base, cannibal: true }), "consolidate_canonical");
assert.equal(decideAction({ ...base, canonicalOk: null }), "none", "未確認は canonical の誤りとして扱わない");
assert.equal(decideAction({ ...base, position: 14 }), "rewrite_or_internal_link");
assert.equal(decideAction({ ...base, position: 14, impressions: 20 }), "none", "表示が少ない 11〜20位は出さない");
assert.equal(decideAction({ ...base, ctr: 0.02 }), "rewrite_title_description");
assert.equal(decideAction({ ...base, ctr: 0.02, aio: true }), "exclude_aio_from_ctr_rewrite");
assert.equal(decideAction({ ...base, orphan: true }), "internal_link_only");
assert.equal(decideAction({ ...base, cannibal: true, position: 14, orphan: true }), "consolidate_canonical", "先に当たる枝が勝つ");

// 票には桁だけ
assert.equal(approxMagnitude(37), "10台");
assert.equal(approxMagnitude(420), "100台");
assert.equal(approxMagnitude(0), "0");
assert.ok(Object.isFrozen(THRESHOLDS));

console.log("verify-growth-seo-detect: OK（重み付き順位・page の正規化・指名/一般・開催起因・伸び/新/落・カニバリ・判定木）");
