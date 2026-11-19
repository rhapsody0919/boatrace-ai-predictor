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
import {
  getTodayVenues,
  scrapeRacesData,
  scrapeVenue,
} from "../scrape-to-json.js";




import {
  FALLBACK_FROM_JST_HOUR,
  decideMorningInitOnGha,
} from "../lib/racesInit/ghaSkip.js";

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

// ---------------------------------------------------------------------------
// (a) scrape-to-json.js
// ---------------------------------------------------------------------------
{
  const fetchHtml = createFixtureFetch();
  const venues = await getTodayVenues(DATE, { fetchHtml, strict: true });
  check(
    "(a) 開催会場一覧: 旧実装の出力（golden）と一致",
    same(venues, GOLDEN_VENUES),
    show(venues),
  );

  const venue = await scrapeVenue(DATE, 1, { fetchHtml, strict: true });
  check(
    "(a) 1会場の出走表・直前情報・発走時刻: 旧実装の出力（golden）と完全に一致（strict）",
    same(venue, GOLDEN_VENUE),
  );
  const venueDefault = await scrapeVenue(DATE, 1, { fetchHtml });
  check(
    "(a) 既定（非 strict）でも、同じ出力（従来の GitHub Actions・CLI と同じ）",
    same(venueDefault, GOLDEN_VENUE),
  );
  check(
    "(a) 12レース・全レースに6艇・発走時刻あり",
    venue.races.length === 12 &&
      venue.races.every((r) => r.racers.length === 6 && r.startTime),
  );

  const data = await scrapeRacesData(DATE, [1], {
    fetchHtml,
    venueDelayMs: 0,
  });
  check(
    "(a) scrapeRacesData: races.json と同じ形（success・date・data・scrapedAt）をメモリ上で返す",
    data.success === true &&
      data.date === DATE &&
      data.data.length === 1 &&
      same(data.data[0], GOLDEN_VENUE) &&
      typeof data.scrapedAt === "string",
  );

  // 非 strict: 取得の失敗は、従来どおり null・空に化ける
  const failVenues = await getTodayVenues(DATE, {
    fetchHtml: createFixtureFetch({ fail: () => true }),
  });
  check(
    "(a) 非 strict: 会場一覧の取得失敗は [] に化ける（従来どおり）",
    same(failVenues, []),
  );
  const racelist3Fails = await scrapeVenue(DATE, 1, {
    fetchHtml: createFixtureFetch({
      fail: (u) => u.includes("racelist") && u.includes("rno=3"),
    }),
  });
  check(
    "(a) 非 strict: racelist の失敗は、そのレースの選手が空になるだけ（従来どおり）",
    racelist3Fails.races.length === 12 &&
      racelist3Fails.races[2].racers.length === 0 &&
      racelist3Fails.races[3].racers.length === 6,
  );
  const beforeinfoFails = await scrapeVenue(DATE, 1, {
    fetchHtml: createFixtureFetch({
      fail: (u) => u.includes("beforeinfo"),
    }),
  });
  check(
    "(a) 非 strict: beforeinfo が取れなくても、全レースがそろう（beforeinfo は取らない。BOA-1145）",
    same(beforeinfoFails, GOLDEN_VENUE),
  );

  // strict: 失敗は例外
  const e1 = await rejects(
    getTodayVenues(DATE, {
      fetchHtml: createFixtureFetch({ fail: () => true }),
      strict: true,
    }),
  );
  check(
    "(a) strict: 会場一覧の取得失敗は例外（開催なしに化けない）",
    e1 && /開催会場一覧の取得に失敗/.test(e1.message),
    e1?.message,
  );
  const e2 = await rejects(
    scrapeVenue(DATE, 1, {
      fetchHtml: createFixtureFetch({
        fail: (u) => u.includes("racelist") && u.includes("rno=3"),
      }),
      strict: true,
    }),
  );
  check(
    "(a) strict: racelist が1ページでも失敗したら、会場全体が例外（一部欠けたまま書かない）",
    e2 && /会場1/.test(e2.message),
    e2?.message,
  );
  const beforeinfoLog = createFixtureFetch({
    fail: (u) => u.includes("beforeinfo"),
  });
  const e3 = await rejects(
    scrapeVenue(DATE, 1, { fetchHtml: beforeinfoLog, strict: true }),
  );
  check(
    "(a) strict: beforeinfo が全て失敗しても、会場は例外にならない（beforeinfo を取りに行かない。BOA-1145）",
    e3 === null && !beforeinfoLog.log.some((u) => u.includes("beforeinfo")),
    e3?.message,
  );
  const e4 = await rejects(
    scrapeVenue(DATE, 1, {
      fetchHtml: createFixtureFetch({
        fail: (u) => u.includes("raceindex"),
      }),
      strict: true,
    }),
  );
  check(
    "(a) strict: 発走時刻のページが失敗したら例外",
    e4 && /発走時刻の取得に失敗/.test(e4.message),
    e4?.message,
  );
  const noTimesFetch = async (url) =>
    String(url).includes("raceindex")
      ? "<html><body><table><tr><td>-</td></tr></table></body></html>"
      : createFixtureFetch()(url);
  const e5 = await rejects(
    scrapeVenue(DATE, 1, { fetchHtml: noTimesFetch, strict: true }),
  );
  check(
    "(a) strict: 発走時刻が1件も読めなければ例外（start_time が NULL のまま書かない）",
    e5 && /発走時刻を1件も取得できません/.test(e5.message),
    e5?.message,
  );

  // 並列度の上限
  const limited = createFixtureFetch({ latencyMs: 8 });
  await scrapeVenue(DATE, 1, { fetchHtml: limited, raceConcurrency: 3 });
  check(
    "(a) raceConcurrency=3: 同時リクエストは最大3（3レース×racelist。beforeinfo は取らない）",
    limited.maxActive <= 3 && limited.maxActive >= 2,
    `maxActive=${limited.maxActive}`,
  );
  const unlimited = createFixtureFetch({ latencyMs: 8 });
  await scrapeVenue(DATE, 1, { fetchHtml: unlimited });
  check(
    "(a) 既定（12レース同時）: 12リクエスト（racelist）が同時に走る",
    unlimited.maxActive === 12,
    `maxActive=${unlimited.maxActive}`,
  );
}

// ---- 後半の場面（verifyData/morning-init-refactor-scenes-1.js・morning-init-refactor-scenes-2.js・morning-init-refactor-scenes-3.js） ----
await runMorningInitRefactorScenes1({ FIXED_NOW, check, show, rejects, GOLDEN_VENUE, DATE });
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
