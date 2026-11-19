/**
 * verify-point-rank-daily.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-point-rank-daily.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { run, _internal } from "../../daily/scrape-point-rank.js";
import { runPointRankJob } from "../../lib/pointRankJob.js";

let check, show, G1_TABLE, createFakeClient, tablesFor, fetchFor, opts, DAILY, AT_2200;

async function scene1() {
  // --- 22:00 に表が前の日（2日目）のまま: 書かずに incomplete --------------------------------
  {
    const c = createFakeClient(tablesFor("2026-09-18", 3));
    const res = await runPointRankJob({
      targetDate: "2026-09-18",
      client: c,
      politeFetch: fetchFor(2),
      mode: "live",
      shouldStop: () => false,
      now: AT_2200,
    });
    check(
      "3日目の対象日に表が2日目の時点: 写しに書かず incomplete（その日の値は後から取り直せない）",
      res.incomplete === true &&
        (c.data[DAILY] ?? []).length === 0 &&
        res.report.daily?.pendingVenues?.[0]?.reason === "day_not_reflected",
      show({ incomplete: res.incomplete, daily: res.report.daily }),
    );
  }
  // --- 補足の最後の起動（01:30 JST）でも表が前の日のまま: 失敗にして知らせる ---------------------------
  {
    const c = createFakeClient(tablesFor("2026-09-18", 3));
    const res = await runPointRankJob({
      targetDate: "2026-09-18",
      client: c,
      politeFetch: fetchFor(2),
      mode: "live",
      shouldStop: () => false,
      now: () => new Date("2026-09-18T16:30:00Z"),
    });
    check(
      "01:30 JST の起動でも表が2日目の時点: outcome=error（その日の写しを欠くことを知らせる）",
      res.outcome === "error" && /補足の最後の起動/.test(res.error ?? ""),
      show({ outcome: res.outcome, error: res.error }),
    );
  }
}

async function scene2() {
  // --- グレードが未取得の会場: 写さず skipped に grade_unknown で出す -------------------------------
  {
    const t = tablesFor("2026-09-18", 3);
    for (const r of t.races) if (r.race_id.includes("-05-")) r.race_grade = null;
    const c = createFakeClient(t);
    const res = await run("2026-09-18", opts(c));
    check(
      "グレードが未取得の会場: 写しに書かず skippedVenues に grade_unknown",
      (c.data[DAILY] ?? []).length === 0 &&
        res.daily?.skippedVenues?.[0]?.reason === "grade_unknown",
      show(res.daily),
    );
  }
  // --- 丸一日の中止（全レース confirmed）で表が前の日のまま: incomplete にしない --------------------
  {
    const all = Array.from({ length: 12 }, (_, i) => i + 1);
    const c = createFakeClient(tablesFor("2026-09-18", 3, { cancelled: all }));
    const res = await runPointRankJob({
      targetDate: "2026-09-18",
      client: c,
      politeFetch: fetchFor(2),
      mode: "live",
      shouldStop: () => false,
      now: AT_2200,
    });
    check(
      "丸一日の中止で表が前の日の時点: 書かず skipped、incomplete にしない",
      res.incomplete === false &&
        (c.data[DAILY] ?? []).length === 0 &&
        res.report.daily?.skippedVenues?.length === 1,
      show({ incomplete: res.incomplete, daily: res.report.daily }),
    );
  }
}

async function scene3() {
  // --- G3 の表は写さない（注記が無くても失敗にしない） ------------------------------------------
  {
    const c = createFakeClient(tablesFor("2026-09-18", 3, { grade: "G3" }));
    const html = G1_TABLE.replace("４日目１２R終了時点", "");
    const res = await run("2026-09-18", opts(c, fetchFor(3, html)));
    check(
      "G3 の表: racer_series_points は書き、写しには書かず、注記が無くても失敗にしない",
      res.failures.length === 0 &&
        res.count === 52 &&
        (c.data[DAILY] ?? []).length === 0,
      show({ failures: res.failures, daily: res.daily }),
    );
  }
  // --- racer_series_points の書き込みに失敗しても、写しは書く ----------------------------------
  {
    const c = createFakeClient(tablesFor("2026-09-18", 3), {
      failOn: {
        "racer_series_points:upsert": { code: "57014", message: "timeout" },
      },
    });
    const res = await run("2026-09-18", opts(c));
    check(
      "racer_series_points の書き込みの失敗: 失敗にしたうえで、写しは52行書く",
      res.failures.some((f) => /racer_series_points 書き込みエラー/.test(f)) &&
        res.updated === false &&
        (c.data[DAILY] ?? []).length === 52,
      show({ failures: res.failures, daily: res.daily }),
    );
  }
  // --- 注記の読み取り: 初日の表記・別の欄の文字に当たらない ------------------------------------
  {
    const cheerio = await import("cheerio");
    const { parsePointRankAsOf } = await import("../../lib/pointRankParser.js");
    check(
      "parsePointRankAsOf: 「初日１２Ｒ終了時点」は1日目12R",
      show(
        parsePointRankAsOf(
          cheerio.load(
            '<ul class="notes2"><li>初日１２Ｒ終了時点 ※当日の結果が…</li></ul>',
          ),
        ),
      ) === show({ seriesDay: 1, raceNumber: 12 }),
    );
    check(
      "parsePointRankAsOf: li の外の文字（本文の説明）は拾わない",
      parsePointRankAsOf(cheerio.load("<p>３日目１２R終了時点の例</p>")) === null,
    );
  }
  // --- 純粋関数: 書く会場が無ければ0行 ---------------------------------------------
  check(
    "buildDailyRows: 会場が無ければ0行",
    _internal.buildDailyRows("2026-09-18", [], "x").length === 0,
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・G1_TABLE・createFakeClient・tablesFor・fetchFor・opts・DAILY・AT_2200） */
export async function runPointRankDailyScenes1(env) {
  ({ check, show, G1_TABLE, createFakeClient, tablesFor, fetchFor, opts, DAILY, AT_2200 } = env);
  await scene1();
  await scene2();
  await scene3();
}
