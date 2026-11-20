/**
 * verify-morning-init-refactor.js - 朝の初期化・公式予想の「取得・生成・書き込み」を、ファイル・execSync・process.exit に
 * 依存しない関数に分けた変更（WS4b T4b-07-1〜3・T4b-08-1）の検証。
 * DBにも取得先にも接続しない（インメモリのSupabaseクライアント・保存済みの実ページ・fetch の差し替え）。
 *
 * 確認すること:
 *   (a) scrape-to-json.js: 分けた後の scrapeVenue・getTodayVenues が、分ける前の実装（旧 main() の取得部分）の出力と
 *       完全に一致する（実ページ4件のfixtureから、旧実装で作った golden との比較）。ただし直前情報（beforeinfo）は
 *       取らなくなったため（BOA-1145）、golden の直前情報の欄（気象・展示）は null に置き換えて比べる。既定（非 strict）は、取得の失敗を従来どおり
 *       null・空に化かし、strict は例外にする。並列度の上限が効く
 *   (b) generate-predictions.js: generateAndWriteFromRacesData が、races・race_entries・predictions・race_conditions を書き、
 *       2回目は変更の無い行を書かない。throwOnError のとき、書き込みの失敗を例外にする（既定は従来どおり握りつぶす）
 *   (c) generate-unified-predictions.js: import しても main() が走らない。generateUnifiedPredictions が unified を upsert し、
 *       失敗は例外。findRacesMissingUnified が、欠けたレースだけを返す。strict のとき、DBの読み取り失敗を「対象なし」にしない
 *   (d) scrape-pcexpect.js: import しても main() が走らない。実ページの解析結果が、本番DBの payload と同じダイジェストになる。
 *       runForRaces: shadow は書かない・live は race_start_at つきで upsert・未公開は no_values・失敗・ブレーカーの扱い
 *   (e) morning-init.js: SKIP_MORNING_INIT_ON_GHA=true で何もせず終了する（既定は従来どおり）。フェイルセーフとして、
 *       JST 07:00 を過ぎても当日の races が無い（または確認できない）なら初期化するが、GitHub の肩代わりの条件
 *       （ghaSkipGate の races_init: mode=live・Vercel が起動していない・ブレーカーが閉じている・直近の失敗が 403・
 *       接続の失敗でない）を満たすときだけ。確かめられなければ初期化しない（P0。素の fetch で公式を回り込まない）
 *
 * 実行: node scripts/maintenance/verify-morning-init-refactor.js
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { generateAndWriteFromRacesData } from "../daily/generate-predictions.js";



import {
  FALLBACK_FROM_JST_HOUR,
  decideMorningInitOnGha,
} from "../lib/racesInit/ghaSkip.js";
import { createFakeSupabaseClient } from "../lib/scrapeJobs/testing/fakeSupabaseClient.js";
import { runMorningInitRefactorScenes1 } from "./verifyData/morning-init-refactor-scenes-1.js";
import { runMorningInitRefactorScenes2 } from "./verifyData/morning-init-refactor-scenes-2.js";
import {
  runMorningInitRefactorScenes3,
  runMorningInitRefactorScenes4,
} from "./verifyData/morning-init-refactor-scenes-3.js";

// 検証の対象コードが出すログは捨て、結果の行だけを出す
// 発走済みのレースは書かない（BOA-628）ため、対象日の朝に固定する（2026-09-20・21 の発走前）
const FIXED_NOW = new Date("2026-09-20T06:00:00+09:00");
const out = { log: console.log, error: console.error };
console.log = console.warn = console.error = () => {};

// 検証の対象コードが、途中で process.exit(0) して、最後まで実行されないまま「成功」に見えるのを防ぐ
// （import 時に main() が走る不具合の検出。scrape-pcexpect.js の main() は、空のスケジュールで exit(0) する）
let completed = false;
process.on("exit", (code) => {
  if (!completed && code === 0) {
    out.error(
      "❌ 検証が最後まで実行されませんでした（途中で process.exit された）",
    );
    process.exitCode = 1;
  }
});

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) out.log(`✅ ${label}`);
  else {
    failures++;
    out.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);
const same = (a, b) => show(a) === show(b);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function rejects(promise) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

const FX = new URL("../lib/racesInit/__fixtures__/", import.meta.url);
const fixture = (name) => fs.readFileSync(new URL(name, FX), "utf8");
const readJson = (name) => JSON.parse(fixture(name));
// 直前情報（beforeinfo）の欄を null にした golden（BOA-1145。scrapeVenue は beforeinfo を取らない）。
// 旧 golden の値は、朝の実ページで全て空（weather "", windDirection 0, 他 null）で、予想・書き込みの結果は同じ
const GOLDEN_VENUE = (() => {
  const g = readJson("golden-venue-01.json");
  return {
    ...g,
    races: g.races.map((r) => ({
      ...r,
      weather: null,
      airTemp: null,
      windDirection: null,
      windVelocity: null,
      waterTemp: null,
      waveHeight: null,
      exhibitionData: null,
    })),
  };
})();
const GOLDEN_VENUES = readJson("golden-venues-2026-09-21.json");
const DATE = "2026-09-21";

/** URL に応じて、保存済みの実ページを返す fetchHtml（呼び出しの記録と、同時実行数の最大値つき） */
function createFixtureFetch({ fail = () => false, latencyMs = 2 } = {}) {
  const log = [];
  let active = 0;
  let maxActive = 0;
  const pages = [
    ["/race/raceindex", fixture("raceindex-01.html")],
    ["/race/racelist", fixture("racelist-01-05.html")],
    ["/race/beforeinfo", fixture("beforeinfo-01-05.html")],
    ["/race/index", fixture("index-2026-09-21.html")],
  ];
  async function fetchHtml(url) {
    log.push(String(url));
    active++;
    maxActive = Math.max(maxActive, active);
    try {
      await sleep(latencyMs);
      const failure = fail(String(url));
      if (failure) throw new Error(failure === true ? "HTTP 503" : failure);
      const page = pages.find(([p]) => String(url).includes(p));
      if (!page) throw new Error(`未対応のURL: ${url}`);
      return page[1];
    } finally {
      active--;
    }
  }
  fetchHtml.log = log;
  Object.defineProperty(fetchHtml, "maxActive", { get: () => maxActive });
  return fetchHtml;
}

// ---- 後半の場面（verifyData/morning-init-refactor-scenes-1.js） ----
await runMorningInitRefactorScenes1({ check, show, same, rejects, GOLDEN_VENUE, GOLDEN_VENUES, DATE, createFixtureFetch });

// ---------------------------------------------------------------------------
// (b) generate-predictions.js
// ---------------------------------------------------------------------------
{
  const racesData = () => ({
    success: true,
    data: [structuredClone(GOLDEN_VENUE)],
  });
  const newClient = (opts = {}) =>
    createFakeSupabaseClient({
      tables: {
        venues: [{ code: 1, avg_first_win_rate: 0.5 }],
        racer_aggregated_stats: [],
        ...opts.tables,
      },
      failOn: opts.failOn,
    });

  const client = newClient();
  const result = await generateAndWriteFromRacesData({
    now: () => FIXED_NOW,
    racesData: racesData(),
    date: DATE,
    client,
    throwOnError: true,
  });
  const raceIds = client.data.races.map((r) => r.race_id).sort();
  check(
    "(b) 12レース分の races・race_entries（72行）・predictions（36行）を書く",
    result.predictedRaceIds.length === 12 &&
      client.data.races.length === 12 &&
      client.data.race_entries.length === 72 &&
      client.data.predictions.length === 36 &&
      raceIds[0] === "2026-09-21-01-01" &&
      raceIds[11] === "2026-09-21-01-12",
    `races=${client.data.races.length} entries=${client.data.race_entries?.length} preds=${client.data.predictions?.length}`,
  );
  check(
    "(b) races.start_time は HH:MM:00・race_date は指定した対象日",
    client.data.races.every(
      (r) => /^\d{2}:\d{2}:00$/.test(r.start_time) && r.race_date === DATE,
    ),
  );
  check(
    "(b) race_conditions に、レース名・開催ステージを書く（BOA-347）",
    client.data.race_conditions.length === 12 &&
      client.data.race_conditions.every((r) => r.race_title || r.race_stage),
  );
  // BOA-590: F数・L数を朝の初期化で書く（レース情報の窓＝発走60分前まで NULL にしない）
  const fl = client.data.race_entries.filter(
    (e) => e.race_id === "2026-09-21-01-01",
  );
  check(
    "(b) BOA-590: race_entries に F数・L数を書く（5号艇 F1、ほかは F0・L0）",
    fl.length === 6 &&
      fl.find((e) => e.boat_number === 5)?.f_count === 1 &&
      fl.filter((e) => e.boat_number !== 5).every((e) => e.f_count === 0) &&
      fl.every((e) => e.l_count === 0),
    show(fl.map((e) => [e.boat_number, e.f_count, e.l_count])),
  );
  {
    // F数・L数が読めなかった艇は、列を送らない（既存の値を NULL で上書きしない）
    const noFl = racesData();
    for (const r of noFl.data[0].races)
      for (const x of r.racers) {
        delete x.fCount;
        delete x.lCount;
      }
    const c2 = newClient();
    await generateAndWriteFromRacesData({
      now: () => FIXED_NOW,
      racesData: noFl,
      date: DATE,
      client: c2,
      throwOnError: true,
    });
    // 偽クライアントは送られた行をそのまま保存する（新しい行なので、送らなかった列は行に無い）
    const sent = c2.data.race_entries;
    check(
      "(b) BOA-590: F数・L数が読めなかった艇は、f_count・l_count の列を送らない",
      sent.length > 0 &&
        sent.every((r) => !("f_count" in r) && !("l_count" in r)),
      show(sent.slice(0, 1)),
    );
  }
  const racesUpserts = client.writesTo("races").length;
  const entriesUpserts = client.writesTo("race_entries").length;
  await generateAndWriteFromRacesData({
    now: () => FIXED_NOW,
    racesData: racesData(),
    date: DATE,
    client,
    throwOnError: true,
  });
  check(
    "(b) 2回目: 変更の無い races・race_entries は書かない（WS8(b)）。predictions は upsert で36行のまま、削除しない（BOA-628）",
    client.writesTo("races").length === racesUpserts &&
      client.writesTo("race_entries").length === entriesUpserts &&
      client.data.predictions.length === 36 &&
      client.writesTo("predictions").filter((w) => w.op === "delete").length ===
        0,
  );

  // 失敗の扱い
  const failing = (failOn) => newClient({ failOn });
  for (const [label, failOn] of [
    ["race_entries の書き込み", { "race_entries:upsert": "boom-entries" }],
    ["races の書き込み", { "races:upsert": "boom-races" }],
    ["predictions の書き込み", { "predictions:upsert": "boom-preds" }],
  ]) {
    const err = await rejects(
      generateAndWriteFromRacesData({
        now: () => FIXED_NOW,
        racesData: racesData(),
        date: DATE,
        client: failing(failOn),
        throwOnError: true,
      }),
    );
    check(`(b) throwOnError: ${label}の失敗は例外`, err !== null, err?.message);
    const swallowed = await rejects(
      generateAndWriteFromRacesData({
        now: () => FIXED_NOW,
        racesData: racesData(),
        date: DATE,
        client: failing(failOn),
        throwOnError: false,
      }),
    );
    check(
      `(b) throwOnError: false（CLI が指定）: ${label}の失敗は握りつぶして続行（morning-init の後続を止めない）`,
      swallowed === null,
      swallowed?.message,
    );
    const byDefault = await rejects(
      generateAndWriteFromRacesData({
        now: () => FIXED_NOW,
        racesData: racesData(),
        date: DATE,
        client: failing(failOn),
      }),
    );
    check(
      `(b) 既定（BOA-391）: ${label}の失敗は例外`,
      byDefault !== null,
      byDefault?.message,
    );
  }
  const noClient = await rejects(
    generateAndWriteFromRacesData({
      now: () => FIXED_NOW,
      racesData: racesData(),
      date: DATE,
      client: null,
      throwOnError: true,
    }),
  );
  check(
    "(b) throwOnError: Supabase が無ければ例外",
    noClient && /Supabase/.test(noClient.message),
  );
  const badData = await rejects(
    generateAndWriteFromRacesData({
      now: () => FIXED_NOW,
      racesData: { success: false },
      date: DATE,
      client: newClient(),
    }),
  );
  check("(b) 有効なデータが無ければ例外（従来どおり）", badData !== null);
}

// ---- 後半の場面（verifyData/morning-init-refactor-scenes-2.js・morning-init-refactor-scenes-3.js） ----
await runMorningInitRefactorScenes2({ FIXED_NOW, check, show, same, rejects, DATE });
await runMorningInitRefactorScenes3({ out, check, show, same, sleep, rejects, fixture, DATE });

// ---------------------------------------------------------------------------
// (e) morning-init.js の GitHub 側を止める変数（と、フェイルセーフ）
// ---------------------------------------------------------------------------
{
  // gateSkip=false（肩代わりの条件を満たす）を既定にして、時刻・件数の判定を見る
  const decide = (skipVar, jstHour, racesCount, gateSkip = false) =>
    decideMorningInitOnGha({ skipVar, jstHour, racesCount, gateSkip });
  check(
    "(e) 変数が true でない: 常に実行する（従来どおり。時刻・races の件数に依らない）",
    [0, 5, 7, 12].every(
      (h) => decide(false, h, 0).run && decide(false, h, 100).run,
    ),
  );
  check(
    "(e) true・JST 07:00 より前: 実行しない（Vercel の races-init の時間帯。DBの件数は見ない）",
    [0, 4, 5, 6].every(
      (h) => !decide(true, h, null).run && !decide(true, h, 0).run,
    ),
  );
  check(
    "(e) true・07:00 以降で races が1件以上: 実行しない（Vercel が初期化済み）",
    !decide(true, 7, 12).run &&
      !decide(true, 12, 1).run &&
      !decide(true, 23, 288).run,
  );
  check(
    "(e) true・07:00 以降で races が0件: 実行する（フェイルセーフ。Vercel が失敗した日に、誰も初期化しない状態を避ける）",
    decide(true, 7, 0).run && decide(true, 9, 0).run,
  );
  check(
    "(e) true・07:00 以降で件数を確認できない（DB未設定・読み取り失敗）: 実行する（止めない側に倒す）",
    decide(true, 8, null).run && decide(true, 8, undefined).run,
  );
  check(
    "(e) 再現（P0）: races が0件・確認できなくても、肩代わりの条件を満たさない（gateSkip=true）・まだ確かめていない（undefined）なら実行しない",
    !decide(true, 8, 0, true).run &&
      !decide(true, 8, null, true).run &&
      !decideMorningInitOnGha({ skipVar: true, jstHour: 8, racesCount: 0 })
        .run &&
      decideMorningInitOnGha({ skipVar: true, jstHour: 8, racesCount: 0 })
        .needsGate === true &&
      decide(true, 8, 0, true).needsGate === false &&
      decideMorningInitOnGha({ skipVar: true, jstHour: 8, racesCount: 12 })
        .needsGate === false &&
      decideMorningInitOnGha({ skipVar: true, jstHour: 6, racesCount: 0 })
        .needsGate === false,
  );
  check(
    "(e) フェイルセーフが働き始める時刻は JST 07:00（従来の初回の初期化と同じ）",
    FALLBACK_FROM_JST_HOUR === 7 &&
      !decide(true, 6, 0).run &&
      decide(true, 7, 0).run,
  );

  // 本番の資格情報が環境にあっても、DBに書かないよう、Supabase の変数は空にして起動する。
  // 削除ではなく空文字にするのが要点: 削除すると supabaseClient.js の dotenv が .env.local から
  // 本番の値を読み込む（dotenv は既にある変数を上書きしないので、空文字なら未設定のまま）
  const FAKE_NOW = fileURLToPath(
    new URL("../lib/scrapeJobs/testing/fakeNow.mjs", import.meta.url),
  );
  const spawn = (extra, nowIso) =>
    spawnSync(
      process.execPath,
      ["--import", FAKE_NOW, "scripts/daily/morning-init.js"],
      {
        cwd: new URL("../../", import.meta.url),
        env: {
          ...process.env,
          SUPABASE_URL: "",
          SUPABASE_SERVICE_KEY: "",
          VITE_SUPABASE_URL: "",
          VITE_SUPABASE_ANON_KEY: "",
          SKIP_MORNING_INIT_ON_GHA: "",
          SKIP_PCEXPECT_ON_GHA: "",
          FAKE_NOW_ISO: nowIso,
          ...extra,
        },
        encoding: "utf8",
        // 子プロセスの中身は1秒程度で終わるが、並行セッションで負荷が高い開発機では起動だけで
        // 30秒を超え、5件まとめて status=null で落ちた（2026-09-28）。上限は run-verify-registry.js の
        // 1本あたりの上限（180秒）より短くし、ハングしたときはこちらの失敗として理由を出す
        timeout: 150_000,
      },
    );
  // タイムアウト等で結果が出なかったとき、期待との食い違いと区別できるよう理由を出す
  const why = (r) =>
    r.error
      ? `子プロセスが完了しませんでした: ${r.error.code ?? r.error.message}`
      : `${r.status} ${r.stdout} ${r.stderr}`.slice(0, 300);
  const skipped = spawn(
    { SKIP_MORNING_INIT_ON_GHA: "true" },
    "2026-09-21T05:30:00+09:00",
  );
  check(
    "(e) SKIP_MORNING_INIT_ON_GHA=true・05:30 JST: 何もせず正常終了（Supabase が無くても）",
    skipped.status === 0 && /スキップ/.test(skipped.stdout),
    why(skipped),
  );
  const failsafe = spawn(
    { SKIP_MORNING_INIT_ON_GHA: "true" },
    "2026-09-21T07:30:00+09:00",
  );
  check(
    "(e) 再現（P0）: SKIP_MORNING_INIT_ON_GHA=true・07:30 JST で、races の件数も肩代わりの条件も確かめられない（Supabase 未設定）: 初期化せず正常終了（GitHub から公式を素の fetch で叩かない）",
    failsafe.status === 0 &&
      /スキップ/.test(failsafe.stdout) &&
      /no_takeover/.test(failsafe.stdout) &&
      !/フェイルセーフで初期化/.test(failsafe.stderr),
    why(failsafe),
  );
  const normal = spawn({}, "2026-09-21T05:30:00+09:00");
  check(
    "(e) 既定（変数なし）: 従来どおり動く（時刻に依らず。Supabase 未設定なら、そのエラーで異常終了）",
    normal.status === 1 && /Supabase環境変数が未設定/.test(normal.stderr),
    why(normal),
  );
  const falseVar = spawn(
    { SKIP_MORNING_INIT_ON_GHA: "false" },
    "2026-09-21T05:30:00+09:00",
  );
  check(
    "(e) SKIP_MORNING_INIT_ON_GHA=false: 従来どおり（止めない）",
    falseVar.status === 1 && /Supabase環境変数が未設定/.test(falseVar.stderr),
    why(falseVar),
  );
  const skipPc = spawn(
    { SKIP_PCEXPECT_ON_GHA: "true" },
    "2026-09-21T05:30:00+09:00",
  );
  check(
    "(e) SKIP_PCEXPECT_ON_GHA だけでは、朝の初期化そのものは止まらない（Supabase 未設定のエラーまで進む）",
    skipPc.status === 1 && /Supabase環境変数が未設定/.test(skipPc.stderr),
    why(skipPc),
  );
}

completed = true;
if (failures > 0) {
  out.error(`\n❌ ${failures}件の検証が失敗しました`);
  process.exit(1);
}

// ---- 後半の場面（verifyData/morning-init-refactor-scenes-3.js） ----
runMorningInitRefactorScenes4({ out, check, show, same, sleep, rejects, fixture, DATE });
