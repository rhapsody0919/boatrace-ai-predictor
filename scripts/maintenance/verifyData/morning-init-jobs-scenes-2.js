/**
 * verify-morning-init-jobs.js の後半の場面（2/4）。verify ではない。
 * 判定と期待値は分ける前の verify-morning-init-jobs.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { BreakerOpenError } from "../../lib/scrapeJobs/circuitBreaker.js";
import { isBreakerOpenError, resolveVenuesLimit } from "../../lib/racesInit/job.js";

let check, show, same, jst, DATE, fakeVenue, newEnv, newDeps, range, T0, at;

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene1() {
  // 全て失敗 → 実行の失敗。ただし進捗は保存する
  const env = newEnv({ mode: "live" });
  const d = newDeps({ venues: [1], failVenues: new Map([[1, "HTTP 503"]]) });
  const r1 = await env.invoke(T0, { deps: d.deps });
  check(
    "(e) 試行した会場が全て失敗: 実行は失敗（500・連続失敗数+1・エラーメッセージ付き）",
    r1.status === 500 &&
      env.row().consecutive_failures === 1 &&
      /全て失敗/.test(env.row().last_error ?? "") &&
      d.calls.write.length === 0,
    show(r1.body),
  );
  const saved = env.row().cursor;
  check(
    "(e) 失敗した起動でも、進捗（試行回数・バックオフ・計画）は保存される（次の起動が計画をやり直さない）",
    saved?.attempts?.["1"] === 1 &&
      typeof saved?.retryAfter?.["1"] === "string" &&
      same(saved?.targets, [1]),
    show(saved),
  );
  const r2 = await env.invoke(at(1), { deps: d.deps });
  check(
    "(e) バックオフの間は、何も試行せず、失敗にもしない（連続失敗数は増えない）",
    r2.status === 200 && d.calls.scrape.length === 1 && d.calls.getVenues === 1,
    show(r2.body),
  );
  d.state.failVenues.clear();
  const r3 = await env.invoke(at(3), { deps: d.deps });
  return { env, r3 };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene2({ env, r3 }) {
  check(
    "(e) 再試行に成功すると done・連続失敗数は0に戻る",
    r3.body.done === true &&
      env.row().consecutive_failures === 0 &&
      env.row().last_target_date === DATE,
  );
}

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene3() {
  // 後始末の失敗
  const env = newEnv({ mode: "live" });
  const d = newDeps({ venues: [1, 2] });
  d.state.unifiedFails = true;
  const r1 = await env.invoke(T0, { deps: d.deps });
  const saved = env.row().cursor;
  check(
    "(e) 後始末（unified）の失敗: 実行は失敗・対象日は済みにしない。ただし会場の進捗と、済んだ後始末（予定表）は保存する",
    r1.status === 500 &&
      /unified-down/.test(env.row().last_error ?? "") &&
      same(saved.settled, [1, 2]) &&
      saved.done === false &&
      saved.finalize.slots?.created === 5 &&
      saved.finalize.unified === undefined &&
      env.row().last_target_date === undefined,
    show(r1.body),
  );
  const alerts = env.row().last_report?.alerts ?? [];
  check(
    "(e) 後始末の失敗は、ジョブ自身の通知に出す",
    alerts.some((a) => a.key === "finalize_failed"),
    show(alerts),
  );
  d.state.unifiedFails = false;
  const r2 = await env.invoke(at(2), { deps: d.deps });
  return { env, d, r2 };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene4({ env, d, r2 }) {
  check(
    "(e) 次の起動: 会場は再取得せず・済んだ予定表の生成も繰り返さず、unified だけやり直して done",
    r2.body.done === true &&
      d.calls.scrape.length === 2 &&
      d.calls.slots === 1 &&
      d.calls.unified === 2 &&
      d.calls.hook === 1 &&
      env.row().last_target_date === DATE,
    show({
      scrape: d.calls.scrape,
      slots: d.calls.slots,
      unified: d.calls.unified,
    }),
  );
  // 書き込み失敗（DB）: 会場を済みにしない
  const env2 = newEnv({ mode: "live" });
  const d2 = newDeps({ venues: [1, 2] });
  const baseWrite = d2.deps.writeVenue;
  d2.deps.writeVenue = async (venue, ctx) => {
    if (venue.placeCd === 2) throw new Error("races書き込みエラー: boom");
    return baseWrite(venue, ctx);
  };
  const r = await env2.invoke(T0, { deps: d2.deps });
  check(
    "(e) 書き込みの失敗: その会場は済みにしない（データの無いまま「済み」にならない）",
    r.status === 200 &&
      same(env2.row().cursor.settled, [1]) &&
      /boom/.test(env2.row().cursor.lastErrors["2"]) &&
      env2.row().last_target_date === undefined,
    show(r.body),
  );
}

async function scene5() {
  {
    const s1 = await scene1();
    scene2(s1);
  }
  {
    // 連続失敗の通知（last_report.alerts）
    const env = newEnv({ mode: "live" });
    const d = newDeps({ venues: [1, 2], failVenues: new Map([[2, "HTTP 500"]]) });
    await env.invoke(T0, { deps: d.deps });
    await env.invoke(at(3), { deps: d.deps });
    const alertsAfter2 = env.row().last_report.alerts;
    await env.invoke(at(8), { deps: d.deps });
    const alerts = env.row().last_report.alerts;
    check(
      "(e) 会場が3回連続で失敗したら、ジョブ自身の通知（last_report.alerts）に出す。それまでは出さない",
      alertsAfter2.length === 0 &&
        alerts.length === 1 &&
        alerts[0].key === "venue_failed:2" &&
        /3回連続/.test(alerts[0].text),
      show(alerts),
    );
  }
  {
    // ブレーカー
    const env = newEnv({ mode: "live" });
    const err = new Error("会場1: 取得に失敗");
    err.cause = new BreakerOpenError("host:boatrace.jp", at(5).getTime());
    const d = newDeps({ venues: [1, 2], failVenues: new Map([[1, err]]) });
    const r = await env.invoke(T0, { deps: d.deps });
    check(
      "(e) サーキットブレーカーが開いている: 失敗にせず、試行回数も増やさず、その起動を終える",
      r.status === 200 &&
        r.body.skipped === "breaker_open" &&
        env.row().consecutive_failures === 0 &&
        d.calls.scrape.length === 1 &&
        env.row().cursor.attempts["1"] === 0 &&
        env.row().cursor.retryAfter["1"] === undefined,
      show(r.body),
    );
    check(
      "(e) isBreakerOpenError: cause の連鎖の中の BreakerOpenError を見つける",
      isBreakerOpenError(err) &&
        !isBreakerOpenError(new Error("x")) &&
        isBreakerOpenError(new BreakerOpenError("h", 1)),
    );
  }
}

async function scene6() {
  {
    // 0レースの会場・0会場
    const env = newEnv({ mode: "live" });
    const d = newDeps({ venues: [1] });
    d.deps.scrapeVenue = async () => fakeVenue(1, { races: 12, racers: 0 });
    const r = await env.invoke(T0, { deps: d.deps });
    check(
      "(e) 開催会場一覧にあるのに、出走表が1レースも取れない会場は、成功にしない（書き込まない・失敗として再試行）",
      r.status === 500 &&
        d.calls.write.length === 0 &&
        env.row().last_target_date === undefined,
      show(r.body),
    );
    const env2 = newEnv({ mode: "live" });
    const d2 = newDeps({ venues: [] });
    const r2 = await env2.invoke(T0, { deps: d2.deps });
    check(
      "(e) 開催会場が0件: 対象日を処理済みにせず、cursor も作らない（次の起動が再確認）。失敗でもない",
      r2.status === 200 &&
        r2.body.noVenues === true &&
        env2.row().last_target_date === undefined &&
        env2.row().cursor === undefined &&
        d2.calls.write.length === 0,
      show(r2.body),
    );
    d2.state.venues = [1];
    const r3 = await env2.invoke(at(2), { deps: d2.deps });
    check(
      "(e) 会場が現れたら、その起動から処理する",
      r3.body.done === true && same(d2.calls.write, [1]),
    );
  }
  {
    const s1 = await scene3();
    await scene4(s1);
  }
}

async function scene7() {
  // ---------------------------------------------------------------------------
  // (f) 会場一覧の再確認・ソフトデッドライン・?venues=N
  // ---------------------------------------------------------------------------
  {
    const env = newEnv({ mode: "live" });
    const d = newDeps({ venues: (n) => (n === 1 ? [1, 2] : [1, 2, 24]) });
    const r1 = await env.invoke(T0, { deps: d.deps });
    check(
      "(f) 全会場が済んだ後の再確認で、新しい会場（24）が見つかったら、処理の対象に加え、対象日は済みにしない",
      r1.body.done === false &&
        same(env.row().cursor.venues, [1, 2, 24]) &&
        same(env.row().cursor.settled, [1, 2]) &&
        d.calls.slots === 0,
      show(r1.body),
    );
    const r2 = await env.invoke(at(2), { deps: d.deps });
    check(
      "(f) 次の起動で、取りこぼしの会場だけ書き込み、done（再確認は1回だけ）",
      r2.body.done === true &&
        same(d.calls.write, [1, 2, 24]) &&
        d.calls.getVenues === 2,
      show(r2.body),
    );
    const env2 = newEnv({ mode: "live" });
    const d2 = newDeps({ venues: [1, 2] });
    const r3 = await env2.invoke(jst("2026-09-21 09:30"), { deps: d2.deps });
    check(
      "(f) 9時を過ぎた起動では、会場一覧を再確認しない（従来の morning-init と同じ）",
      r3.body.done === true && d2.calls.getVenues === 1,
    );
    // 手動の動作確認
    const env3 = newEnv({ mode: "shadow" });
    const d3 = newDeps({ venues: range(10) });
    await env3.invoke(T0, { deps: d3.deps, query: { venues: "2" } });
    check("(f) ?venues=2: 1回の処理を2会場にする", d3.calls.scrape.length === 2);
    const bad = await newEnv({ mode: "shadow" }).invoke(T0, {
      deps: newDeps().deps,
      query: { venues: "abc" },
    });
    check(
      "(f) ?venues=abc: 不正な値は失敗にする（無視して既定にしない）",
      bad.status === 500 && /venues は1〜24/.test(bad.body.error ?? ""),
      show(bad.body),
    );
    check(
      "(f) resolveVenuesLimit: 未指定は既定・範囲外は例外",
      resolveVenuesLimit({}) === 8 &&
        resolveVenuesLimit({ venues: "24" }) === 24 &&
        (() => {
          try {
            resolveVenuesLimit({ venues: "25" });
            return false;
          } catch {
            return true;
          }
        })(),
    );
    // ソフトデッドライン: 1会場300秒かかる時計。maxDuration 800 − 30 = 770秒の手前で、新しい会場に着手しない
    let clockMs = T0.getTime();
    const clock = { advance: (sec) => (clockMs += sec * 1000) };
    const env4 = newEnv({ mode: "shadow" });
    const d4 = newDeps({ venues: range(10), clock, venueCost: 300 });
    await env4.invoke(() => new Date(clockMs), { deps: d4.deps });
    check(
      "(f) ソフトデッドライン（maxDuration−30秒＝770秒）: 1会場300秒なら3会場で止め、残りは次の起動へ",
      d4.calls.scrape.length === 3 && env4.row().cursor.settled.length === 3,
      show(d4.calls.scrape),
    );
  }
}

async function scene8() {
  {
    // BOA-822: イン崩れ注意度の表が読めなかった（RPC の失敗・表の欠け）。後始末を失敗にせず、次の起動で unified を作り直す
    const env = newEnv({ mode: "live" });
    const d = newDeps({ venues: [1] });
    d.state.inCautionFails = 1;
    const r1 = await env.invoke(T0, { deps: d.deps });
    const c1 = env.row().cursor;
    check(
      "(e) イン崩れ注意度の表が読めない: 失敗にせず、unified を済みにしない（対象日も済みにしない・Deploy Hook はまだ叩かない）",
      r1.status === 200 &&
        c1.done === false &&
        c1.finalize.unified === undefined &&
        c1.finalize.inCautionAttempts === 1 &&
        d.calls.hook === 0 &&
        env.row().last_target_date === undefined,
      show({ status: r1.status, finalize: c1.finalize }),
    );
    const r2 = await env.invoke(at(2), { deps: d.deps });
    check(
      "(e) 次の起動で unified を作り直し、表が読めれば done",
      r2.body.done === true &&
        d.calls.unified === 2 &&
        d.calls.hook === 1 &&
        env.row().last_target_date === DATE,
      show({ body: r2.body, unified: d.calls.unified }),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・jst・DATE・fakeVenue・newEnv・newDeps・range・T0・at） */
export async function runMorningInitJobsScenes2(env) {
  ({ check, show, same, jst, DATE, fakeVenue, newEnv, newDeps, range, T0, at } = env);
  await scene5();
  await scene6();
  await scene7();
  await scene8();
}
