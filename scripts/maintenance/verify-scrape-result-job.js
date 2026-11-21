/**
 * verify-scrape-result-job.js - 結果取得（A6）・Kファイル同期・結果のcatch-upの Vercel Cron 実装（WS4b、
 * tasks.md T4b-02・T4b-05）の検証。DBにも取得先にも接続しない（Supabaseクライアント・fetch・時計・ストアを差し替える）。
 *
 * 確認すること:
 *   (a) 解析・行の組み立て・result_digest: 実際の結果ページ（フィクスチャ）から、期待どおりの行・ダイジェストができる。
 *       result_at・DBの余分な列・スタート情報の並び順に依存しない。値が1つ違えばダイジェストも違う。未公開は null
 *   (b) runForRaces（レース単位の入口）: live は書き込む・完了済みは取得しない、shadow は取得・解析のみで一切書かない、
 *       決まり手が未公開なら partial、未公開・解析不能は no_values、取得・書き込みの失敗は error、ブレーカーは breaker_open、
 *       1件の失敗で他のレースを止めない、並列度の上限
 *   (c) 共通ラッパ経由の result: off・行なし・075未適用は何も取得せず何も書かない、shadow はデータテーブルへ書かず
 *       予定表に digest を記録する、live は書き込む、onTick は live のときだけ・claim の前、リースを失っても壊れない
 *   (d) 中止・順延の確定: 発走+90分（レジストリの窓と一致）・日付またぎの窓・結果のあるレースは確定しない・
 *       読み取り失敗は書かない・onTick の失敗は500だがスロットの処理は続ける
 *   (e) Kファイル同期: 同じ日のKファイルを1回だけダウンロード（D4）・未同期が無ければダウンロードしない・
 *       shadow（dryRun）は書かない・未公開は incomplete・失敗・0件はエラー
 *   (f) catch-up: expired（確定中止を除く）のみ再取得・live のみ確定と的中フラグの補完・未完了のスロットがあれば
 *       対象日を処理済みにしない（補足の起動がもう一度処理する）・0件エラー
 *   (g) 切り替えの仕組み: run() の skipResults・skipKFile（既定は従来どおり全て実行）、scrape-scheduled.js・
 *       ワークフローのリポジトリ変数（既定はfalse相当）
 *   (h) 設定の整合: レジストリ・maxDuration・vercel.json の cron（UTC→JST換算。最終レースの結果の許容幅が及ぶ 00:15 まで）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearCancellationsWithResults,
  clearCancellationsWithResultsInRange,
  run as runResultsLegacy,
} from "../daily/scrape-results.js";


import { addDays, parseRaceId } from "../lib/scrapeJobs/resultHandlers.js";


import { SCRAPE_JOBS, validateRegistry } from "../lib/scrapeJobs/registry.js";


import { cronWiring } from "./verifyData/cronWiring.js";
import { checkScheduledResults } from "./verifyData/scrape-scheduled-scenes.js";
import { supabase as moduleSupabase } from "../lib/supabaseClient.js";
import { createFakeDb } from "./verifyData/scrape-result-job-fake-db.js";
import { DATE, runScrapeResultJobScenesB3 } from "./verifyData/scrape-result-job-scenes-b-2.js";
import { runScrapeResultJobScenesB1, runScrapeResultJobScenesB2 } from "./verifyData/scrape-result-job-scenes-b-1.js";
import { runScrapeResultJobScenesB4 } from "./verifyData/scrape-result-job-scenes-b-3.js";
import {
  runScrapeResultJobScenesB5,
  runScrapeResultJobScenesB6,
  runScrapeResultJobScenesB7,
} from "./verifyData/scrape-result-job-scenes-b-4.js";
import { runScrapeResultJobScenesB8 } from "./verifyData/scrape-result-job-scenes-b-5.js";
import { runScrapeResultJobScenesB9, runScrapeResultJobScenesB10 } from "./verifyData/scrape-result-job-scenes-b-6.js";
import { runScrapeResultJobScenesB11 } from "./verifyData/scrape-result-job-scenes-b-7.js";

// 検証対象のコードが出す警告・エラー・進捗のログで出力が埋まらないよう、検証中は無効にし、結果の表示だけ元の関数で行う
const printOut = console.log.bind(console);
const printErr = console.error.bind(console);
console.log = () => {};
console.warn = () => {};
console.error = () => {};
// scrapeAndSaveResults 系の進捗表示（process.stdout.write）は、この検証では呼ばない

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    printOut(`✅ ${label}`);
  } else {
    failures++;
    printErr(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);
const same = (a, b) => show(a) === show(b);

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const FIX = (name) =>
  fs.readFileSync(
    new URL(`../lib/__fixtures__/raceresult/${name}`, import.meta.url),
    "utf8",
  );
const HTML_A = FIX("raceresult-2026-09-19-05-01.html"); // 桐生1R（決まり手・ST・払戻あり）
const HTML_B = FIX("raceresult-2026-09-19-17-12.html"); // 宮島12R
const HTML_NONE = FIX("raceresult-unpublished-2026-09-25-05-01.html"); // 未公開（着順テーブルなし）
// 本当の中止（2026-09-21 江戸川1R。公式の結果ページは「レース中止」の表示だけで、着順が無い。BOA-526）
const HTML_CANCELLED = FIX("raceresult-cancelled-2026-09-21-03-01.html");
const HTML_PARTIAL = HTML_A.replaceAll("決まり手", "決まりX");

// ---- 後半の場面（verifyData/scrape-result-job-scenes-b-1.js） ----
runScrapeResultJobScenesB1({ check, show, same, HTML_A, HTML_B, HTML_NONE, HTML_PARTIAL });
const URL_TO_HTML = (url) =>
  url.includes("rno=1&jcd=05&hd=20260919")
    ? HTML_A
    : url.includes("rno=12&jcd=17&hd=20260919")
      ? HTML_B
      : HTML_NONE;

// ---- 後半の場面（verifyData/scrape-result-job-scenes-b-1.js・scrape-result-job-scenes-b-2.js・scrape-result-job-scenes-b-3.js・scrape-result-job-scenes-b-4.js） ----
runScrapeResultJobScenesB2({ check, show, same, HTML_A, HTML_B, HTML_NONE, HTML_PARTIAL, URL_TO_HTML });
await runScrapeResultJobScenesB3({ check, show, same, HTML_NONE, HTML_PARTIAL });
await runScrapeResultJobScenesB4({ check, show, same, HTML_A, HTML_NONE, HTML_PARTIAL, URL_TO_HTML });
await runScrapeResultJobScenesB5({ check, show, same });
{
  // clearCancellationsWithResults（BOA-524）: 結果があるのに中止・順延（暫定・確定）が付いたレースを解除する。
  // 2026-09-12 は、結果が先に入り、確定が後から付いた（結果の書き込みの時点では解除できない）
  const mk = (extra = {}) =>
    createFakeDb(
      {
        race_results: [
          { race_id: "R1" },
          { race_id: "R3" },
          { race_id: "R4" },
          { race_id: "R6" },
        ],
        races: [
          // 確定・結果あり（誤り）
          {
            race_id: "R1",
            race_date: "2026-09-12",
            cancellation_status: "confirmed",
            cancellation_check_streak: 0,
          },
          // 確定・結果なし（本物の中止）
          {
            race_id: "R2",
            race_date: "2026-09-12",
            cancellation_status: "confirmed",
            cancellation_check_streak: 0,
          },
          // 暫定・結果あり
          {
            race_id: "R3",
            race_date: "2026-09-12",
            cancellation_status: "tentative",
            cancellation_check_streak: 2,
          },
          // 中止でない・結果あり
          {
            race_id: "R4",
            race_date: "2026-09-12",
            cancellation_status: null,
            cancellation_check_streak: 0,
          },
          // 期間の外（2026-08-01）の確定・結果なし
          {
            race_id: "R5",
            race_date: "2026-08-01",
            cancellation_status: "confirmed",
            cancellation_check_streak: 0,
          },
          // 期間の外の確定・結果あり（範囲の検索では触らない）
          {
            race_id: "R6",
            race_date: "2026-08-01",
            cancellation_status: "confirmed",
            cancellation_check_streak: 0,
          },
        ],
      },
      extra,
    );
  const statusOf = (db, id) => db.tables.races.find((x) => x.race_id === id);
  const db = mk();
  const r = await clearCancellationsWithResults(db, ["R1", "R2", "R3", "R4"]);
  check(
    "解除（BOA-524）: 結果のある確定（R1）・暫定（R3）だけを NULL・streak 0 に戻す。結果の無い確定（R2）と、中止でないレース（R4）は触らない",
    same(r.cleared.sort(), ["R1", "R3"]) &&
      statusOf(db, "R1").cancellation_status === null &&
      statusOf(db, "R3").cancellation_status === null &&
      statusOf(db, "R3").cancellation_check_streak === 0 &&
      statusOf(db, "R2").cancellation_status === "confirmed",
    show(r),
  );
  for (const table of ["race_results", "races"]) {
    const bad = mk({ readError: { [table]: "接続断" } });
    let err = null;
    try {
      await clearCancellationsWithResults(bad, ["R1", "R2"]);
    } catch (e) {
      err = e;
    }
    check(
      `解除: ${table} の読み取りに失敗したら例外・書き込みなし（読めなかった集合を空とみなさない。BOA-512 の反転の再発防止）`,
      err && new RegExp(table).test(err.message) && bad.writes.length === 0,
    );
  }
  const none = mk();
  const rn = await clearCancellationsWithResults(none, []);
  check(
    "解除: 対象0件は読み書きしない",
    rn.cleared.length === 0 &&
      none.reads.length === 0 &&
      none.writes.length === 0,
  );
  const dbR = mk();
  const rr = await clearCancellationsWithResultsInRange(dbR, {
    from: "2026-09-10",
    to: "2026-09-12",
  });
  check(
    "範囲の解除: 期間（両端含む）の中止・順延の付いたレースだけを調べ、結果のあるもの（R1・R3）を解除する。期間の外（R6）は触らない",
    same(rr.cleared.sort(), ["R1", "R3"]) &&
      statusOf(dbR, "R6").cancellation_status === "confirmed" &&
      statusOf(dbR, "R2").cancellation_status === "confirmed",
    show(rr),
  );
  const badR = mk({ readError: { races: "接続断" } });
  let errR = null;
  try {
    await clearCancellationsWithResultsInRange(badR, {
      from: "2026-09-10",
      to: "2026-09-12",
    });
  } catch (e) {
    errR = e;
  }
  check(
    "範囲の解除: 対象レースの読み取りに失敗したら例外・書き込みなし",
    errR && badR.writes.length === 0,
  );
}

// ---- 後半の場面（verifyData/scrape-result-job-scenes-b-4.js） ----
await runScrapeResultJobScenesB6({ check, show, same });

// ---------------------------------------------------------------------------
// (e) Kファイル同期
// ---------------------------------------------------------------------------
const K_TEXT = fs.readFileSync(
  new URL("../lib/__fixtures__/kfile/k260911.txt", import.meta.url),
  "utf8",
);

// ---- 後半の場面（verifyData/scrape-result-job-scenes-b-4.js・scrape-result-job-scenes-b-5.js・scrape-result-job-scenes-b-6.js） ----
await runScrapeResultJobScenesB7({ check, show, same, K_TEXT });
await runScrapeResultJobScenesB8({ check, show, same, K_TEXT });
await runScrapeResultJobScenesB9({ printOut, check, show, same, HTML_NONE, HTML_CANCELLED, URL_TO_HTML });

// ---------------------------------------------------------------------------
// (g) 切り替えの仕組み
// ---------------------------------------------------------------------------
{
  // scrape-scheduled.js の切り替えは、偽の取得のもとで main を回して見る（verifyData/scrape-scheduled-scenes.js）
  await checkScheduledResults({ check, show });
  const workflow = fs.readFileSync(
    path.join(ROOT, ".github/workflows/scrape-scheduled.yml"),
    "utf8",
  );
  check(
    "scrape-scheduled.yml: リポジトリ変数 SKIP_RESULTS_ON_GHA・SKIP_KFILE_ON_GHA を、オーケストレーターのステップに渡す（設定していなければ空＝従来どおり）",
    /SKIP_RESULTS_ON_GHA: \$\{\{ vars\.SKIP_RESULTS_ON_GHA \}\}/.test(
      workflow,
    ) &&
      /SKIP_KFILE_ON_GHA: \$\{\{ vars\.SKIP_KFILE_ON_GHA \}\}/.test(workflow) &&
      /SKIP_EXHIBITION_ON_GHA: \$\{\{ vars\.SKIP_EXHIBITION_ON_GHA \}\}/.test(
        workflow,
      ),
  );
  // run() の既定は「全て実行」。module の supabase が無い環境でだけ、呼び出しの有無で確認する
  if (moduleSupabase === null) {
    const outcome = async (opts) => {
      try {
        await runResultsLegacy([], DATE, opts);
        return "resolved";
      } catch {
        return "rejected";
      }
    };
    const both = await outcome({ skipResults: true, skipKFile: true });
    const kfileOnly = await outcome({ skipResults: true });
    const resultsOnly = await outcome({ skipKFile: true });
    const def = await outcome(undefined);
    check(
      "run(): 両方スキップは何もしない。Kファイルだけ動かす（DBが無いので失敗する＝呼んだ）。結果だけ動かす（対象0件で正常）。既定（引数なし）はKファイル同期も呼ぶ＝従来どおり",
      both === "resolved" &&
        kfileOnly === "rejected" &&
        resultsOnly === "resolved" &&
        def === "rejected",
      show({ both, kfileOnly, resultsOnly, def }),
    );
  } else {
    printOut(
      "SKIP: run() の既定の確認（この環境では Supabase が設定されているため、DBに触れる呼び出しを避ける）",
    );
  }
}

// ---------------------------------------------------------------------------
// (h) 設定の整合
// ---------------------------------------------------------------------------
{
  check(
    "レジストリの整合性の検査（validateRegistry）が空",
    validateRegistry().length === 0,
    show(validateRegistry()),
  );
  const vercel = JSON.parse(
    fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"),
  );
  const crons = vercel.crons ?? [];
  const expand = (field, max) => {
    const out = new Set();
    for (const part of field.split(",")) {
      const [range, step] = part.split("/");
      const [lo, hi] =
        range === "*"
          ? [0, max]
          : range.includes("-")
            ? range.split("-").map(Number)
            : [Number(range), step ? max : Number(range)];
      for (let v = lo; v <= hi; v += step ? Number(step) : 1) out.add(v);
    }
    return out;
  };
  // cron式（UTC）→ JSTの起動時刻（0:00からの分）の集合
  const jstTimes = (schedule) => {
    const [min, hour] = schedule.split(" ");
    const times = [];
    for (const h of expand(hour, 23))
      for (const m of expand(min, 59)) times.push(((h + 9) % 24) * 60 + m);
    return times.sort((a, b) => a - b);
  };
  const forPath = (p) =>
    crons.filter((c) => c.path === p).map((c) => c.schedule);

  const result = forPath("/api/cron/result");
  check(
    "vercel.json: /api/cron/result は1本",
    result.length === 1,
    show(result),
  );
  const rt = new Set(jstTimes(result[0]));
  const everyMinute = (from, to) => {
    for (let t = from; t <= to; t++) if (!rt.has(t % 1440)) return false;
    return true;
  };
  check(
    "result の cron: JST 07:00〜23:59 と 00:00〜00:59（翌）の毎分。最終レース（22:45発走）の結果の許容幅の終わり 00:15 を含む",
    everyMinute(7 * 60, 24 * 60 - 1) &&
      everyMinute(24 * 60, 24 * 60 + 59) &&
      !rt.has(6 * 60 + 59) &&
      !rt.has(60),
    `${rt.size}回`,
  );
  const lastRaceDeadlineEnd =
    22 * 60 +
    45 +
    SCRAPE_JOBS.result.offsets[0] +
    SCRAPE_JOBS.result.graceMin -
    24 * 60; // 翌分
  check(
    `最終レース（22:45発走）の結果スロットの期限+許容幅（翌 00:${String(lastRaceDeadlineEnd).padStart(2, "0")}）を、cron が超えて起動する（期限切れ処理・確定まで届く）`,
    lastRaceDeadlineEnd === 15 &&
      rt.has((24 * 60 + lastRaceDeadlineEnd + 1) % 1440),
  );
  check(
    "kfile-sync の cron: JST 07:00 と 12:00 の2回（本体と補足）",
    same(
      forPath("/api/cron/kfile-sync")
        .flatMap(jstTimes)
        .sort((a, b) => a - b),
      [7 * 60, 12 * 60],
    ),
    show(forPath("/api/cron/kfile-sync")),
  );
  check(
    "result-catchup の cron: JST 23:50 と 翌 00:30 の2回（最終レースの期限が翌00:15のため、補足を置く）",
    same(
      forPath("/api/cron/result-catchup")
        .flatMap(jstTimes)
        .sort((a, b) => a - b),
      [0 * 60 + 30, 23 * 60 + 50],
    ),
    show(forPath("/api/cron/result-catchup")),
  );
  const cronRe = /^(\S+ ){4}\S+$/;
  check(
    "vercel.json: 追加した cron のパスは api/cron/*.js として実在し、cron式が5フィールド",
    crons
      .filter((c) => /result|kfile/.test(c.path))
      .every(
        (c) =>
          fs.existsSync(path.join(ROOT, `${c.path.slice(1)}.js`)) &&
          cronRe.test(c.schedule),
      ),
  );
  for (const [file, job] of [
    ["result", "result"],
    ["kfile-sync", "kfile_sync"],
    ["result-catchup", "result_catchup"],
  ]) {
    // api の本文の字は読まず、export（config・default）と、共通ラッパへ渡した引数で見る
    const api = await cronWiring(() => import(`../../api/cron/${file}.js`));
    check(
      `api/cron/${file}.js: maxDuration(${api.config?.maxDuration}) がレジストリ(${job})の maxDurationSec(${SCRAPE_JOBS[job].maxDurationSec}) と一致し、共通ラッパを job='${job}' で1回通した戻りを default export にする`,
      api.config?.maxDuration === SCRAPE_JOBS[job].maxDurationSec &&
        api.made.length === 1 &&
        api.made[0].options.job === job &&
        api.handler === api.made[0].handler,
      show(api.made.map((w) => w.options.job)),
    );
  }
  // 認証: CRON_SECRET なし・誤りは401（取得もDBアクセスもしない）
  const mod = await import("../../api/cron/result.js");
  const respond = () => {
    const out = { status: null, body: null };
    return {
      out,
      res: {
        status(s) {
          out.status = s;
          return this;
        },
        json(b) {
          out.body = b;
          return this;
        },
      },
    };
  };
  process.env.CRON_SECRET = "secret-for-test";
  const noAuth = respond();
  await mod.default({ headers: {}, query: {} }, noAuth.res);
  const badAuth = respond();
  await mod.default(
    { headers: { authorization: "Bearer wrong-secret-x" }, query: {} },
    badAuth.res,
  );
  delete process.env.CRON_SECRET;
  check(
    "api/cron/result: Authorization なし・誤りは401",
    noAuth.out.status === 401 && badAuth.out.status === 401,
    show([noAuth.out, badAuth.out]),
  );
  check(
    "parseRaceId・addDays: race_id の形式・日付の加算（月またぎ）",
    same(parseRaceId("2026-09-19-05-01"), {
      race_id: "2026-09-19-05-01",
      date: "2026-09-19",
      venue_code: 5,
      race_number: 1,
    }) &&
      addDays("2026-09-02", -4) === "2026-08-29" &&
      (() => {
        try {
          parseRaceId("bad");
          return false;
        } catch {
          return true;
        }
      })(),
  );
}

// ---- 後半の場面（verifyData/scrape-result-job-scenes-b-6.js・scrape-result-job-scenes-b-7.js） ----
runScrapeResultJobScenesB10({ printOut, check, show, same, HTML_NONE, HTML_CANCELLED, URL_TO_HTML });
runScrapeResultJobScenesB11({ printOut, show });

printOut(
  failures === 0 ? "\nALL PASS" : `\n${failures} 件の検証が失敗しました`,
);
process.exit(failures === 0 ? 0 : 1);
