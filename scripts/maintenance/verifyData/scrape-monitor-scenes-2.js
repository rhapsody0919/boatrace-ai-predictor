/**
 * verify-scrape-monitor.js の後半の場面（2/8）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-monitor.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { evaluateExpired, classifyExpectedUnpublished } from "../../lib/scrapeJobs/monitor.js";
import { t, later, R, LATER, nv, D } from "./scrape-monitor-scenes-1.js";

let check, show, at, slot;

/** 元の verify の1つの塊 { } を割った 1/3 */
function scene1() {
  const active = new Set(["odds", "result"]);
  const run = (target, siblings, now) => {
    const map = classifyExpectedUnpublished(target, {
      siblingSlots: siblings,
      now,
    });
    return {
      map,
      alerts: evaluateExpired(target, {
        activeJobs: active,
        now,
        expectedUnpublished: map,
      }),
    };
  };
  // 後続の窓（-30）が取れている: 想定内（confirmed）。警告なし
  let sib = [
    t,
    ...later(R, [-30], "done", { outcome: "ok" }),
    ...later(R, [-15, -10, -5, 0], "pending", { attempts: 0 }),
  ];
  let r = run([t], sib, at("09:40"));
  check(
    "発売開始の遅れ: -60が no_values で期限切れ、後続の窓（-30）が取れている → 警告しない（confirmed）",
    r.alerts.length === 0 && r.map.get(`odds:${R}:-60`) === "confirmed",
    show([...r.map]),
  );
  // -30 が失敗でも、-15 が取れていれば確認になる（-60 の未公開の後に公開された）。skipped_have_data も確認になる
  sib = [
    t,
    ...later(R, [-30], "expired", { outcome: "no_values", attempts: 3 }),
    ...later(R, [-15], "done", { outcome: "skipped_have_data" }),
  ];
  r = run([t], sib, at("09:50"));
  check(
    "後続の窓のどれか1つが取れていれば確認になる（-30 は失敗・-15 が skipped_have_data でも confirmed）",
    r.alerts.length === 0 && r.map.get(`odds:${R}:-60`) === "confirmed",
  );
  // 保留: 後続の窓がまだ期限+許容幅に達していない → 警告も欠落も保留
  sib = [t, ...later(R, LATER, "pending", { attempts: 0 })];
  r = run([t], sib, at("09:20"));
  check(
    "保留: 後続の窓がまだ来ていない間は、警告しない（deferred）",
    r.alerts.length === 0 && r.map.get(`odds:${R}:-60`) === "deferred",
  );
  sib = [
    t,
    ...later(R, [-30], "expired", { outcome: "no_values", attempts: 3 }),
    ...later(R, [-15, -10, -5, 0], "pending", { attempts: 0 }),
  ];
  r = run([t], sib, at("09:40"));
  check(
    "保留: -30 が失敗でも、-15 以降が未到来なら、なお保留（早すぎる警告をしない）",
    r.alerts.length === 0 && r.map.get(`odds:${R}:-60`) === "deferred",
  );
  // 後続の窓が全て過ぎても取れていない: 通常どおり警告する（本当に取れていない）
  sib = [
    t,
    ...later(R, LATER, "expired", { outcome: "no_values", attempts: 3 }),
  ];
  r = run([t], sib, at("10:30"));
  check(
    "後続の窓（-30〜0）も全て取れなかった → 通常どおり警告（expired:…:-60）",
    r.map.size === 0 && r.alerts.some((a) => a.key === `expired:odds:${R}:-60`),
    show(r.alerts.map((a) => a.key)),
  );
  sib = [t, ...later(R, LATER, "pending", { attempts: 0 })];
  return { active, run, sib, r };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
function scene2({ active, run, sib, r }) {
  r = run([t], sib, at("10:30"));
  check(
    "後続の窓が pending のまま期限+許容幅を過ぎている → 通常どおり警告",
    r.alerts.some((a) => a.key === `expired:odds:${R}:-60`),
  );
  r = run([t], [t], at("09:40"));
  check(
    "後続の窓のスロットが1件も無い（確認できない）→ 警告する",
    r.alerts.some((a) => a.key === `expired:odds:${R}:-60`),
  );
  // 第1レースに限らない（全レース）。race_id の末尾・レース番号に依存しない
  const notFirst = nv(`${D}-01-04`);
  r = run(
    [notFirst],
    [notFirst, ...later(`${D}-01-04`, [-30], "done", { outcome: "ok" })],
    at("09:40"),
  );
  check(
    "第1レース以外（第2レース以降）も、後続の窓が取れていれば、警告しない（confirmed。全レースが対象）",
    r.map.get(`odds:${D}-01-04:-60`) === "confirmed" && r.alerts.length === 0,
    show([...r.map]),
  );
  const suffix12 = nv(`${D}-05-12`);
  r = run(
    [suffix12],
    [suffix12, ...later(`${D}-05-12`, [-30], "done", { outcome: "ok" })],
    at("09:40"),
  );
  check(
    "12レースでも同じ（レース番号に依存しない）",
    r.map.get(`odds:${D}-05-12:-60`) === "confirmed" && r.alerts.length === 0,
  );
  // 結果・試行・窓・ジョブが違うものは対象外
  const okSib = (id) => later(id, [-30], "done", { outcome: "ok" });
  const cases = [
    ["未実行（attempts=0）", nv(R, { attempts: 0, outcome: null })],
    [
      "未実行（attempts=0。outcome が残っていても、未実行は想定内にしない）",
      nv(R, { attempts: 0 }),
    ],
    ["outcome=error", nv(R, { outcome: "error", last_error: "取得先が429" })],
    ["outcome=partial", nv(R, { outcome: "partial" })],
    [
      "別の窓（-30）",
      slot("odds", -30, "expired", {
        race_id: R,
        attempts: 3,
        outcome: "no_values",
      }),
    ],
    [
      "別のジョブ（result）",
      slot("result", -60, "expired", {
        race_id: R,
        attempts: 3,
        outcome: "no_values",
      }),
    ],
  ];
  for (const [label, target] of cases) {
    r = run([target], [target, ...okSib(R)], at("09:40"));
    check(
      `対象外（従来どおり警告）: ${label}`,
      r.map.size === 0 && r.alerts.length === 1,
      show(r.alerts.map((a) => a.key)),
    );
  }
  // 確定中止・shadow は、従来どおり警告しない（想定内の判定とは無関係に）
  const cancelled = nv(R, { cancel: "confirmed" });
  r = run([cancelled], [cancelled, ...okSib(R)], at("09:40"));
  return { active, run, sib, r };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
function scene3({ active, run, sib, r }) {
  check(
    "確定中止は、従来どおり警告しない",
    r.alerts.length === 0 && r.map.size === 0,
  );
  sib = [t, ...later(R, [-30], "done", { outcome: "ok", run_mode: "shadow" })];
  r = run([t], sib, at("10:30"));
  check(
    "shadow の後続の窓は、確認に使わない（警告する）",
    r.alerts.some((a) => a.key === `expired:odds:${R}:-60`),
  );
  sib = [t, ...later(R, [-30], "done", { outcome: "cancelled_race" })];
  r = run([t], sib, at("10:30"));
  check(
    "後続の窓が cancelled_race で完了したものは、公開の確認に使わない（警告する）",
    r.alerts.some((a) => a.key === `expired:odds:${R}:-60`),
  );
  check(
    "expectedUnpublished を渡さなければ、従来どおり警告する",
    evaluateExpired([t], { activeJobs: active, now: at("09:40") }).length === 1,
  );
  // -60 が pending のまま期限+許容幅を過ぎている（expired化されていない）場合も、同じ判定
  const pendingNv = nv(R, { status: "pending", attempts: 2 });
  sib = [pendingNv, ...later(R, [-30], "done", { outcome: "ok" })];
  r = run([pendingNv], sib, at("09:40"));
  check(
    "-60 が pending のまま期限+許容幅を超えた場合も、後続の窓が取れていれば警告しない",
    r.alerts.length === 0 && r.map.get(`odds:${R}:-60`) === "confirmed",
  );
}

function scene4() {
  {
    const s1 = scene1();
    const s2 = scene2(s1);
    scene3(s2);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・at・slot） */
export function runScrapeMonitorScenes2(env) {
  ({ check, show, at, slot } = env);
  scene4();
}
