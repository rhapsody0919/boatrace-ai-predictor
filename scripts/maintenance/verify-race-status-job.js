/**
 * verify-race-status-job.js - 中止・順延の早期確定（race_status）の検証。
 * DBにも取得先にも接続しない（実ページのHTML・偽クライアント・メモリのストア・fetchの差し替え）。
 * 設計: docs/design/scraping-vercel-consolidation/postponed-day-early-detection.md
 *
 *   (a) 状態欄の分類: 日全体・N R以降の中止・順延を読み取る。全角、範囲外、未知の文言、発売状況
 *   (b) 開催場一覧（2026-09-21の実ページ）: 戸田・江戸川=全日、津=5R以降、三国=10R以降、他は告知なし。
 *       会場が1つも読めなければ空配列
 *   (c) 結果ページ（実ページ）: 「レース中止」だけを中止とみなす。通常の「データなし」・結果ありは中止でない
 *   (d) ジョブ: 候補（告知のあった会場のN R以降・未確定・結果なし）だけを結果ページで確かめ、確かめられた
 *       ものだけを確定にする。反映待ち・取得失敗は確定にせず、次の起動が補う。結果のあるレースは確定にしない
 *   (e) mode: off は何もしない。shadow は取得・解析のみで、DBへ書かず wouldConfirm を残す。live で書く
 *   (f) 失敗: 開催場一覧の取得失敗・解析0件・結果ページの全件失敗は失敗（成功にしない）。ブレーカーは skipped
 *   (g) 配線: レジストリ・api/cron/race-status.js の maxDuration・vercel.json の cron・既存の確定関数の再利用
 *
 * 実行: node scripts/maintenance/verify-race-status-job.js
 */
import fs from "node:fs";
import { runScrapeJob } from "../lib/scrapeJobs/cronWrapper.js";
import { SCRAPE_JOBS, validateRegistry } from "../lib/scrapeJobs/registry.js";
import { createMemoryStore } from "../lib/scrapeJobs/testing/memoryStore.js";

import {
  classifyStatusText,
  isRaceCancelledPage,
  parseVenueStatuses,
  raceIndexUrl,
  raceResultUrl,
} from "../lib/raceStatusParsers.js";
import { runRaceStatusJob } from "../lib/raceStatusJob.js";
import { cronWiring } from "./verifyData/cronWiring.js";
import {
  createFakeClient,
  DATE,
  raceId,
  scenarioTables,
  statusOf,
  runRaceStatusJobScenes1,
  runRaceStatusJobScenes2,
  runRaceStatusJobScenes3,
  runRaceStatusJobScenes4,
  runRaceStatusJobScenes5,
  runRaceStatusJobScenes6,
} from "./verifyData/race-status-job-scenes.js";

const out = { log: console.log, error: console.error };
console.log = console.warn = console.error = () => {};

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    out.log(`✅ ${label}`);
  } else {
    failures++;
    out.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);

const FIXTURES = new URL("../lib/__fixtures__/raceStatus/", import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, FIXTURES), "utf8");
const INDEX = read("race-index-2026-09-21-postponed.html");
const CANCELLED = read("raceresult-cancelled.html");
const NO_DATA = read("raceresult-no-data.html");
const WITH_RESULT = read("raceresult-with-result.html");

// ---------------------------------------------------------------------------
// (a) 状態欄の分類
// ---------------------------------------------------------------------------
{
  const cases = [
    ["中止順延", { kind: "cancelled_from", fromRace: 1 }],
    ["中止", { kind: "cancelled_from", fromRace: 1 }],
    ["順延", { kind: "cancelled_from", fromRace: 1 }],
    ["5R以降中止順延", { kind: "cancelled_from", fromRace: 5 }],
    ["10R以降中止", { kind: "cancelled_from", fromRace: 10 }],
    ["12R以降順延", { kind: "cancelled_from", fromRace: 12 }],
    ["５Ｒ以降中止順延", { kind: "cancelled_from", fromRace: 5 }], // 全角
    [" 中止 順延 ", { kind: "cancelled_from", fromRace: 1 }], // 空白
    ["13R以降中止", { kind: "unrecognized" }], // 範囲外
    ["0R以降中止", { kind: "unrecognized" }],
    ["本日中止のお知らせ", { kind: "unrecognized" }], // 未知の文言は確定しない
    ["1R以降発売中", { kind: "none" }],
    ["最終Ｒ発売終了", { kind: "none" }],
    ["", { kind: "none" }],
    [undefined, { kind: "none" }],
  ];
  for (const [text, expected] of cases) {
    const got = classifyStatusText(text);
    check(
      `状態欄「${text ?? "(undefined)"}」→ ${expected.kind}${expected.fromRace ? `（${expected.fromRace}R以降）` : ""}`,
      show(got) === show(expected),
      show(got),
    );
  }
}

// ---------------------------------------------------------------------------
// (b) 開催場一覧（実ページ）
// ---------------------------------------------------------------------------
const venues = parseVenueStatuses(INDEX);
const venueByCode = new Map(venues.map((v) => [v.venueCode, v]));
{
  check(
    "実ページ（2026-09-21）: 13会場を、jcd（会場コード）で読み取る",
    venues.length === 13 && venueByCode.size === 13,
    `${venues.length}会場`,
  );
  const from = (code) => venueByCode.get(code)?.status.fromRace;
  check(
    "戸田(2)・江戸川(3)=全日（1R以降）、津(9)=5R以降、三国(10)=10R以降",
    from(2) === 1 && from(3) === 1 && from(9) === 5 && from(10) === 10,
    show([from(2), from(3), from(9), from(10)]),
  );
  const announcedCodes = venues
    .filter((v) => v.status.kind === "cancelled_from")
    .map((v) => v.venueCode)
    .sort((x, y) => x - y);
  check(
    "告知があるのは上の4会場だけ（「N R以降発売中」「最終Ｒ発売終了」は中止でない）。未知の文言は無し",
    show(announcedCodes) === "[2,3,9,10]" &&
      venues.every((v) => v.status.kind !== "unrecognized"),
    show(announcedCodes),
  );
  check(
    "会場が1つも読めないHTMLは空配列（呼び出し側が構造の変化として失敗にする）",
    parseVenueStatuses("<html><body><p>メンテナンス中</p></body></html>")
      .length === 0,
  );
}

// ---------------------------------------------------------------------------
// (c) 結果ページ（実ページ）
// ---------------------------------------------------------------------------
{
  check(
    "結果ページ: 「レース中止」の見出し（津6R、順延日）は中止",
    isRaceCancelledPage(CANCELLED) === true,
  );
  check(
    "結果ページ: 「※ データはありません。」（発走前の通常のレース）は中止でない",
    isRaceCancelledPage(NO_DATA) === false,
  );
  check(
    "結果ページ: 結果の表があるレース（津4R。日付タブが『順延』の日でも）は中止でない",
    isRaceCancelledPage(WITH_RESULT) === false,
  );
  check(
    "URL: 開催場一覧・結果ページ（会場コードは2桁、日付は YYYYMMDD）",
    raceIndexUrl("2026-09-21") ===
      "https://www.boatrace.jp/owpc/pc/race/index?hd=20260921" &&
      raceResultUrl(2, 7, "2026-09-21") ===
        "https://www.boatrace.jp/owpc/pc/race/raceresult?rno=7&jcd=02&hd=20260921",
  );
}

// ---- 後半の場面（verifyData/race-status-job-scenes.js） ----
runRaceStatusJobScenes1({ out, check, show, INDEX, stubFetchHtml });
const NOW = new Date("2026-09-21T05:00:00Z");

// ---- 後半の場面（verifyData/race-status-job-scenes.js） ----
runRaceStatusJobScenes2({ out, check, show, INDEX, stubFetchHtml });

/**
 * 結果ページの応答を、レースごとに指定する。既定は「レース中止」。
 * 開催場一覧のURLには INDEX を返す。呼び出しを記録する。
 */
function stubFetchHtml({ index = INDEX, results = () => CANCELLED } = {}) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (u.pathname.endsWith("/race/index")) {
      const r = typeof index === "function" ? index() : index;
      if (r instanceof Error) throw r;
      return r;
    }
    const venue = Number(u.searchParams.get("jcd"));
    const no = Number(u.searchParams.get("rno"));
    const r = results(venue, no);
    if (r instanceof Error) throw r;
    return r;
  };
  fn.calls = calls;
  fn.resultCalls = () => calls.filter((c) => c.includes("raceresult"));
  return fn;
}

const ctxOf = (client, mode, extra = {}) => ({
  mode,
  client,
  now: () => NOW,
  politeFetch: async () => {
    throw new Error("politeFetch は fetchHtml の差し替えで使わない");
  },
  shouldStop: () => false,
  ...extra,
});

// ---- 後半の場面（verifyData/race-status-job-scenes.js） ----
runRaceStatusJobScenes3({ out, check, show, INDEX, stubFetchHtml, ctxOf });
{
  const client = createFakeClient({ tables: scenarioTables() });
  // 反映待ち: 津12R・三国11R は結果ページがまだ「データなし」。三国12R は取得に失敗
  const fetchHtml = stubFetchHtml({
    results: (venue, no) => {
      if (venue === 9 && no === 12) return NO_DATA;
      if (venue === 10 && no === 11) return NO_DATA;
      if (venue === 10 && no === 12) return new Error("HTTP 503");
      return CANCELLED;
    },
  });
  const res = await runRaceStatusJob(ctxOf(client, "live"), { fetchHtml });
  const expectConfirmed = [
    ...[7, 8, 9, 10, 11, 12].map((n) => raceId(2, n)),
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => raceId(3, n)),
    ...[6, 7, 8, 9, 10, 11].map((n) => raceId(9, n)),
    raceId(10, 10),
  ];
  const confirmedNow = client.state.races
    .filter((r) => r.cancellation_status === "confirmed")
    .map((r) => r.race_id);
  const newlyConfirmed = confirmedNow.filter(
    (id) =>
      !scenarioTables().races.find(
        (r) => r.race_id === id && r.cancellation_status === "confirmed",
      ),
  );
  check(
    "live: 告知のあった4会場の未確定レース（戸田7〜12R・江戸川1〜12R・津6〜11R・三国10R）を確定にする",
    res.rowsWritten === expectConfirmed.length &&
      show(newlyConfirmed.sort()) === show([...expectConfirmed].sort()),
    show({
      rowsWritten: res.rowsWritten,
      newlyConfirmed: newlyConfirmed.length,
    }),
  );
  check(
    "確かめられなかったもの（津12R=反映待ち・三国11R=反映待ち・三国12R=取得失敗）は確定にしない",
    statusOf(client, raceId(9, 12)) === null &&
      statusOf(client, raceId(10, 11)) === null &&
      statusOf(client, raceId(10, 12)) === null &&
      show(res.report.notOnPage.sort()) ===
        show([raceId(9, 12), raceId(10, 11)].sort()) &&
      res.report.errors.length === 1 &&
      res.report.errors[0].startsWith(raceId(10, 12)),
    show(res.report),
  );
  check(
    "告知の範囲外は触らない・確かめない: 津1〜4R（実施済み）・桐生（告知なし）・戸田1〜6R（確定済み）は、結果ページを取得しない",
    fetchHtml.resultCalls().every((u) => {
      const p = new URL(u).searchParams;
      const v = Number(p.get("jcd"));
      const n = Number(p.get("rno"));
      return !(
        v === 1 ||
        (v === 9 && n <= 5) ||
        (v === 2 && n <= 6) ||
        (v === 10 && n < 10)
      );
    }) &&
      statusOf(client, raceId(1, 1)) === null &&
      statusOf(client, raceId(9, 1)) === null,
    `結果ページの取得 ${fetchHtml.resultCalls().length}件`,
  );
  check(
    "取得は、開催場一覧1件＋候補のレース分だけ（6+12+7+3=28レース。全レースを毎回取得しない）",
    fetchHtml.calls.length === 1 + 28,
    `${fetchHtml.calls.length}件`,
  );

  // 2回目（次の起動）: 確定済みは候補から外れ、残りの3レースだけを再確認する（冪等）
  const fetchHtml2 = stubFetchHtml({
    results: (venue, no) => (venue === 10 && no === 12 ? NO_DATA : CANCELLED),
  });
  const res2 = await runRaceStatusJob(ctxOf(client, "live"), {
    fetchHtml: fetchHtml2,
  });
  check(
    "次の起動: 反映待ち・失敗だった3レースだけを再確認し、結果ページが『レース中止』になった2レースを確定にする（三国12Rは、まだデータなし）",
    fetchHtml2.resultCalls().length === 3 &&
      res2.rowsWritten === 2 &&
      statusOf(client, raceId(9, 12)) === "confirmed" &&
      statusOf(client, raceId(10, 11)) === "confirmed" &&
      statusOf(client, raceId(10, 12)) === null,
    show(res2.report),
  );
  const updateCalls = client.calls.filter((c) => c.op === "update");
  check(
    "書き込みは cancellation_status の更新のみ（確定の関数 confirmCancellationsForRaceIds を再利用。他の列は触らない）",
    updateCalls.length === 2 &&
      updateCalls.every(
        (c) =>
          show(Object.keys(c.payload)) === '["cancellation_status"]' &&
          c.payload.cancellation_status === "confirmed",
      ),
    show(updateCalls.map((c) => c.payload)),
  );
}

// ---- 後半の場面（verifyData/race-status-job-scenes.js） ----
await runRaceStatusJobScenes4({ out, check, show, INDEX, stubFetchHtml, ctxOf });

// ---------------------------------------------------------------------------
// (e) mode（共通ラッパ経由）
// ---------------------------------------------------------------------------
const runWrapped = ({ mode, client, fetchHtml, extra = {} }) => {
  const store = createMemoryStore({
    rows: mode ? { race_status: { job: "race_status", mode } } : {},
  });
  return {
    store,
    promise: runScrapeJob({
      job: "race_status",
      store,
      run: (ctx) => runRaceStatusJob(ctx, { fetchHtml }),
      now: () => NOW,
      worker: "w-test",
      modeGated: true,
      client,
      politeFetch: async () => {
        throw new Error("使わない");
      },
      ...extra,
    }),
  };
};
{
  const offClient = createFakeClient({ tables: scenarioTables() });
  const offFetch = stubFetchHtml();
  const off = runWrapped({
    mode: "off",
    client: offClient,
    fetchHtml: offFetch,
  });
  const offRes = await off.promise;
  check(
    "off: 何もしない（取得もDBの読み書きもしない）",
    offRes.status === 200 &&
      offRes.body.skipped === "mode_off" &&
      offFetch.calls.length === 0 &&
      offClient.calls.length === 0,
    show(offRes.body),
  );
  const none = runWrapped({
    mode: null,
    client: offClient,
    fetchHtml: offFetch,
  });
  const noneRes = await none.promise;
  check(
    "ジョブ状態の行が無い（デプロイ直後）: off として何もしない。誤報にならない",
    noneRes.body.skipped === "mode_off" &&
      offFetch.calls.length === 0 &&
      none.store.state.get("race_status")?.mode === "off",
  );

  const shadowClient = createFakeClient({ tables: scenarioTables() });
  const shadowFetch = stubFetchHtml();
  const shadow = runWrapped({
    mode: "shadow",
    client: shadowClient,
    fetchHtml: shadowFetch,
  });
  const shadowRes = await shadow.promise;
  const report = shadow.store.state.get("race_status").last_report;
  check(
    "shadow: 取得・解析はするが races へ書かない。確定するはずのレース（28件全て。打ち切らない）を wouldConfirm に残す",
    shadowRes.status === 200 &&
      !shadowClient.calls.some((c) => c.op === "update") &&
      shadowClient.state.races.filter(
        (r) => r.cancellation_status === "confirmed",
      ).length === 7 &&
      report.confirmed === 0 &&
      report.wouldConfirm.length === 28 &&
      report.wouldConfirm.every((id) => id.startsWith(DATE)),
    show({ status: shadowRes.status, confirmed: report?.confirmed }),
  );

  const liveClient = createFakeClient({ tables: scenarioTables() });
  const live = runWrapped({
    mode: "live",
    client: liveClient,
    fetchHtml: stubFetchHtml(),
  });
  const liveRes = await live.promise;
  check(
    "live: 確定を書く。件数を rowsWritten に記録する（0件でも成功。告知の無い日は正常）",
    liveRes.status === 200 &&
      liveRes.body.rowsWritten === 28 &&
      live.store.state.get("race_status").last_rows_written === 28,
    show(liveRes.body),
  );
}

// ---- 後半の場面（verifyData/race-status-job-scenes.js） ----
await runRaceStatusJobScenes5({ out, check, show, INDEX, stubFetchHtml, ctxOf });

// ---------------------------------------------------------------------------
// (g) 配線
// ---------------------------------------------------------------------------
{
  const def = SCRAPE_JOBS.race_status;
  check(
    "レジストリ: race_status は continuous・リース=maxDuration・boatrace.jp。validateRegistry に違反なし",
    def?.kind === "continuous" &&
      def.leaseSec === def.maxDurationSec &&
      def.hosts.includes("boatrace.jp") &&
      validateRegistry().length === 0,
    show(validateRegistry()),
  );
  // api の本文の字は読まず、export（config・default）と、共通ラッパへ渡した引数で見る
  const api = await cronWiring(() => import("../../api/cron/race-status.js"));
  check(
    "api/cron/race-status.js: maxDuration がレジストリと同じ。job=race_status・run=runRaceStatusJob で共通ラッパを1回通し、その戻りを default export にする",
    api.config?.maxDuration === def.maxDurationSec &&
      api.made.length === 1 &&
      api.made[0].options.job === "race_status" &&
      api.made[0].options.run === runRaceStatusJob &&
      api.handler === api.made[0].handler,
    show({ config: api.config, jobs: api.made.map((w) => w.options.job) }),
  );
  const vercel = JSON.parse(
    fs.readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"),
  );
  const crons = vercel.crons.filter((c) => c.path === "/api/cron/race-status");
  check(
    "vercel.json: 10分間隔・UTC 21〜23時と0〜14時台（JST 06:00〜23:59）で1本だけ起動する",
    crons.length === 1 && crons[0].schedule === "*/10 21-23,0-14 * * *",
    show(crons),
  );
  // 書き込みが cancellation_status の更新だけ（他の列を触らない）ことは、上の live の実行の記録で見る
  const results = await import("../daily/scrape-results.js");
  check(
    "確定の書き込みは、既存の confirmCancellationsForRaceIds の再利用（scrape-results.js が関数を export する）",
    typeof results.confirmCancellationsForRaceIds === "function",
  );
}

if (failures > 0) {
  out.error(`\n${failures}件の検証が失敗しました`);
  process.exit(1);
}

// ---- 後半の場面（verifyData/race-status-job-scenes.js） ----
runRaceStatusJobScenes6({ out, check, show, INDEX, stubFetchHtml, ctxOf });
