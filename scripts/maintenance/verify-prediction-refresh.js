/**
 * verify-prediction-refresh.js - 予測リフレッシュ案1（BOA-353 T4b-03、plan.md §5）の検証。
 * DBにも取得先にも接続しない（インメモリの偽クライアントを使う）。
 *
 *   (a) トグル: REFRESH_ON_VERCEL・SKIP_ODDS_REFRESH_ON_GHA は、未設定・"true"以外ではoff（現行動作）
 *   (b) GitHub側: 既定はオッズ起点を含む（現行）。SKIP_ODDS_REFRESH_ON_GHA=true でオッズ起点だけ外れる
 *   (c) Vercel側（refreshAfterExhibition）: off なら mainRefresh を呼ばない。on で、変更を書いたレース
 *       のみを upsert 方式・対象日つきで呼ぶ。変更が無ければ呼ばない。失敗は投げない（展示の成否と分離）
 *   (d) mainRefresh の Vercel 対応: process.exit せず例外にする / 引数の日付が argv より優先 /
 *       Deploy Hook は decideDeployHook の抑制を維持 / race_id の一括取得が1000行の上限で欠けない
 *       （200レースを取得できる）/ 展示・気象の取得失敗は例外にする（予測を上書きしない）
 *   (e) 書き込み方式: upsert のみ（削除→挿入の replace は BOA-628 で廃止し、指定すると例外）。削除も挿入もせず、
 *       失敗しても以前の予測が残る（的中フラグ等は null、predicted_at は現在時刻）
 *   (f) 展示取得（scrape-exhibition-data.js）が、実際に書き込んだレースを changedRaceIds で返す
 *   (g) 併走の排他: 案1の状態（GitHub は upsert・Vercel も upsert）で、同じレースを同時に再計算しても、
 *       予測が空にならず、書き込みが衝突して失敗しない（mainRefresh は predictions を削除しない）
 *   (j) 発走済みのレース（BOA-628）: mainRefresh は書かない（includeStarted のときだけ書く）。発走時刻が無いレースは書く
 *   (i) cancellation_status の除外（BOA-411）: races.cancellation_status が非NULL（tentative/confirmed）の
 *       レースは、race_entries が事前スクレイピング済みでも予測を生成しない。開催されなかったレースに
 *       predictions が誤生成される不具合の再発防止（is_hit_win 等が永遠に未確定のまま残存する）
 *
 * 実行: node scripts/maintenance/verify-prediction-refresh.js
 */
import {
  collectGhaRefreshRaceIds,
  isOddsRefreshSkippedOnGha,
  isRefreshOnVercelEnabled,
  refreshAfterExhibition,
} from "../lib/predictionRefresh.js";
import { mainRefresh as mainRefreshRaw } from "../daily/generate-predictions.js";
import { scrapeAndUpsertRaces } from "../daily/scrape-exhibition-data.js";
import { createFakeClient } from "./verifyData/prediction-refresh-fake-client.js";
import { runPredictionRefreshScenes1 } from "./verifyData/prediction-refresh-scenes-1.js";
import { runPredictionRefreshScenes2, runPredictionRefreshScenes3 } from "./verifyData/prediction-refresh-scenes-2.js";
import { runPredictionRefreshScenes4 } from "./verifyData/prediction-refresh-scenes-3.js";

// 対象日を指定しない呼び出しは、実行日（JSTの今日）が対象になり、フィクスチャ（2026-09-20）と、日付が変わると食い違って
// 失敗していた（2026-09-21以降、master で11件失敗）。フィクスチャの日付を、既定の対象日として固定する
const FIXTURE_DATE = "2026-09-20";
const mainRefresh = (options = {}) =>
  mainRefreshRaw({ date: FIXTURE_DATE, ...options });

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);

// ---------------------------------------------------------------------------
// インメモリの偽クライアント createFakeClient と レースIDの作り手 raceIdsOf は verifyData/prediction-refresh-fake-client.js
// ---------------------------------------------------------------------------

function raceTables(raceIds, { withExhibition = true } = {}) {
  const grades = ["A1", "A2", "B1", "B1", "B2", "B1"];
  return {
    race_entries: raceIds.flatMap((race_id) =>
      grades.map((grade, i) => ({
        race_id,
        boat_number: i + 1,
        racer_id: `${4000 + i}`,
        player_name: `選手${i + 1}`,
        grade,
        age: 30 + i,
        win_rate: 6.5 - i * 0.5,
        global_2rate: 50 - i * 5,
        global_3rate: 65 - i * 5,
        local_win_rate: 6.0 - i * 0.4,
        local_2rate: 48 - i * 4,
        local_3rate: 62 - i * 4,
        motor_number: 10 + i,
        motor_2rate: 40 - i * 2,
        motor_3rate: 55 - i * 2,
        boat_number_id: 20 + i,
        boat_2rate: 38 - i * 2,
        boat_3rate: 52 - i * 2,
      })),
    ),
    race_conditions: raceIds.map((race_id) => ({
      race_id,
      weather: "晴",
      temperature: 22,
      wind_speed: 2,
      water_temperature: 21,
      wave_height: 3,
      race_title: "テスト戦",
    })),
    exhibition_data: withExhibition
      ? raceIds.flatMap((race_id) =>
          [1, 2, 3, 4, 5, 6].map((boat_number) => ({
            race_id,
            boat_number,
            exhibition_time: 6.7 + boat_number * 0.01,
            start_timing: 0.1 + boat_number * 0.01,
          })),
        )
      : [],
    races: raceIds.map((race_id) => ({ race_id, race_grade: "一般" })),
    venues: [],
    racer_aggregated_stats: [],
    predictions: [],
  };
}

const NOW = new Date("2026-09-20T03:03:00.000Z"); // 毎時の先頭5分以内（Deploy Hook の対象になりうる）
const NOW_LATE = new Date("2026-09-20T03:30:00.000Z"); // 毎時の先頭5分より後（抑制される）

/** コンソール出力を捨てながら fn を実行し、出力した行を返す */
async function quiet(fn) {
  const lines = [];
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  console.log = (...a) => lines.push(a.join(" "));
  console.warn = (...a) => lines.push(a.join(" "));
  console.error = (...a) => lines.push(a.join(" "));
  try {
    return { value: await fn(), lines };
  } catch (error) {
    return { error, lines };
  } finally {
    Object.assign(console, original);
  }
}

// ---------------------------------------------------------------------------
// (a) トグル
// ---------------------------------------------------------------------------
{
  const off = [undefined, "", "false", "FALSE", "1", "yes", "on", "truee"];
  check(
    "REFRESH_ON_VERCEL: 未設定・true以外はoff（現行動作）",
    off.every((v) => !isRefreshOnVercelEnabled({ REFRESH_ON_VERCEL: v })) &&
      !isRefreshOnVercelEnabled({}),
  );
  check(
    'REFRESH_ON_VERCEL: "true" でon（大文字小文字・前後の空白は許容）',
    ["true", "TRUE", " true "].every((v) =>
      isRefreshOnVercelEnabled({ REFRESH_ON_VERCEL: v }),
    ),
  );
  check(
    "SKIP_ODDS_REFRESH_ON_GHA: 未設定・true以外はoff（オッズ起点を外さない）、trueでon",
    off.every(
      (v) => !isOddsRefreshSkippedOnGha({ SKIP_ODDS_REFRESH_ON_GHA: v }),
    ) &&
      !isOddsRefreshSkippedOnGha({}) &&
      isOddsRefreshSkippedOnGha({ SKIP_ODDS_REFRESH_ON_GHA: "true" }),
  );
}

// ---------------------------------------------------------------------------
// (b) GitHub側の対象レースの集め方
// ---------------------------------------------------------------------------
{
  const input = {
    infoRaceIds: ["r1", "r2"],
    oddsRaceIds: ["r2", "r3", "r4"],
    exhibitionRaceIds: ["r5"],
  };
  const legacy = collectGhaRefreshRaceIds(input);
  check(
    "GitHub側（既定）: レース情報・オッズ・展示の起点を全て含む（現行動作と同じ）",
    show([...legacy].sort()) === show(["r1", "r2", "r3", "r4", "r5"]),
    show([...legacy]),
  );
  const skipped = collectGhaRefreshRaceIds({ ...input, skipOddsRefresh: true });
  check(
    "GitHub側（SKIP_ODDS_REFRESH_ON_GHA=true）: オッズ起点だけが外れ、レース情報・展示の起点は残る（オッズ起点のみのr3・r4が消え、r2はレース情報起点で残る）",
    show([...skipped].sort()) === show(["r1", "r2", "r5"]),
    show([...skipped]),
  );
  check(
    "GitHub側: 起点が空でもエラーにならない",
    collectGhaRefreshRaceIds({}).size === 0,
  );
}

// ---------------------------------------------------------------------------
// (c) Vercel側: 展示取得の後の再計算
// ---------------------------------------------------------------------------
{
  const silent = { log() {}, error() {} };
  const calls = [];
  const refresh = async (args) => {
    calls.push(args);
  };

  const off = await refreshAfterExhibition({
    result: { changedRaceIds: ["a", "b"] },
    date: "2026-09-20",
    refresh,
    env: {},
    logger: silent,
  });
  check(
    "Vercel側（REFRESH_ON_VERCEL 未設定）: mainRefresh を呼ばない（現行動作）",
    calls.length === 0 && off.refreshed === false,
    show({ calls, off }),
  );

  const on = await refreshAfterExhibition({
    result: { changedRaceIds: ["a", "b", "a"] },
    date: "2026-09-20",
    refresh,
    env: { REFRESH_ON_VERCEL: "true" },
    logger: silent,
  });
  check(
    "Vercel側（on）: 変更を書いたレース（重複除去）だけを、対象日・upsert方式・dry-runなしで1回呼ぶ",
    calls.length === 1 &&
      show(calls[0]) ===
        show({
          isDryRun: false,
          specificRaceIds: ["a", "b"],
          date: "2026-09-20",
          writeMode: "upsert",
        }) &&
      on.refreshed === true,
    show({ calls, on }),
  );

  const before = calls.length;
  for (const result of [
    { changedRaceIds: [] },
    {},
    null,
    undefined,
    { updated: true, count: 5 },
  ]) {
    await refreshAfterExhibition({
      result,
      date: "2026-09-20",
      refresh,
      env: { REFRESH_ON_VERCEL: "true" },
      logger: silent,
    });
  }
  check(
    "Vercel側（on）: 変更を書いたレースが無い（未公開・変更なし・戻り値なし）なら呼ばない",
    calls.length === before,
    `${calls.length - before}回呼ばれた`,
  );

  const failing = await refreshAfterExhibition({
    result: { changedRaceIds: ["a"] },
    date: "2026-09-20",
    refresh: async () => {
      throw new Error("DBが落ちている");
    },
    env: { REFRESH_ON_VERCEL: "true" },
    logger: silent,
  });
  check(
    "Vercel側（on）: 再計算の失敗は投げず、error として返す（展示データの取得・保存の成否と分離する）",
    failing.refreshed === false && failing.error === "DBが落ちている",
    show(failing),
  );
}

// ---- 後半の場面（verifyData/prediction-refresh-scenes-1.js・prediction-refresh-scenes-2.js） ----
await runPredictionRefreshScenes1({ mainRefresh, check, show, raceTables, NOW, NOW_LATE, quiet });
await runPredictionRefreshScenes2({ mainRefresh, check, show, raceTables, NOW, quiet });

// ---------------------------------------------------------------------------
// (f) 展示取得（scrapeAndUpsertRaces）が、実際に書き込んだレースを changedRaceIds で返す
//     公式ページの代わりに、合成した beforeinfo の HTML を fetch で返し、偽クライアントに書き込む
// ---------------------------------------------------------------------------
{
  const fs = await import("node:fs");
  const weatherBlock = fs
    .readFileSync(
      new URL(
        "../lib/__fixtures__/weather/beforeinfo-05-01-1634.html",
        import.meta.url,
      ),
      "utf8",
    )
    .replace(/<!--[\s\S]*?-->/g, "");
  // .table1 の2つ目に、6艇分の tbody（1艇4行）。展示タイムは第5セル（index 4）
  const beforeinfoHtml = (times) => `<html><body>
    <div class="table1"><table></table></div>
    <div class="table1"><table>${times
      .map(
        (t, i) =>
          `<tbody><tr><td>${i + 1}</td><td></td><td></td><td>52.0kg</td><td>${t}</td><td>-0.5</td><td></td><td><ul></ul></td><td>R</td><td>3</td></tr><tr></tr><tr></tr><tr></tr></tbody>`,
      )
      .join("")}</table></div>
    ${weatherBlock}</body></html>`;

  const raceIds = ["2026-09-19-05-01", "2026-09-19-05-02"];
  const targets = raceIds.map((race_id, i) => ({
    race_id,
    venue_code: 5,
    race_no: i + 1,
    start_time: new Date("2026-09-19T08:00:00.000Z"),
  }));
  // レースごとの展示タイム（1つ目のレースだけ、あとで変える）
  const timesOf = {
    1: [6.71, 6.72, 6.73, 6.74, 6.75, 6.76],
    2: [6.8, 6.81, 6.82, 6.83, 6.84, 6.85],
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const raceNo = Number(new URL(url).searchParams.get("rno"));
    return new Response(beforeinfoHtml(timesOf[raceNo]), { status: 200 });
  };
  const runScrape = async (client) =>
    (
      await quiet(() =>
        scrapeAndUpsertRaces(targets, "2026-09-19", {
          updateWeather: true,
          client,
        }),
      )
    ).value;

  try {
    const fake = createFakeClient({
      tables: { exhibition_data: [], race_conditions: [] },
    });
    const first = await runScrape(fake);
    check(
      "展示取得: 初回は、書き込んだ2レース（exhibition_data・気象）を changedRaceIds で返す",
      first?.updated === true &&
        show([...first.changedRaceIds].sort()) === show(raceIds),
      show(first?.changedRaceIds),
    );
    check(
      "展示取得: exhibition_data に12行（2レース×6艇）、race_conditions に2行が書かれる",
      fake.state.exhibition_data.length === 12 &&
        fake.state.race_conditions.length === 2,
      `${fake.state.exhibition_data.length}行・${fake.state.race_conditions.length}行`,
    );

    const second = await runScrape(fake);
    check(
      "展示取得: 同じ内容の2回目は、updated=true（取得した行はある）でも、変更を書いていないため changedRaceIds は空（再計算しない）",
      second?.updated === true &&
        second.count === 12 &&
        show(second.changedRaceIds) === show([]),
      show({ updated: second?.updated, changed: second?.changedRaceIds }),
    );

    timesOf[1] = [6.71, 6.72, 6.73, 6.74, 6.75, 6.99]; // 1つ目のレースの1艇だけ変わる
    const third = await runScrape(fake);
    check(
      "展示取得: 値が変わったレースだけが changedRaceIds に入る（1つ目のみ）",
      show(third?.changedRaceIds) === show([raceIds[0]]),
      show(third?.changedRaceIds),
    );

    const failFake = createFakeClient({
      tables: { exhibition_data: [], race_conditions: [] },
      fail: { "exhibition_data:upsert": "connection reset" },
    });
    const failed = await runScrape(failFake);
    check(
      "展示取得: exhibition_data の書き込みが失敗したら、そのレースは changedRaceIds に入れない（気象を書けたレースのみ入る）",
      show([...(failed?.changedRaceIds ?? [])].sort()) === show(raceIds) &&
        failFake.state.exhibition_data.length === 0,
      "気象は書けるため、気象の変更で2レースが入る",
    );
    const bothFail = createFakeClient({
      tables: { exhibition_data: [], race_conditions: [] },
      fail: {
        "exhibition_data:upsert": "connection reset",
        "race_conditions:upsert": "connection reset",
      },
    });
    const none = await runScrape(bothFail);
    check(
      "展示取得: 展示・気象とも書き込めなかったら、changedRaceIds は空（DBが変わっていないので再計算しない）",
      show(none?.changedRaceIds) === show([]),
      show(none?.changedRaceIds),
    );
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ---- 後半の場面（verifyData/prediction-refresh-scenes-2.js） ----
await runPredictionRefreshScenes3({ mainRefresh, check, show, raceTables, NOW, quiet });

// ---------------------------------------------------------------------------
// (h) 配線の静的確認（scrape-scheduled.js・api/cron/exhibition.js は、import 時に実行される／HTTPハンドラーの
//     ため、ここでは実行できない。トグルの配線が外れていないことを、ソースで確認する）
// ---------------------------------------------------------------------------
{
  const fs = await import("node:fs");
  const read = (path) =>
    fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const scheduled = read("scripts/daily/scrape-scheduled.js");
  check(
    "scrape-scheduled.js: オッズ起点の除外は SKIP_ODDS_REFRESH_ON_GHA（isOddsRefreshSkippedOnGha）で決まり、collectGhaRefreshRaceIds で対象を集める",
    /const skipOddsRefresh = isOddsRefreshSkippedOnGha\(\)/.test(scheduled) &&
      /collectGhaRefreshRaceIds\(\{[\s\S]*?skipOddsRefresh,[\s\S]*?\}\)/.test(
        scheduled,
      ),
  );
  check(
    "scrape-scheduled.js: 書き込み方式を指定しない（既定の upsert。replace は BOA-628 で廃止）",
    !/writeMode/.test(scheduled),
  );
  check(
    "scrape-scheduled.js: オッズ・レース情報・展示の各起点を別々の集合に集めている（オッズ起点だけを外せる）",
    /oddsRaceIds\.add/.test(scheduled) &&
      /infoRaceIds\.add/.test(scheduled) &&
      /exhibitionRaceIds\.add/.test(scheduled) &&
      !/updatedRaceIds\.add/.test(scheduled),
  );
  const workflow = read(".github/workflows/scrape-scheduled.yml");
  check(
    "scrape-scheduled.yml: SKIP_ODDS_REFRESH_ON_GHA を、リポジトリ変数（vars）から環境に渡す（未設定なら空＝off）",
    /SKIP_ODDS_REFRESH_ON_GHA: \$\{\{ vars\.SKIP_ODDS_REFRESH_ON_GHA \}\}/.test(
      workflow,
    ),
  );
  // 展示・レース情報の Vercel 関数の本体は scripts/lib/scrapeJobs/preRaceHandlers.js（api/cron/exhibition.js・race-info.js は薄い入口）
  const handlers = read("scripts/lib/scrapeJobs/preRaceHandlers.js");
  check(
    "preRaceHandlers.js: mainRefresh は有効なときだけ動的 import する（無効なときは同じモジュール読み込み）。展示の従来の経路（runLegacyExhibition）は消した（scraping-load-budget spec の P0）",
    !/runLegacyExhibition\(/.test(handlers) &&
      /await import\("\.\.\/\.\.\/daily\/generate-predictions\.js"\)/.test(
        handlers,
      ) &&
      !/^import .*generate-predictions/m.test(handlers),
  );
  check(
    "preRaceHandlers.js: レース情報・展示のスロットの経路は、全スロットの完了後に、変更を書いたレースについて refreshAfterChange を呼ぶ（スロットのリースの外）",
    /refreshAfterChange\(\{\s*result: \{ changedRaceIds/.test(handlers),
  );
  for (const file of ["exhibition", "race-info"]) {
    const entry = read(`api/cron/${file}.js`);
    check(
      `api/cron/${file}.js: 本体は preRaceHandlers.js（mainRefresh を静的 import しない）`,
      /scripts\/lib\/scrapeJobs\/preRaceHandlers\.js/.test(entry) &&
        !/generate-predictions/.test(entry.replace(/\/\*[\s\S]*?\*\//g, "")),
    );
  }
}

// ---- 後半の場面（verifyData/prediction-refresh-scenes-3.js） ----
await runPredictionRefreshScenes4({ mainRefresh, check, show, raceTables, NOW, quiet });

if (failures > 0) {
  console.error(`\n❌ ${failures}件の検証に失敗`);
  process.exit(1);
}
console.log("\n✅ 全ての検証に成功");
