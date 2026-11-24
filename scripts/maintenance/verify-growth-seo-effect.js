/**
 * verify-growth-seo-effect.js - 効きの測りの純関数（scripts/lib/growth/seoEffect.js、SEO データの輪 PR4）を確かめる。
 * ネットワーク・DB には触れない。
 *
 * 守る物:
 *   - 比べる単位は7日の和。基準 = 改稿前28日、帯 = 7日の和の最小〜最大。基準の日が足りなければ判定しない
 *   - 新記事は段（索引→表示→クリック）で、止まった段を返す。確認の日は D+1/D+3/D+7 と T+28
 *   - 「分けられない」は機械の3条件（同じ反映の枠に同じページ・サイト全体の変更／コアアップデート期間／GA4 の計測の変更日をまたぐ）
 *   - 改稿は対照（触っていないページ群）の動きで割ってから帯と比べ、サイト全体の波を効きにしない
 */
import assert from "node:assert/strict";
import {
  EFFECT,
  baselineBand,
  cannotSeparate,
  deploySlotOf,
  dueCheckpoints,
  judgeRewrite,
  newArticleStage,
  sumWindow,
  unmeasured,
} from "../lib/growth/seoEffect.js";

const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const start = Date.parse("2026-10-01T00:00:00Z");
/** start から n 日ぶん、clicks を f(i) で並べる */
const series = (n, f, page = "boat-ai.jp/a") =>
  Array.from({ length: n }, (_, i) => ({ date: iso(start + i * DAY), page, clicks: f(i), impressions: f(i) * 10 }));

// 7日の和
const flat = series(30, () => 2);
assert.equal(sumWindow(flat, "2026-10-01"), 14);
assert.equal(sumWindow(flat, "2026-10-01", 7, "impressions"), 140);

// 基準と帯: 改稿日は 2026-10-29（前28日 = 10/01〜10/28）。日ごと 2 なら、どの7日の和も 14
const editDate = "2026-10-29";
assert.deepEqual(baselineBand(flat, editDate), { min: 14, max: 14, base: 14 });
const wavy = series(28, (i) => (i < 14 ? 1 : 3)); // 7日の和は 7 〜 21
const band = baselineBand(wavy, editDate);
assert.equal(band.min, 7);
assert.equal(band.max, 21);
assert.equal(baselineBand(series(10, () => 2), editDate), null, "基準の日が14日に満たなければ帯を出さない");

// 反映の枠（JST 05:45・11:45・17:45。マージ時刻以降で最初の定時）
assert.equal(deploySlotOf("2026-11-24T01:00:00Z"), "2026-11-24T02:45:00.000Z"); // JST 10:00 → 11:45
assert.equal(deploySlotOf("2026-11-24T02:45:00Z"), "2026-11-24T02:45:00.000Z"); // ちょうど定時
assert.equal(deploySlotOf("2026-11-24T09:00:00Z"), "2026-11-24T20:45:00.000Z"); // JST 18:00 → 翌 05:45

// 分けられない: 条件1（同じ枠に同じページ／サイト全体の変更）
const edit = { id: "e1", mergedAt: "2026-10-29T01:00:00Z", page: "boat-ai.jp/a" };
const window = { from: "2026-10-01", to: "2026-11-26" };
const ok = cannotSeparate({ edit, window, changes: [{ id: "e1", mergedAt: edit.mergedAt, pages: ["boat-ai.jp/a"], siteWide: false }] });
assert.deepEqual(ok, { separable: true, reasons: [] }, "自分自身は数えない");
assert.deepEqual(
  cannotSeparate({ edit, window, changes: [{ id: "c1", mergedAt: "2026-10-29T02:00:00Z", pages: ["boat-ai.jp/a"], siteWide: false }] }).reasons,
  ["same_slot_change"],
);
assert.deepEqual(
  cannotSeparate({ edit, window, changes: [{ id: "c2", mergedAt: "2026-10-29T02:00:00Z", pages: [], siteWide: true }] }).reasons,
  ["same_slot_change"],
  "サイト全体の型の変更",
);
assert.equal(
  cannotSeparate({ edit, window, changes: [{ id: "c3", mergedAt: "2026-10-29T02:00:00Z", pages: ["boat-ai.jp/b"], siteWide: false }] }).separable,
  true,
  "同じ枠でも別のページの変更なら分けられる",
);
assert.equal(
  cannotSeparate({ edit, window, changes: [{ id: "c4", mergedAt: "2026-10-30T02:00:00Z", pages: ["boat-ai.jp/a"], siteWide: false }] }).separable,
  true,
  "別の枠",
);
// 条件2: コアアップデート（台帳が空の間は条件が空）
assert.deepEqual(cannotSeparate({ edit, window, coreUpdates: [{ from: "2026-11-05", to: "2026-11-20" }] }).reasons, ["core_update"]);
assert.equal(cannotSeparate({ edit, window, coreUpdates: [] }).separable, true);
assert.equal(cannotSeparate({ edit, window, coreUpdates: [{ from: "2026-12-01", to: "2026-12-10" }] }).separable, true);
// 条件3: GA4 の計測の変更日をまたぐ（GA4 を使う判定のみ）
const ga4Window = { from: "2026-09-20", to: "2026-10-20" }; // 2026-09-29・10-01 をまたぐ
assert.deepEqual(cannotSeparate({ edit, window: ga4Window, usesGa4: true }).reasons, ["ga4_measurement_break"]);
assert.equal(cannotSeparate({ edit, window: ga4Window, usesGa4: false }).separable, true, "GSC だけの判定は対象外");

// 確認の日
assert.deepEqual(dueCheckpoints("2026-11-01", "2026-11-01"), []);
assert.deepEqual(dueCheckpoints("2026-11-01", "2026-11-04"), ["D+1", "D+3"]);
assert.deepEqual(dueCheckpoints("2026-11-01", "2026-11-29"), ["D+1", "D+3", "D+7", "T+28"]);

// 新記事の段
assert.deepEqual(newArticleStage({ indexStatus: "not_indexed", impressions: 0, clicks: 0 }), { stage: "not_indexed", stoppedAt: "index" });
assert.deepEqual(newArticleStage({ indexStatus: "unknown", impressions: 5, clicks: 0 }), { stage: "index_unknown", stoppedAt: "index" });
assert.deepEqual(newArticleStage({ indexStatus: "indexed", impressions: 0, clicks: 0 }), { stage: "indexed", stoppedAt: "impressions" });
assert.deepEqual(newArticleStage({ indexStatus: "indexed", impressions: 40, clicks: 0 }), { stage: "impressions", stoppedAt: "clicks" });
assert.deepEqual(newArticleStage({ indexStatus: "indexed", impressions: 40, clicks: 2 }), { stage: "clicks", stoppedAt: null });

// 改稿の判定。改稿日 10/29 の T+28 時点の7日 = 11/19〜11/25（日 i = 49..55）
const sep = { separable: true, reasons: [] };
const run = (page, ctrl) =>
  judgeRewrite({ rows: page, controlRows: ctrl, editDate, cannot: sep });
const before = (f) => (i) => (i < 28 ? f.before : i >= 49 ? f.after : f.mid);
const mk = (f) => series(56, before(f));
const ctrlFlat = mk({ before: 10, mid: 10, after: 10 });
assert.equal(run(mk({ before: 2, mid: 2, after: 4 }), ctrlFlat).verdict, "伸びた");
assert.equal(run(mk({ before: 2, mid: 2, after: 2 }), ctrlFlat).verdict, "動かず");
assert.equal(run(mk({ before: 2, mid: 2, after: 1 }), ctrlFlat).verdict, "戻った");
// サイト全体の波: 対照も2倍になっているなら、対象の2倍は効きではない
assert.equal(run(mk({ before: 2, mid: 2, after: 4 }), mk({ before: 10, mid: 10, after: 20 })).verdict, "動かず");
// 対照が無い・基準が短い・分けられない条件
assert.deepEqual(run(mk({ before: 2, mid: 2, after: 4 }), []).reasons, ["control_missing"]);
assert.deepEqual(run(series(10, () => 2), ctrlFlat).reasons, ["baseline_too_short"]);
const blocked = judgeRewrite({ rows: flat, controlRows: ctrlFlat, editDate, cannot: { separable: false, reasons: ["core_update"] } });
assert.deepEqual(blocked, { verdict: "分けられない", reasons: ["core_update"] });

// 未測定: 公開から28日を過ぎて判定が出ていない記事
assert.deepEqual(
  unmeasured(
    [
      { id: "a", publishDate: "2026-10-01", measuredAt: null },
      { id: "b", publishDate: "2026-10-01", measuredAt: "2026-10-30" },
      { id: "c", publishDate: "2026-11-10", measuredAt: null },
    ],
    "2026-11-24",
  ),
  ["a"],
);
assert.equal(EFFECT.mainCheckDay, 28);

console.log("verify-growth-seo-effect: OK（7日の和・基準と帯・反映の枠・分けられない3条件・新記事の段・改稿の判定・未測定）");
