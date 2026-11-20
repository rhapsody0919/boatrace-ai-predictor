/**
 * verify-prediction-refresh.js の後半の場面（3/3）。verify ではない。
 * 判定と期待値は分ける前の verify-prediction-refresh.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { raceIdsOf, createFakeClient } from "./prediction-refresh-fake-client.js";

let mainRefresh, check, show, raceTables, NOW, quiet;

async function scene1() {
  // ---------------------------------------------------------------------------
  // (i) cancellation_status の除外（BOA-411）
  // ---------------------------------------------------------------------------
  {
    const ids = raceIdsOf(3);
    const tables = raceTables(ids);
    // 3レース中、末尾2件を中止・順延検知済みにする（race_entries は3件とも存在＝
    // 事前スクレイピング済みでも、cancellation_status を見て除外できるかを検証する）
    tables.races = [
      { race_id: ids[0], race_grade: "一般", cancellation_status: null },
      { race_id: ids[1], race_grade: "一般", cancellation_status: "tentative" },
      { race_id: ids[2], race_grade: "一般", cancellation_status: "confirmed" },
    ];
    const fake = createFakeClient({ tables });
    const result = await quiet(() =>
      mainRefresh({
        isDryRun: false,
        specificRaceIds: ids,
        client: fake,
        writeMode: "upsert",
        now: () => NOW,
      }),
    );
    const predictedRaceIds = new Set(
      fake.state.predictions.map((p) => p.race_id),
    );
    check(
      "mainRefresh: cancellation_status が非NULL（tentative/confirmed）のレースは予測を生成しない（通常レースの1件のみ3行=standard/safeBet/upsetFocus生成）",
      !result.error &&
        predictedRaceIds.has(ids[0]) &&
        !predictedRaceIds.has(ids[1]) &&
        !predictedRaceIds.has(ids[2]) &&
        fake.state.predictions.length === 3,
      `予測のあるレース: ${show([...predictedRaceIds])} / ${fake.state.predictions.length}行 / ${result.error?.message ?? ""}`,
    );
    check(
      "mainRefresh: 除外したレースをログに出力する（race_id と cancellation_status の値を含む）",
      result.lines.some(
        (l) => l.includes(ids[1]) && l.includes("cancellation_status=tentative"),
      ) &&
        result.lines.some(
          (l) =>
            l.includes(ids[2]) && l.includes("cancellation_status=confirmed"),
        ),
      show(result.lines.filter((l) => l.includes("スキップ"))),
    );
  }
}

async function scene2() {
  // ---------------------------------------------------------------------------
  // (j) 発走済みのレースは書かない（BOA-628）。2026年9月、発走後の作り直しが2,065件あり、594件は発走の瞬間に
  //     unified が無かった。NOW は 2026-09-20 12:03 JST
  // ---------------------------------------------------------------------------
  {
    const ids = raceIdsOf(3);
    const tables = raceTables(ids);
    // r1 は発走済み（12:00）、r2 は発走前（12:30）、r3 は発走時刻が無い（判定できないので書く）
    tables.races = [
      { race_id: ids[0], race_grade: "一般", start_time: "12:00:00" },
      { race_id: ids[1], race_grade: "一般", start_time: "12:30:00" },
      { race_id: ids[2], race_grade: "一般", start_time: null },
    ];
    const run = async (opts = {}) => {
      const fake = createFakeClient({ tables: { ...tables, predictions: [] } });
      const r = await quiet(() =>
        mainRefresh({
          isDryRun: false,
          specificRaceIds: ids,
          client: fake,
          date: "2026-09-20",
          now: () => NOW,
          ...opts,
        }),
      );
      return {
        r,
        races: [...new Set(fake.state.predictions.map((p) => p.race_id))].sort(),
      };
    };
    const guarded = await run();
    check(
      "(j) 発走済みのレース（12:00）は書かず、発走前（12:30）と発走時刻の無いレースだけ書く",
      show(guarded.races) === show([ids[1], ids[2]]) && !guarded.r.error,
      show(guarded.races),
    );
    check(
      "(j) 書かなかったレースの件数をログに出す",
      guarded.r.lines.some((l) => l.includes("発走済みの1レースは書かない")),
    );
    const all = await run({ includeStarted: true });
    check(
      "(j) includeStarted のときは発走済みも書く（過去日の作り直し）",
      show(all.races) === show(ids),
      show(all.races),
    );
    const failing = createFakeClient({
      tables: { ...tables, predictions: [] },
      fail: { "races:select": "connection reset" },
    });
    const noSchedule = await quiet(() =>
      mainRefresh({
        isDryRun: false,
        specificRaceIds: ids,
        client: failing,
        date: "2026-09-20",
        now: () => NOW,
      }),
    );
    check(
      "(j) 発走時刻が読めないときは、書かずに例外にする（発走済みを上書きしない）",
      noSchedule.error instanceof Error && failing.state.predictions.length === 0,
      noSchedule.error?.message,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（mainRefresh・check・show・raceTables・NOW・quiet） */
export async function runPredictionRefreshScenes4(env) {
  ({ mainRefresh, check, show, raceTables, NOW, quiet } = env);
  await scene1();
  await scene2();
}
