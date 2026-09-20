/**
 * verify-scrape-jobs.js - データ取得基盤の共通ライブラリ（scripts/lib/scrapeJobs/、WS4a）の検証。
 * DBにも取得先にも接続しない（ストア・fetch・時計を差し替える）。
 *
 * 確認すること:
 *   (a) 期限計算: 発走（JST）+ offset_min。実行環境のタイムゾーンに依存しない。不正な形式は例外
 *   (b) レジストリの整合性: リース < 許容幅、再試行の間隔 < 許容幅 等。ensure用の定義の形
 *   (c) resolveTargetDate: 指定時刻から対象日を解決（遅れて起動しても対象日は前日のまま）
 *   (d) 0件エラー: 期待件数>0なのに解析0件は成功にしない。書き込み0件（変更なし）は正常
 *   (e) 予定表・ジョブ状態のテーブル/関数が無い（072未適用）エラーの判定。無関係な不在は握りつぶさない
 *   (f) サーキットブレーカー: 開く条件・半開・閉じる・期間の倍増・store障害時の縮退
 *   (g) politeFetch: タイムアウト・429/503のバックオフ（Retry-After・上限）・ブレーカー連携・UA・並列度の上限
 *   (h) 共通ラッパ: 072未適用・off・行なしは何もしない（誤報なし）/ shadow・live / 完了と再試行の記録 /
 *       0件エラー / 例外の扱い / ブレーカー / ソフトデッドライン / 並列度 / 日次の冪等・リース・shadow
 *   (i) Supabaseストアのクエリの形: 完了・再試行はclaimed_byとstatus=runningの条件付き更新
 *   (j) getRaceSchedule の例外モード: DBエラーを「対象なし」に化けさせない
 *
 * 予定表のRPCの意味論（期限・許容幅・リース・奪取）は verify-scrape-slots-sql.js（PGlite）で検証する。
 */
import {
  toJstDateString,
  jstStartOfDay,
  raceStartInstant,
  slotDeadline,
  slotWindowEnd,
} from "../lib/scrapeJobs/time.js";
import {
  SCRAPE_JOBS,
  SOFT_DEADLINE_MARGIN_SEC,
  slotDefsFor,
  validateRegistry,
  windowJobNames,
} from "../lib/scrapeJobs/registry.js";
import { resolveTargetDate } from "../lib/scrapeJobs/dailyJob.js";
import {
  applyZeroRowGuard,
  computeRetryAt,
  isFinalOutcome,
  truncateError,
} from "../lib/scrapeJobs/outcomes.js";
import { isScrapeSchemaMissingError } from "../lib/scrapeJobs/schemaErrors.js";
import {
  BreakerOpenError,
  createCircuitBreaker,
} from "../lib/scrapeJobs/circuitBreaker.js";
import {
  DEFAULT_USER_AGENT,
  FetchError,
  createPoliteFetch,
  hostKeyOf,
  parseRetryAfterMs,
} from "../lib/scrapeJobs/politeFetch.js";
import {
  mapWithConcurrency,
  createSemaphore,
} from "../lib/scrapeJobs/concurrency.js";
import {
  isAuthorized,
  runScrapeJob,
  shouldEnsureSlots,
} from "../lib/scrapeJobs/cronWrapper.js";
import { createSupabaseStore } from "../lib/scrapeJobs/store.js";
import { createMemoryStore } from "../lib/scrapeJobs/testing/memoryStore.js";
import { getRaceSchedule } from "../lib/raceSchedule.js";

// 検証対象のコードが出す警告・エラーのログ（テストが意図的に起こす失敗）で出力が埋まらないよう、
// 検証中は console.warn・console.error を無効にし、結果の表示だけ元の関数で行う
const printOut = console.log.bind(console);
const printErr = console.error.bind(console);
console.warn = () => {};
console.error = () => {};

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    printOut(`✅ ${label}`);
  } else {
    failures++;
    printErr(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const show = (v) => JSON.stringify(v);

// ---------------------------------------------------------------------------
// (a) 期限計算（TZを切り替えても同じ）
// ---------------------------------------------------------------------------
const ORIGINAL_TZ = process.env.TZ;
for (const tz of ["UTC", "Asia/Tokyo", "America/Los_Angeles", "Asia/Kolkata"]) {
  process.env.TZ = tz;
  const d = slotDeadline("2026-09-19", "10:00:00", -60);
  check(
    `[TZ=${tz}] 10:00発走の60分前は 09:00 JST（= 00:00 UTC）`,
    d.toISOString() === "2026-09-19T00:00:00.000Z",
    d.toISOString(),
  );
  check(
    `[TZ=${tz}] 22:45発走の+90分は翌日 00:15 JST（= 15:15 UTC）`,
    slotDeadline("2026-09-19", "22:45", 90).toISOString() ===
      "2026-09-19T15:15:00.000Z",
  );
  check(
    `[TZ=${tz}] JST日付: 2026-09-19T15:00:00Z は 2026-09-20（JST 00:00）`,
    toJstDateString(new Date("2026-09-19T15:00:00Z")) === "2026-09-20" &&
      toJstDateString(new Date("2026-09-19T14:59:59Z")) === "2026-09-19",
  );
}
if (ORIGINAL_TZ === undefined) delete process.env.TZ;
else process.env.TZ = ORIGINAL_TZ;

check(
  "期限は HH:MM でも HH:MM:SS でも同じ",
  slotDeadline("2026-09-19", "10:00", 5).getTime() ===
    slotDeadline("2026-09-19", "10:00:00", 5).getTime(),
);
check(
  "期限+許容幅",
  slotWindowEnd(slotDeadline("2026-09-19", "10:00", -60), 3).toISOString() ===
    "2026-09-19T00:03:00.000Z",
);
check(
  "その日（JST）の0時",
  jstStartOfDay(new Date("2026-09-19T20:00:00Z")).toISOString() ===
    "2026-09-19T15:00:00.000Z",
);
for (const [date, time] of [
  ["2026/09/19", "10:00"],
  ["2026-09-19", "10時"],
  ["2026-09-19", null],
  [undefined, "10:00"],
]) {
  let threw = false;
  try {
    raceStartInstant(date, time);
  } catch {
    threw = true;
  }
  check(`不正な発走時刻は例外（${date} ${time}）`, threw);
}

// ---------------------------------------------------------------------------
// (b) レジストリ
// ---------------------------------------------------------------------------
check(
  "本番のレジストリは整合している",
  same(validateRegistry(), []),
  show(validateRegistry()),
);
{
  const bad = {
    a: { ...SCRAPE_JOBS.odds, leaseSec: 180 }, // 許容幅3分と同じ
    b: { ...SCRAPE_JOBS.odds, retrySec: 200 },
    c: { ...SCRAPE_JOBS.odds, offsets: [-60, -60] },
    d: { ...SCRAPE_JOBS.odds, concurrency: 99 },
    e: { ...SCRAPE_JOBS.point_rank, targetTimeJst: "25:00" },
    f: { ...SCRAPE_JOBS.odds, maxDurationSec: 30 },
    g: { ...SCRAPE_JOBS.odds, claimLimit: 60, concurrency: 4 }, // 15回×12秒 > リース
  };
  const problems = validateRegistry(bad);
  check(
    "リース>=許容幅・再試行>=許容幅・窓の重複・並列度超過・不正な指定時刻・短すぎるmaxDuration・リースに収まらない処理量を検出",
    ["a", "b", "c", "d", "e", "f", "g"].every((k) =>
      problems.some((p) => p.startsWith(`${k}:`)),
    ),
    show(problems),
  );
}
check(
  "窓型のジョブ名",
  same(windowJobNames().sort(), [
    "exhibition",
    "odds",
    "pcexpect",
    "race_info",
    "result",
  ]),
);
{
  const defs = slotDefsFor(["odds", "result"]);
  check(
    "ensure用の定義: oddsは6窓（許容幅3）、resultは1窓（許容幅85）",
    defs.length === 7 &&
      defs.filter((d) => d.job === "odds").every((d) => d.grace_min === 3) &&
      defs.find((d) => d.job === "result").offset_min === 5 &&
      defs.find((d) => d.job === "result").grace_min === 85,
    show(defs),
  );
  let threw = false;
  try {
    slotDefsFor(["point_rank"]);
  } catch {
    threw = true;
  }
  check("窓型ではないジョブの ensure 定義は例外", threw);
}
check(
  `ソフトデッドラインの余白は ${SOFT_DEADLINE_MARGIN_SEC}秒`,
  SOFT_DEADLINE_MARGIN_SEC === 30,
);

// ---------------------------------------------------------------------------
// (c) resolveTargetDate
// ---------------------------------------------------------------------------
{
  const jst = (date, hhmm) => new Date(`${date}T${hhmm}:00+09:00`);
  const cases = [
    // [now(JST), 指定時刻, 期待する対象日, 説明]
    [jst("2026-09-18", "22:00"), "22:00", "2026-09-18", "指定時刻ちょうど"],
    [
      jst("2026-09-18", "22:30"),
      "22:00",
      "2026-09-18",
      "指定後の定刻に近い起動",
    ],
    [
      jst("2026-09-19", "01:51"),
      "22:00",
      "2026-09-18",
      "GitHub Actionsのように約4時間遅れて翌日に起動しても対象日は前日",
    ],
    [
      jst("2026-09-18", "21:59"),
      "22:00",
      "2026-09-17",
      "指定時刻の1分前は前日",
    ],
    [
      jst("2026-09-18", "23:41"),
      "20:00",
      "2026-09-18",
      "20:00指定が23:41に起動",
    ],
    [
      jst("2026-09-19", "00:21"),
      "20:00",
      "2026-09-18",
      "20:00指定が翌日00:21に起動（G2の0件）",
    ],
    [
      jst("2026-09-19", "08:04"),
      "06:00",
      "2026-09-19",
      "06:00指定が08:04に起動",
    ],
    [
      jst("2026-09-19", "02:07"),
      "23:10",
      "2026-09-18",
      "23:10指定が翌日02:07に起動",
    ],
    [jst("2026-10-01", "00:30"), "22:00", "2026-09-30", "月をまたぐ"],
  ];
  for (const [now, target, expected, label] of cases) {
    const got = resolveTargetDate(now, target);
    check(
      `resolveTargetDate: ${label}`,
      got === expected,
      `${got} != ${expected}`,
    );
  }
  for (const tz of ["UTC", "America/Los_Angeles"]) {
    process.env.TZ = tz;
    check(
      `resolveTargetDate [TZ=${tz}]: 翌01:51 JST の起動でも前日`,
      resolveTargetDate(jst("2026-09-19", "01:51"), "22:00") === "2026-09-18",
    );
  }
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
  let threw = false;
  try {
    resolveTargetDate(new Date(), "9:00");
  } catch {
    threw = true;
  }
  check("指定時刻が HH:MM でなければ例外", threw);
}

// ---------------------------------------------------------------------------
// (d) 0件エラー・outcome
// ---------------------------------------------------------------------------
check(
  "期待>0で解析0件の ok は error になる",
  applyZeroRowGuard({ outcome: "ok", rowsExpected: 6, rowsParsed: 0 })
    .outcome === "error",
);
check(
  "期待>0で解析>0（書き込み0件＝変更なし）の ok は ok のまま",
  applyZeroRowGuard({
    outcome: "ok",
    rowsExpected: 6,
    rowsParsed: 6,
    rowsWritten: 0,
  }).outcome === "ok",
);
check(
  "期待件数を返さない結果は判定しない",
  applyZeroRowGuard({ outcome: "ok", rowsParsed: 0 }).outcome === "ok",
);
check(
  "期待0（開催なしの日など）で解析0件は正常",
  applyZeroRowGuard({ outcome: "ok", rowsExpected: 0, rowsParsed: 0 })
    .outcome === "ok",
);
check(
  "ok以外（no_values等）はそのまま",
  applyZeroRowGuard({ outcome: "no_values", rowsExpected: 6, rowsParsed: 0 })
    .outcome === "no_values",
);
check(
  "完了として扱う outcome は ok・skipped_have_data のみ",
  isFinalOutcome("ok") &&
    isFinalOutcome("skipped_have_data") &&
    !isFinalOutcome("partial") &&
    !isFinalOutcome("no_values") &&
    !isFinalOutcome("error") &&
    !isFinalOutcome("breaker_open"),
);
check(
  "last_error は500字で切る",
  truncateError("x".repeat(1000)).length === 500 &&
    truncateError(new Error("boom")) === "boom" &&
    truncateError(null) === null,
);

// ---------------------------------------------------------------------------
// (e) スキーマ未適用エラーの判定
// ---------------------------------------------------------------------------
check(
  "PostgREST: テーブルが無い（PGRST205）",
  isScrapeSchemaMissingError({
    code: "PGRST205",
    message:
      "Could not find the table 'public.scrape_job_state' in the schema cache",
  }),
);
check(
  "PostgREST: 関数が無い（PGRST202）",
  isScrapeSchemaMissingError({
    code: "PGRST202",
    message:
      "Could not find the function public.claim_scrape_slots(p_job, p_limit) in the schema cache",
  }),
);
check(
  "PostgreSQL: relation/function does not exist（42P01・42883）",
  isScrapeSchemaMissingError({
    code: "42P01",
    message: 'relation "public.scrape_slots" does not exist',
  }) &&
    isScrapeSchemaMissingError({
      code: "42883",
      message: "function ensure_scrape_slots(date, jsonb) does not exist",
    }),
);
check(
  "無関係なテーブル・関数の不在は、予定表の未適用とみなさない",
  !isScrapeSchemaMissingError({
    code: "PGRST205",
    message: "Could not find the table 'public.races' in the schema cache",
  }) &&
    !isScrapeSchemaMissingError({
      code: "PGRST202",
      message:
        "Could not find the function public.get_today_races() in the schema cache",
    }),
);
check(
  "接続エラー・権限エラー・名前の部分一致は、予定表の未適用とみなさない",
  !isScrapeSchemaMissingError({
    code: "57014",
    message: "canceling statement (scrape_slots)",
  }) &&
    !isScrapeSchemaMissingError({
      code: "42P01",
      message: 'relation "my_scrape_slots_backup" does not exist',
    }) &&
    !isScrapeSchemaMissingError(null),
);

// ---------------------------------------------------------------------------
// (f) サーキットブレーカー
// ---------------------------------------------------------------------------
{
  const HOST = "host:boatrace.jp";
  const clock = { t: 1_000_000 };
  const storeLog = [];
  const store = {
    until: 0,
    async read() {
      return store.until;
    },
    async open(host, until, reason) {
      store.until = until;
      storeLog.push(["open", host, until, reason]);
    },
    async close(host) {
      store.until = 0;
      storeLog.push(["close", host]);
    },
  };
  const mk = (over = {}) =>
    createCircuitBreaker({ store, now: () => clock.t, ...over });
  const openError = async (breaker) => {
    try {
      await breaker.check(HOST);
      return null;
    } catch (e) {
      return e;
    }
  };

  let b = mk();
  await b.check(HOST);
  check("初期状態は閉じている（storeへの書き込みなし）", storeLog.length === 0);

  // 連続3件で開く
  await b.recordFailure(HOST, "HTTP 429");
  await b.recordFailure(HOST, "HTTP 503");
  check("連続2件ではまだ開かない", (await openError(b)) === null);
  await b.recordFailure(HOST, "HTTP 429");
  const e1 = await openError(b);
  check(
    "連続3件の 429/503 で開く（60秒）",
    e1 instanceof BreakerOpenError && e1.until === clock.t + 60_000,
    String(e1?.until),
  );
  check(
    "開いたことがDBに記録される",
    storeLog.length === 1 &&
      storeLog[0][0] === "open" &&
      storeLog[0][1] === HOST,
  );

  // 別プロセス（新しいbreaker）にも、DBの状態で共有される
  const other = mk({ readTtlMs: 0 });
  check(
    "別プロセスのブレーカーも、DBの状態で開いている扱い",
    (await openError(other)) instanceof BreakerOpenError,
  );

  // 半開: 期限後、1件だけ試行できる
  clock.t += 60_001;
  await b.check(HOST); // 試行を予約
  const e2 = await openError(b);
  check(
    "半開中の2件目は、まだ開いている扱い（試行は1件だけ）",
    e2 instanceof BreakerOpenError,
  );
  // 試行が成功 → 閉じる
  await b.recordSuccess(HOST);
  check(
    "半開の試行が成功すると閉じる（DBも解除）",
    (await openError(b)) === null && storeLog.at(-1)[0] === "close",
  );

  // 半開の試行が失敗 → 期間が2倍
  b = mk();
  store.until = 0;
  for (let i = 0; i < 3; i++) await b.recordFailure(HOST);
  clock.t += 60_001;
  await b.check(HOST);
  await b.recordFailure(HOST);
  const e3 = await openError(b);
  check(
    "半開の試行が失敗すると開く期間が2倍（120秒）",
    e3 instanceof BreakerOpenError && e3.until === clock.t + 120_000,
    String(e3?.until - clock.t),
  );

  // 直近2分に5件（連続ではない）で開く
  b = mk();
  store.until = 0;
  for (let i = 0; i < 4; i++) {
    await b.recordFailure(HOST);
    if (i < 2) await b.recordSuccess(HOST); // 連続を切る
  }
  // 上のループで連続は最大2。5件目
  const beforeOpen = await openError(b);
  await b.recordFailure(HOST);
  await b.recordSuccess(HOST);
  await b.recordFailure(HOST);
  // 直近2分に 4+1+... 件。閾値5に達している
  check(
    "連続でなくても、直近2分に5件の 429/503 で開く",
    beforeOpen === null && (await openError(b)) instanceof BreakerOpenError,
  );

  // 2分より古い失敗は数えない
  b = mk();
  store.until = 0;
  for (let i = 0; i < 2; i++) {
    await b.recordFailure(HOST);
    await b.recordSuccess(HOST);
  }
  clock.t += 121_000;
  for (let i = 0; i < 2; i++) {
    await b.recordFailure(HOST);
    await b.recordSuccess(HOST);
  }
  check("2分より古い失敗は数えない", (await openError(b)) === null);

  // 試行が終わらなかった（ネットワークエラー）場合、印を外して再試行できる
  b = mk();
  store.until = 0;
  for (let i = 0; i < 3; i++) await b.recordFailure(HOST);
  clock.t += 60_001;
  await b.check(HOST);
  b.abortProbe(HOST);
  check(
    "試行がネットワークエラーで終わったら、次の呼び出しが再び試行できる",
    (await openError(b)) === null,
  );

  // storeが壊れていても、プロセス内の状態で縮退して動く
  const broken = createCircuitBreaker({
    now: () => clock.t,
    store: {
      async read() {
        throw new Error("db down");
      },
      async open() {
        throw new Error("db down");
      },
      async close() {
        throw new Error("db down");
      },
    },
    readTtlMs: 0,
  });
  await broken.check(HOST);
  for (let i = 0; i < 3; i++) await broken.recordFailure(HOST);
  check(
    "storeのエラーでは例外を投げず、プロセス内の状態で開く",
    (await openError(broken)) instanceof BreakerOpenError,
  );
}

// ---------------------------------------------------------------------------
// (g) politeFetch
// ---------------------------------------------------------------------------
{
  const mkResponse = (status, body = "<html></html>", headers = {}) =>
    new Response(status === 204 ? null : body, { status, headers });
  const noSleep = () => Promise.resolve();

  // 正常
  {
    const calls = [];
    const f = createPoliteFetch({
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return mkResponse(200, "ok-body");
      },
      sleep: noSleep,
    });
    const res = await f(
      "https://www.boatrace.jp/owpc/pc/race/raceresult?rno=1",
    );
    check(
      "正常: 本文を読み込み済みの Response を返し、UAを付ける",
      res.status === 200 &&
        (await res.text()) === "ok-body" &&
        calls[0].init.headers.get("user-agent") === DEFAULT_USER_AGENT &&
        calls[0].init.signal instanceof AbortSignal,
    );
    const custom = createPoliteFetch({
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return mkResponse(200);
      },
    });
    await custom("https://www.boatrace.jp/", {
      headers: { "User-Agent": "X/1" },
    });
    check(
      "UAを指定した場合はそれを使う",
      calls.at(-1).init.headers.get("user-agent") === "X/1",
    );
  }

  // 429 → 200
  {
    const sleeps = [];
    let n = 0;
    const f = createPoliteFetch({
      fetchImpl: async () => (n++ < 1 ? mkResponse(429) : mkResponse(200)),
      sleep: async (ms) => void sleeps.push(ms),
      random: () => 0,
    });
    const res = await f("https://www.boatrace.jp/a");
    check(
      "429 を1回受けてから成功: 1秒待って再試行",
      res.status === 200 && n === 2 && same(sleeps, [1000]),
      show({ n, sleeps }),
    );
  }

  // 503が続く → 2回まで再試行して503を返す（指数）
  {
    const sleeps = [];
    let n = 0;
    const f = createPoliteFetch({
      fetchImpl: async () => (n++, mkResponse(503)),
      sleep: async (ms) => void sleeps.push(ms),
      random: () => 0,
    });
    const res = await f("https://www.boatrace.jp/a");
    check(
      "503 が続く: 最大2回再試行（1秒→2秒）し、503のまま返す",
      res.status === 503 && n === 3 && same(sleeps, [1000, 2000]),
      show({ n, sleeps }),
    );
  }

  // Retry-After
  {
    const sleeps = [];
    let n = 0;
    const f = createPoliteFetch({
      fetchImpl: async () =>
        n++ === 0
          ? mkResponse(429, "x", { "retry-after": "4" })
          : n === 2
            ? mkResponse(429, "x", { "retry-after": "120" })
            : mkResponse(200),
      sleep: async (ms) => void sleeps.push(ms),
      random: () => 0,
    });
    await f("https://www.boatrace.jp/a");
    check(
      "Retry-After を尊重する（4秒）。長すぎる値は10秒で頭打ち",
      same(sleeps, [4000, 10000]),
      show(sleeps),
    );
    check(
      "Retry-After の解釈（秒・HTTP日付・不正値）",
      parseRetryAfterMs("3") === 3000 &&
        parseRetryAfterMs(
          "Sun, 20 Sep 2026 00:00:10 GMT",
          Date.parse("2026-09-20T00:00:00Z"),
        ) === 10000 &&
        parseRetryAfterMs("abc") === null &&
        parseRetryAfterMs(null) === null,
    );
  }

  // 404など: 再試行せずそのまま返す
  {
    let n = 0;
    const f = createPoliteFetch({
      fetchImpl: async () => (n++, mkResponse(404, "nf")),
      sleep: noSleep,
    });
    const res = await f("https://www.boatrace.jp/a");
    check("404 は再試行せずそのまま返す", res.status === 404 && n === 1);
  }

  // タイムアウト（ヘッダーが来ない・本文が止まる）
  {
    const f = createPoliteFetch({
      timeoutMs: 20,
      maxRetries: 1,
      sleep: noSleep,
      fetchImpl: (url, init) =>
        new Promise((_, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    });
    let err;
    try {
      await f("https://www.boatrace.jp/a");
    } catch (e) {
      err = e;
    }
    check(
      "タイムアウト: 再試行して、上限で FetchError（2回試行）",
      err instanceof FetchError && err.attempts === 2,
      String(err?.message),
    );

    const stallingBody = createPoliteFetch({
      timeoutMs: 20,
      maxRetries: 0,
      sleep: noSleep,
      fetchImpl: async (url, init) => ({
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        url,
        arrayBuffer: () =>
          new Promise((_, reject) => {
            init.signal.addEventListener("abort", () =>
              reject(
                Object.assign(new Error("aborted"), { name: "AbortError" }),
              ),
            );
          }),
      }),
    });
    let err2;
    try {
      await stallingBody("https://www.boatrace.jp/a");
    } catch (e) {
      err2 = e;
    }
    check(
      "本文の読み取りが止まってもタイムアウトする",
      err2 instanceof FetchError,
      String(err2?.message),
    );
  }

  // ネットワークエラー → 再試行して成功
  {
    let n = 0;
    const f = createPoliteFetch({
      sleep: noSleep,
      fetchImpl: async () => {
        if (n++ === 0) throw new TypeError("fetch failed");
        return mkResponse(200);
      },
    });
    check(
      "ネットワークエラーは再試行する",
      (await f("https://www.boatrace.jp/a")).status === 200 && n === 2,
    );
  }

  // 呼び出し側の signal を尊重する
  {
    const controller = new AbortController();
    controller.abort();
    let sawAborted = 0;
    const f = createPoliteFetch({
      maxRetries: 0,
      sleep: noSleep,
      fetchImpl: (url, init) =>
        new Promise((_, reject) => {
          if (init.signal.aborted) sawAborted++;
          init.signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
          if (init.signal.aborted) {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          }
        }),
    });
    let err;
    try {
      await f("https://www.boatrace.jp/a", { signal: controller.signal });
    } catch (e) {
      err = e;
    }
    check(
      "呼び出し側の init.signal が中断済みなら、取得を中断する（signal を上書きして無視しない）",
      err instanceof FetchError && sawAborted === 1,
      String(err?.message),
    );
  }

  // ブレーカー連携: 連続3件の429で開き、以降は取得しない
  {
    const clock = { t: 5_000_000 };
    const breaker = createCircuitBreaker({ now: () => clock.t });
    let fetched = 0;
    let fetchOk = false;
    const f = createPoliteFetch({
      breaker,
      sleep: noSleep,
      fetchImpl: async () => (fetched++, mkResponse(fetchOk ? 200 : 429)),
    });
    const res = await f("https://www.boatrace.jp/a"); // 3回試行して429、3件目でブレーカーが開く
    check(
      "429が3件続くとブレーカーが開く",
      res.status === 429 &&
        fetched === 3 &&
        breaker.snapshot(hostKeyOf("https://www.boatrace.jp/")).openUntil >
          clock.t,
    );
    let err;
    try {
      await f("https://www.boatrace.jp/b");
    } catch (e) {
      err = e;
    }
    check(
      "ブレーカーが開いている間は、取得せず BreakerOpenError",
      err instanceof BreakerOpenError && fetched === 3,
      String(err),
    );
    // 60秒後（半開）に、取得が成功すればブレーカーが閉じる
    clock.t += 60_001;
    fetchOk = true;
    const probe = await f("https://www.boatrace.jp/c");
    check(
      "半開の取得が成功するとブレーカーが閉じ、以降は通常どおり取得できる",
      probe.status === 200 &&
        breaker.snapshot(hostKeyOf("https://www.boatrace.jp/")).openUntil ===
          0 &&
        (await f("https://www.boatrace.jp/d")).status === 200,
    );
    check(
      "www・www1 等は同じホストのキー",
      hostKeyOf("https://www.boatrace.jp/x") === "host:boatrace.jp" &&
        hostKeyOf("https://www1.mbrace.or.jp/od2/K/") === "host:mbrace.or.jp",
    );
  }

  // 並列度の上限
  {
    let active = 0;
    let peak = 0;
    const f = createPoliteFetch({
      maxConcurrent: 3,
      sleep: noSleep,
      fetchImpl: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return mkResponse(200);
      },
    });
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => f(`https://www.boatrace.jp/${i}`)),
    );
    check(
      `politeFetch の同時実行数は上限（3）を超えない（最大${peak}）`,
      peak === 3,
    );

    let active2 = 0;
    let peak2 = 0;
    await mapWithConcurrency(
      Array.from({ length: 10 }, (_, i) => i),
      4,
      async () => {
        active2++;
        peak2 = Math.max(peak2, active2);
        await new Promise((r) => setTimeout(r, 3));
        active2--;
      },
    );
    check(
      `mapWithConcurrency の並列度は上限（4）を超えない（最大${peak2}）`,
      peak2 === 4,
    );
    const order = await mapWithConcurrency([30, 1, 10], 3, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    check("mapWithConcurrency の結果は入力と同じ順序", same(order, [0, 1, 2]));
    const sem = createSemaphore(1);
    check("セマフォは初期状態で0", sem.active === 0);
  }
}

// ---------------------------------------------------------------------------
// (h) 共通ラッパ
// ---------------------------------------------------------------------------
{
  const T0 = new Date("2026-09-19T00:00:00Z"); // 09:00 JST
  const mkClock = (start = T0) => {
    const c = { t: start.getTime() };
    return { c, now: () => new Date(c.t) };
  };
  const slot = (raceId, offset = -60) => ({
    job: "odds",
    race_id: raceId,
    offset_min: offset,
    attempts: 1,
    // claim した時刻（RPCが返す last_attempt_at）。再試行の間隔の起点
    last_attempt_at: T0.toISOString(),
  });
  const run = (store, opts = {}) => {
    const clock = opts.clock ?? mkClock();
    return runScrapeJob({
      job: opts.job ?? "odds",
      store,
      handleSlot: opts.handleSlot,
      run: opts.run,
      now: clock.now,
      worker: "w-test",
      modeGated: opts.modeGated ?? true,
      politeFetch: opts.politeFetch ?? (async () => new Response("")),
    });
  };
  const noWrites = (store) =>
    !store.calls.some((c) =>
      [
        "touchTick",
        "claimSlots",
        "ensureSlots",
        "acquireLease",
        "recordSuccess",
        "recordFailure",
      ].includes(c.name),
    );

  // 認証
  check(
    "認証: 正しいBearerのみ許可（未設定・不一致・長さ違いは拒否）",
    isAuthorized("Bearer s3cret", "s3cret") &&
      !isAuthorized("Bearer wrong!", "s3cret") &&
      !isAuthorized("Bearer s3cre", "s3cret") &&
      !isAuthorized("Bearer s3cret", undefined) &&
      !isAuthorized(undefined, "s3cret"),
  );

  // 072未適用
  {
    const store = createMemoryStore({ available: false });
    const r = await run(store, { handleSlot: async () => ({ outcome: "ok" }) });
    check(
      "072未適用（テーブルが無い）: 何もせず200（skipped）。書き込み・claimなし",
      r.status === 200 &&
        r.body.skipped === "scrape_schema_not_applied" &&
        noWrites(store),
      show(r),
    );
  }

  // 行なし → 作成して skipped
  {
    const store = createMemoryStore();
    const r = await run(store, { handleSlot: async () => ({ outcome: "ok" }) });
    check(
      "ジョブ状態の行が無い: mode=off の行を作り、何もせず200",
      r.status === 200 &&
        r.body.skipped === "mode_off" &&
        store.state.get("odds").mode === "off" &&
        noWrites(store),
      show(r),
    );
  }

  // off
  {
    const store = createMemoryStore({
      rows: { odds: { job: "odds", mode: "off" } },
    });
    const r = await run(store, { handleSlot: async () => ({ outcome: "ok" }) });
    check(
      "mode=off: 何もしない（tick・claimも書かない）",
      r.status === 200 && r.body.skipped === "mode_off" && noWrites(store),
    );
  }

  // 監視系（ゲートなし）は、行が無くても実行し、行を作って死活を記録する
  {
    const store = createMemoryStore();
    let ran = 0;
    const r = await run(store, {
      job: "scrape-monitor",
      modeGated: false,
      run: async () => {
        ran++;
        return { rowsWritten: 0 };
      },
    });
    check(
      "ゲートなし（監視）: 行が無くても実行し、行を作り、tickと成功を記録する",
      r.status === 200 &&
        ran === 1 &&
        store.state.get("scrape-monitor").last_tick_at &&
        store.state.get("scrape-monitor").last_success_at,
      show(r),
    );
  }

  // shadow・live: claim → ハンドラー → 完了/再試行
  for (const mode of ["shadow", "live"]) {
    const clock = mkClock();
    const store = createMemoryStore({
      rows: { odds: { job: "odds", mode, consecutive_failures: 2 } },
      slots: [
        slot("2026-09-19-01-01"),
        slot("2026-09-19-01-02"),
        slot("2026-09-19-01-03"),
        slot("2026-09-19-01-04"),
        slot("2026-09-19-01-05"),
      ],
    });
    const seen = [];
    const r = await run(store, {
      clock,
      handleSlot: async (s, ctx) => {
        seen.push({ id: s.race_id, mode: ctx.mode });
        switch (s.race_id.slice(-2)) {
          case "01":
            return {
              outcome: "ok",
              rowsWritten: 1,
              rowsParsed: 1,
              rowsExpected: 1,
              resultDigest: "abc",
            };
          case "02":
            return { outcome: "skipped_have_data" };
          case "03":
            return { outcome: "no_values" };
          case "04":
            throw new Error("解析エラー");
          default:
            return { outcome: "ok", rowsExpected: 5, rowsParsed: 0 }; // 0件エラー
        }
      },
    });
    const claimCall = store.calls.find((c) => c.name === "claimSlots");
    check(
      `[${mode}] claim にモードを渡し、ハンドラーに ctx.mode を渡す`,
      claimCall.mode === mode &&
        seen.length === 5 &&
        seen.every((s) => s.mode === mode),
    );
    check(
      `[${mode}] ok・skipped_have_data は完了として記録（結果のダイジェスト・行数付き）`,
      store.completed.length === 2 &&
        store.completed[0].outcome === "ok" &&
        store.completed[0].resultDigest === "abc" &&
        store.completed[0].rowsWritten === 1 &&
        store.completed[1].outcome === "skipped_have_data" &&
        store.completed.every((c) => c.worker === "w-test"),
    );
    const retryById = Object.fromEntries(
      store.retried.map((x) => [x.slot.race_id.slice(-2), x]),
    );
    check(
      `[${mode}] no_values は再試行（claim から50秒後。60秒−ジッター10秒）。outcome を残す`,
      retryById["03"]?.outcome === "no_values" &&
        retryById["03"].retryAt.getTime() === clock.c.t + 50_000,
    );
    check(
      `[${mode}] ハンドラーの例外は error として再試行に回し、他のスロットを止めない`,
      retryById["04"]?.outcome === "error" &&
        /解析エラー/.test(retryById["04"].error),
    );
    check(
      `[${mode}] 期待>0で解析0件は、ok でも error にして再試行（0件を成功にしない）`,
      retryById["05"]?.outcome === "error" && /0件/.test(retryById["05"].error),
    );
    check(
      `[${mode}] 一部が error でも他が成功なら、実行は成功（200）。成功を記録し、連続失敗を戻す`,
      r.status === 200 &&
        r.body.claimed === 5 &&
        same(r.body.outcomes, {
          ok: 1,
          skipped_have_data: 1,
          no_values: 1,
          error: 2,
        }) &&
        store.state.get("odds").consecutive_failures === 0,
      show(r.body),
    );
  }

  // 全スロットがerror → 500・連続失敗+1・成功を記録しない
  {
    const store = createMemoryStore({
      rows: { odds: { job: "odds", mode: "live", consecutive_failures: 1 } },
      slots: [slot("2026-09-19-01-01"), slot("2026-09-19-01-02")],
    });
    const r = await run(store, {
      handleSlot: async () => {
        throw new Error("取得先が落ちている");
      },
    });
    check(
      "処理した全スロットが error: HTTP 500、連続失敗を+1、last_error を残す",
      r.status === 500 &&
        r.body.success === false &&
        store.state.get("odds").consecutive_failures === 2 &&
        /取得先が落ちている/.test(store.state.get("odds").last_error) &&
        !store.calls.some((c) => c.name === "recordSuccess"),
      show(r),
    );
  }

  // 何も期限が来ていない tick: 書き込みは tick のみ（成功も記録しない）
  {
    const store = createMemoryStore({
      rows: { odds: { job: "odds", mode: "live" } },
    });
    const r = await run(store, { handleSlot: async () => ({ outcome: "ok" }) });
    check(
      "期限が来たスロットが無い tick: 200。記録は tick のみ（recordSuccess を毎分書かない）",
      r.status === 200 &&
        r.body.claimed === 0 &&
        store.calls.some((c) => c.name === "touchTick") &&
        !store.calls.some(
          (c) => c.name === "recordSuccess" || c.name === "completeSlot",
        ),
      show(r),
    );
  }

  // ブレーカー
  {
    // 事前にブレーカーが開いている → スロットを取らない
    const clock = mkClock();
    const store = createMemoryStore({
      rows: { odds: { job: "odds", mode: "live" } },
      slots: [slot("2026-09-19-01-01")],
    });
    store.breakerStore.until = clock.c.t + 30_000;
    const r = await run(store, {
      clock,
      handleSlot: async () => ({ outcome: "ok" }),
    });
    check(
      "取得先のブレーカーが開いている: スロットを取らず（claimなし）200 で skipped",
      r.status === 200 &&
        r.body.skipped === "breaker_open" &&
        !store.calls.some((c) => c.name === "claimSlots"),
      show(r),
    );
  }
  {
    // 実行中にブレーカーが開く: breaker_open として、開く期限まで再試行を遅らせる
    const clock = mkClock();
    const store = createMemoryStore({
      rows: { odds: { job: "odds", mode: "live" } },
      slots: [slot("2026-09-19-01-01")],
    });
    const until = clock.c.t + 90_000;
    const r = await run(store, {
      clock,
      handleSlot: async () => {
        throw new BreakerOpenError("host:boatrace.jp", until);
      },
    });
    check(
      "実行中にブレーカーが開いた: outcome=breaker_open。再試行はブレーカーの期限まで遅らせる。失敗には数えない",
      store.retried.length === 1 &&
        store.retried[0].outcome === "breaker_open" &&
        store.retried[0].retryAt.getTime() === until &&
        r.status === 200,
      show(store.retried),
    );
  }

  // ソフトデッドライン: 超えていたら着手せず pending に戻す（並列度1にして、逐次で確認する）
  {
    const clock = mkClock();
    const seq = { ...SCRAPE_JOBS.odds, concurrency: 1 };
    const store = createMemoryStore({
      rows: { odds: { job: "odds", mode: "live" } },
      slots: [
        slot("2026-09-19-01-01"),
        slot("2026-09-19-01-02"),
        slot("2026-09-19-01-03"),
      ],
    });
    const handled = [];
    const r = await runScrapeJob({
      job: "odds",
      definition: seq,
      store,
      now: clock.now,
      worker: "w-test",
      politeFetch: async () => new Response(""),
      handleSlot: async (s) => {
        handled.push(s.race_id);
        clock.c.t += 271_000;
        return { outcome: "ok", rowsWritten: 1 };
      },
    });
    check(
      "ソフトデッドライン（maxDuration−30秒）を超えたら、新しいスロットに着手せず pending に戻す（試行回数も戻す）",
      handled.length === 1 &&
        store.completed.length === 1 &&
        store.retried.length === 2 &&
        store.retried.every(
          (x) =>
            x.retryAt.getTime() === clock.c.t && !x.outcome && x.releaseAttempt,
        ) &&
        r.body.outcomes.deferred === 2,
      show({ handled, retried: store.retried.length, body: r.body }),
    );
  }

  // 並列度の上限（レジストリの concurrency）
  {
    const clock = mkClock();
    const slots = Array.from({ length: 12 }, (_, i) =>
      slot(`2026-09-19-01-${String(i + 1).padStart(2, "0")}`),
    );
    const store = createMemoryStore({
      rows: { odds: { job: "odds", mode: "live" } },
      slots,
    });
    let active = 0;
    let peak = 0;
    await run(store, {
      clock,
      handleSlot: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 3));
        active--;
        return { outcome: "ok" };
      },
    });
    check(
      `スロットの並列度はレジストリの値（${SCRAPE_JOBS.odds.concurrency}）を超えない（最大${peak}）`,
      peak === SCRAPE_JOBS.odds.concurrency,
    );
  }

  // 再試行の起点: ハンドラーの完了時刻ではなく、claim の時刻
  {
    const clock = mkClock();
    const store = createMemoryStore({
      rows: { odds: { job: "odds", mode: "live" } },
      slots: [slot("2026-09-19-01-01")],
    });
    await run(store, {
      clock,
      handleSlot: async () => {
        clock.c.t += 12_000; // 1件約10秒の取得
        return { outcome: "no_values" };
      },
    });
    const at = store.retried[0].retryAt.getTime();
    check(
      "再試行の間隔は、ハンドラーの完了(claim+12秒)ではなく claim を起点にする（60秒−10秒=claim+50秒。完了から数えると+72秒になり、毎分のCronの次の起動(+60秒)を1回飛ばす）",
      at === T0.getTime() + 50_000 && at < T0.getTime() + 60_000,
      String(at - T0.getTime()),
    );
    const slow = createMemoryStore({
      rows: { odds: { job: "odds", mode: "live" } },
      slots: [slot("2026-09-19-01-02")],
    });
    const clock2 = mkClock();
    await run(slow, {
      clock: clock2,
      handleSlot: async () => {
        clock2.c.t += 70_000;
        return { outcome: "no_values" };
      },
    });
    check(
      "処理が再試行の間隔より長くかかった場合は、現在時刻（即時に再試行できる）",
      slow.retried[0].retryAt.getTime() === clock2.c.t,
    );
    check(
      "computeRetryAt: claim時刻が無い・不正なら現在時刻を起点にする",
      computeRetryAt({ now: T0, claimedAt: null, retrySec: 60 }).getTime() ===
        T0.getTime() + 50_000 &&
        computeRetryAt({ now: T0, claimedAt: "invalid", retrySec: 60 }).getTime() ===
          T0.getTime() + 50_000 &&
        computeRetryAt({ now: T0, claimedAt: T0, retrySec: 5 }).getTime() ===
          T0.getTime(),
    );
  }

  // リース切れ間近のスロットには着手しない（二重取得を避ける）
  {
    const clock = mkClock();
    const soon = (sec) => ({
      ...slot("2026-09-19-01-0" + sec),
      lease_until: new Date(T0.getTime() + sec * 1000).toISOString(),
    });
    const store = createMemoryStore({
      rows: { odds: { job: "odds", mode: "live" } },
      // oddsの slotSecEstimate は12秒。リースの残りが 5秒・11秒 のスロットは、完了前に切れる見込み
      slots: [soon(5), soon(11), soon(100)],
    });
    const handled = [];
    const r = await run(store, {
      clock,
      handleSlot: async (s) => {
        handled.push(s.race_id);
        return { outcome: "ok" };
      },
    });
    check(
      "リースの残りが1スロットの見積り(12秒)より短いスロットには着手せず、試行回数を戻して pending に戻す",
      same(handled, ["2026-09-19-01-0100"]) &&
        store.retried.length === 2 &&
        store.retried.every((x) => x.releaseAttempt === true) &&
        r.body.outcomes.deferred === 2,
      show({ handled, outcomes: r.body.outcomes }),
    );
  }

  // ハンドラーが不正な値を返しても、他のスロットの記録を止めない
  {
    const store = createMemoryStore({
      rows: { odds: { job: "odds", mode: "live" } },
      slots: [
        slot("2026-09-19-01-01"),
        slot("2026-09-19-01-02"),
        slot("2026-09-19-01-03"),
        slot("2026-09-19-01-04"),
      ],
    });
    const r = await run(store, {
      handleSlot: async (s) => {
        if (s.race_id.endsWith("01")) return undefined;
        if (s.race_id.endsWith("02")) return "ok";
        if (s.race_id.endsWith("04")) return {}; // outcome が無い
        return { outcome: "ok" };
      },
    });
    check(
      "ハンドラーが undefined・文字列・outcome の無いオブジェクトを返しても、error として記録し、他のスロットの完了を記録する（全スロットが running のまま残らない）",
      store.completed.length === 1 &&
        store.retried.length === 3 &&
        store.retried.every((x) => x.outcome === "error") &&
        r.body.claimed === 4,
      show(r.body),
    );
  }

  // 日次: リース取得後の再確認
  {
    const store = createMemoryStore({
      rows: { point_rank: { job: "point_rank", mode: "live" } },
    });
    let reads = 0;
    const original = store.readState;
    store.readState = async (job) => {
      reads++;
      const r = await original(job);
      // 2回目の読み取り（リース取得後）では、別の実行が完了させた状態にする
      if (reads >= 2) r.row = { ...r.row, last_target_date: "2026-09-19" };
      return r;
    };
    let called = 0;
    const r = await run(store, {
      job: "point_rank",
      clock: mkClock(new Date("2026-09-19T13:30:00Z")),
      run: async () => {
        called++;
        return {};
      },
    });
    check(
      "日次: リース取得後の再確認で、別の実行が対象日を完了済みなら実行しない（リースは解放する）",
      called === 0 &&
        r.body.skipped === "already_done" &&
        store.calls.some((c) => c.name === "releaseLease"),
      show(r.body),
    );
  }

  // 予定表の生成の頻度
  {
    const at = (iso) => new Date(iso);
    check(
      "予定表の生成: 10分に1回（分が10の倍数のとき）",
      shouldEnsureSlots(at("2026-09-19T00:10:30Z"), "2026-09-19T00:05:00Z") &&
        !shouldEnsureSlots(at("2026-09-19T00:11:30Z"), "2026-09-19T00:10:00Z"),
    );
    check(
      "予定表の生成: その日の最初の起動・ジョブを日中に有効化した直後（last_tick_atが無い/前日）は、分に関わらず生成",
      shouldEnsureSlots(at("2026-09-19T00:03:00Z"), null) &&
        shouldEnsureSlots(at("2026-09-19T00:03:00Z"), "2026-09-18T14:00:00Z") &&
        !shouldEnsureSlots(at("2026-09-19T00:03:00Z"), "2026-09-19T00:00:00Z"),
    );
  }

  // 日次ジョブ
  {
    const clock = mkClock(new Date("2026-09-18T16:51:00Z")); // 9/19 01:51 JST（22:00指定が遅れて起動）
    const store = createMemoryStore({
      rows: { point_rank: { job: "point_rank", mode: "live" } },
    });
    let target;
    const r = await run(store, {
      job: "point_rank",
      clock,
      run: async (ctx) => {
        target = ctx.targetDate;
        return { rowsWritten: 10, rowsParsed: 10, rowsExpected: 10 };
      },
    });
    check(
      "日次（22:00指定）が翌01:51に起動しても、対象日は前日。成功で last_target_date を記録し、リースを解放する",
      target === "2026-09-18" &&
        store.state.get("point_rank").last_target_date === "2026-09-18" &&
        store.state.get("point_rank").claimed_by === null &&
        r.status === 200 &&
        r.body.targetDate === "2026-09-18",
      show({ target, r }),
    );
    // 補足の起動: 対象日が成功済みなら何もしない
    let calls = 0;
    const r2 = await run(store, {
      job: "point_rank",
      clock,
      run: async () => {
        calls++;
        return {};
      },
    });
    check(
      "補足の起動: 対象日が成功済みなら何もしない（冪等。リースも取らない）",
      r2.body.skipped === "already_done" &&
        calls === 0 &&
        store.calls.filter((c) => c.name === "acquireLease").length === 1,
      show(r2),
    );
    // 翌日の指定時刻を過ぎると、次の対象日を処理する
    clock.c.t = new Date("2026-09-19T13:30:00Z").getTime(); // 9/19 22:30 JST
    const r3 = await run(store, {
      job: "point_rank",
      clock,
      run: async (ctx) => {
        target = ctx.targetDate;
        return { rowsWritten: 5 };
      },
    });
    check(
      "次の指定時刻を過ぎたら、新しい対象日を処理する",
      r3.status === 200 && target === "2026-09-19",
    );
  }
  {
    const store = createMemoryStore({
      rows: { point_rank: { job: "point_rank", mode: "shadow" } },
    });
    await run(store, {
      job: "point_rank",
      clock: mkClock(new Date("2026-09-19T13:30:00Z")),
      run: async () => ({ rowsWritten: 0 }),
    });
    check(
      "日次の shadow は last_target_date を更新しない（live に切り替えた日の分を処理できるように）",
      !store.state.get("point_rank").last_target_date &&
        store.state.get("point_rank").last_success_at,
    );
  }
  {
    const store = createMemoryStore({
      rows: { point_rank: { job: "point_rank", mode: "live" } },
      leaseHeld: true,
    });
    let called = 0;
    const r = await run(store, {
      job: "point_rank",
      clock: mkClock(new Date("2026-09-19T13:30:00Z")),
      run: async () => {
        called++;
        return {};
      },
    });
    check(
      "リースを他の実行が持っていたら何もしない",
      r.body.skipped === "lease_held" &&
        called === 0 &&
        !store.calls.some((c) => c.name === "releaseLease"),
    );
  }
  {
    const store = createMemoryStore({
      rows: {
        point_rank: {
          job: "point_rank",
          mode: "live",
          consecutive_failures: 2,
        },
      },
    });
    const r = await run(store, {
      job: "point_rank",
      clock: mkClock(new Date("2026-09-19T13:30:00Z")),
      run: async () => ({ rowsExpected: 20, rowsParsed: 0, rowsWritten: 0 }),
    });
    check(
      "日次: 期待>0で解析0件は失敗（500）。対象日を済みにせず、連続失敗+1、リースを解放する",
      r.status === 500 &&
        !store.state.get("point_rank").last_target_date &&
        store.state.get("point_rank").consecutive_failures === 3 &&
        store.state.get("point_rank").claimed_by === null,
      show(r),
    );
    const r2 = await run(store, {
      job: "point_rank",
      clock: mkClock(new Date("2026-09-19T13:31:00Z")),
      run: async () => {
        throw new Error("取得先が落ちている");
      },
    });
    check(
      "日次: run() の例外は500、リースを必ず解放する",
      r2.status === 500 &&
        store.state.get("point_rank").claimed_by === null &&
        /取得先/.test(r2.body.error),
    );
  }

  // DB障害
  {
    const store = createMemoryStore({
      rows: { odds: { job: "odds", mode: "live" } },
    });
    store.readState = async () => {
      throw new Error(
        "ジョブ状態(odds)の読み取りに失敗しました: connection reset",
      );
    };
    const r = await run(store, { handleSlot: async () => ({ outcome: "ok" }) });
    check(
      "ジョブ状態の読み取りのDB障害は、skippedにせず500",
      r.status === 500 && /connection reset/.test(r.body.error),
    );
  }
  {
    const store = createMemoryStore({
      rows: { odds: { job: "odds", mode: "live" } },
      slots: [slot("2026-09-19-01-01")],
    });
    store.claimSlots = async () => {
      throw new Error(
        "スロットの取得(claim_scrape_slots, odds)に失敗しました: timeout",
      );
    };
    const r = await run(store, { handleSlot: async () => ({ outcome: "ok" }) });
    check(
      "claim のDBエラーは「対象なし」に化けさせず500。失敗を記録する",
      r.status === 500 && store.state.get("odds").consecutive_failures === 1,
      show(r),
    );
  }
  {
    const r = await runScrapeJob({
      job: "unknown_job",
      store: createMemoryStore(),
      breaker: createCircuitBreaker(),
      politeFetch: async () => new Response(""),
    });
    check("未登録のジョブは500", r.status === 500);
  }
}

// ---------------------------------------------------------------------------
// (i) Supabaseストアのクエリの形（記録用の偽クライアント）
// ---------------------------------------------------------------------------
{
  const log = [];
  const makeBuilder = (table, result) => {
    const b = {
      _table: table,
      _ops: [],
    };
    for (const m of ["select", "update", "upsert", "eq", "or", "match"]) {
      b[m] = (...args) => {
        b._ops.push([m, ...args]);
        return b;
      };
    }
    b.maybeSingle = () => {
      b._ops.push(["maybeSingle"]);
      log.push(b);
      return Promise.resolve(result(b));
    };
    b.then = (resolve, reject) => {
      log.push(b);
      return Promise.resolve(result(b)).then(resolve, reject);
    };
    return b;
  };
  let nextResult = () => ({ data: [{ race_id: "x" }], error: null });
  const rpcLog = [];
  const client = {
    from: (table) => makeBuilder(table, (b) => nextResult(b)),
    rpc: (name, args) => {
      rpcLog.push([name, args]);
      return Promise.resolve(nextResult());
    },
  };
  const store = createSupabaseStore(client);
  const now = new Date("2026-09-19T00:00:00.000Z");
  const opsOf = (b) => b._ops.map((o) => o.join(":")).join(" | ");

  // 完了: claimed_by と status=running の条件付き更新
  log.length = 0;
  const applied = await store.completeSlot(
    { job: "odds", race_id: "2026-09-19-01-01", offset_min: -60 },
    { worker: "w1", now, outcome: "ok", rowsWritten: 1, resultDigest: "d" },
  );
  const u = log[0];
  check(
    "completeSlot: scrape_slots の (job,race_id,offset_min) を、claimed_by=自分 かつ status=running のときだけ done に更新",
    applied === true &&
      u._table === "scrape_slots" &&
      u._ops.some(
        (o) => o[0] === "eq" && o[1] === "claimed_by" && o[2] === "w1",
      ) &&
      u._ops.some(
        (o) => o[0] === "eq" && o[1] === "status" && o[2] === "running",
      ) &&
      u._ops.some(
        (o) =>
          o[0] === "match" &&
          o[1].race_id === "2026-09-19-01-01" &&
          o[1].offset_min === -60 &&
          o[1].job === "odds",
      ) &&
      u._ops[0][1].status === "done" &&
      u._ops[0][1].done_at === now.toISOString() &&
      u._ops[0][1].last_error === null,
    opsOf(u),
  );
  nextResult = () => ({ data: [], error: null });
  check(
    "リースを奪われていて0行更新なら false（呼び出し側が警告して、二重完了にしない）",
    (await store.completeSlot(
      { job: "odds", race_id: "r", offset_min: 0 },
      { worker: "old", now, outcome: "ok" },
    )) === false,
  );
  nextResult = () => ({ data: [{ race_id: "x" }], error: null });

  // 再試行: pending に戻し next_attempt_at を設定、リースを外す
  log.length = 0;
  await store.retrySlot(
    { job: "odds", race_id: "r", offset_min: -30 },
    {
      worker: "w1",
      now,
      outcome: "no_values",
      error: "x".repeat(900),
      retryAt: new Date(now.getTime() + 60_000),
    },
  );
  const rt = log[0]._ops[0][1];
  check(
    "retrySlot: pending・next_attempt_at・lease解除・last_errorは500字に切る",
    rt.status === "pending" &&
      rt.next_attempt_at === new Date(now.getTime() + 60_000).toISOString() &&
      rt.lease_until === null &&
      rt.outcome === "no_values" &&
      rt.last_error.length === 500,
  );

  // 着手せずに返す: 試行回数を戻し、last_error は上書きしない
  log.length = 0;
  await store.retrySlot(
    { job: "odds", race_id: "r", offset_min: -30, attempts: 2 },
    { worker: "w1", now, retryAt: now, releaseAttempt: true },
  );
  const rel = log[0]._ops[0][1];
  check(
    "retrySlot(releaseAttempt): attempts を1戻し、last_error を上書きしない",
    rel.attempts === 1 && !("last_error" in rel) && rel.status === "pending",
    show(rel),
  );

  // tick: 5分以上古い場合のみ更新
  log.length = 0;
  await store.touchTick("odds", now);
  const tick = log[0];
  const orFilter = tick._ops.find((o) => o[0] === "or")?.[1] ?? "";
  check(
    "touchTick: last_tick_at が NULL か5分より古いときだけ更新する条件付き",
    orFilter ===
      `last_tick_at.is.null,last_tick_at.lt.${new Date(now.getTime() - 300_000).toISOString()}`,
    orFilter,
  );

  // ジョブ単位のリース
  log.length = 0;
  nextResult = () => ({ data: [{ job: "point_rank" }], error: null });
  check(
    "acquireLease: 1行更新できれば取得",
    (await store.acquireLease("point_rank", "w1", 600, now)) === true,
  );
  const lease = log[0];
  check(
    "acquireLease: lease_until が NULL か過去のときだけ更新する条件付き",
    lease._ops.some(
      (o) =>
        o[0] === "or" &&
        o[1] === `lease_until.is.null,lease_until.lt.${now.toISOString()}`,
    ),
  );
  nextResult = () => ({ data: [], error: null });
  check(
    "acquireLease: 0行なら他の実行が持っている",
    (await store.acquireLease("point_rank", "w2", 600, now)) === false,
  );

  // RPC
  rpcLog.length = 0;
  nextResult = () => ({
    data: [{ race_id: "a", job: "odds", offset_min: -60 }],
    error: null,
  });
  const claimed = await store.claimSlots({
    job: "odds",
    worker: "w1",
    mode: "shadow",
  });
  const [rpcName, rpcArgs] = rpcLog[0];
  check(
    "claimSlots: レジストリの値（limit・リース・許容幅）と run_mode で claim_scrape_slots を呼ぶ",
    rpcName === "claim_scrape_slots" &&
      rpcArgs.p_limit === SCRAPE_JOBS.odds.claimLimit &&
      rpcArgs.p_lease_sec === SCRAPE_JOBS.odds.leaseSec &&
      rpcArgs.p_grace_min === SCRAPE_JOBS.odds.graceMin &&
      rpcArgs.p_run_mode === "shadow" &&
      rpcArgs.p_worker === "w1" &&
      !("p_now" in rpcArgs) &&
      claimed.length === 1,
    show(rpcArgs),
  );
  nextResult = () => ({ data: 12, error: null });
  const created = await store.ensureSlots({
    date: "2026-09-19",
    jobs: ["odds"],
  });
  check(
    "ensureSlots: ensure_scrape_slots に、ジョブ×窓の定義を渡し、期限を過ぎたスロットは作らない",
    created === 12 &&
      rpcLog[1][0] === "ensure_scrape_slots" &&
      rpcLog[1][1].p_skip_lapsed === true &&
      rpcLog[1][1].p_defs.length === 6,
    show(rpcLog[1]),
  );

  // スキーマ未適用は readState だけが available=false にする。それ以外のエラーは投げる
  nextResult = () => ({
    data: null,
    error: {
      code: "PGRST205",
      message:
        "Could not find the table 'public.scrape_job_state' in the schema cache",
    },
  });
  check(
    "readState: テーブルが無ければ available=false",
    (await store.readState("odds")).available === false,
  );
  nextResult = () => ({
    data: null,
    error: { code: "57014", message: "statement timeout" },
  });
  let threw;
  try {
    await store.readState("odds");
  } catch (e) {
    threw = e;
  }
  check(
    "readState: その他のDBエラーは意味のあるメッセージ付きで投げる",
    threw &&
      /ジョブ状態\(odds\)の読み取りに失敗しました: statement timeout/.test(
        threw.message,
      ),
  );
  nextResult = () => ({
    data: null,
    error: {
      code: "42501",
      message: "permission denied for function claim_scrape_slots",
    },
  });
  let threw2;
  try {
    await store.claimSlots({ job: "odds", worker: "w", mode: "live" });
  } catch (e) {
    threw2 = e;
  }
  check(
    "claim のエラー（権限等）は握りつぶさず投げる",
    threw2 && /claim_scrape_slots/.test(threw2.message),
  );
}

// ---------------------------------------------------------------------------
// (j) getRaceSchedule の例外モード
// ---------------------------------------------------------------------------
{
  const fake = (result) => ({
    from: () => {
      const b = {
        select: () => b,
        like: () => b,
        not: () => Promise.resolve(result),
      };
      return b;
    },
  });
  const dbError = fake({
    data: null,
    error: { message: "connection refused" },
  });
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  const legacy = await getRaceSchedule("2026-09-19", { client: dbError });
  console.error = originalError;
  console.warn = originalWarn;
  check(
    "既定（従来どおり）: DBエラーは空配列を返す",
    Array.isArray(legacy) && legacy.length === 0,
  );
  let threw;
  try {
    await getRaceSchedule("2026-09-19", {
      client: dbError,
      throwOnError: true,
    });
  } catch (e) {
    threw = e;
  }
  check(
    "throwOnError: DBエラーを空配列にせず、原因付きで例外にする",
    threw && /connection refused/.test(threw.message),
  );
  console.warn = () => {};
  const empty = await getRaceSchedule("2026-09-19", {
    client: fake({ data: [], error: null }),
    throwOnError: true,
  });
  console.warn = originalWarn;
  check(
    "throwOnError でも、races が未登録（空）なら空配列（エラーではない）",
    Array.isArray(empty) && empty.length === 0,
  );
  const ok = await getRaceSchedule("2026-09-19", {
    client: fake({
      data: [
        { race_id: "2026-09-19-02-03", start_time: "10:30:00" },
        { race_id: "2026-09-19-01-01", start_time: "09:00:00" },
      ],
      error: null,
    }),
    throwOnError: true,
  });
  check(
    "正常: 発走順に並び、JSTの発走時刻を返す",
    ok.length === 2 &&
      ok[0].race_id === "2026-09-19-01-01" &&
      ok[0].start_time.toISOString() === "2026-09-19T00:00:00.000Z",
  );
}

printOut(
  failures === 0 ? "\nALL PASS" : `\n${failures} 件の検証が失敗しました`,
);
process.exit(failures === 0 ? 0 : 1);
