/**
 * verify-boatcast-job.js の後半の場面（4/6）。verify ではない。
 * 判定と期待値は分ける前の verify-boatcast-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import * as realJob from "../../lib/boatcast/oritenJob.js";
import { CANARY_URL } from "../../lib/boatcast/boatcastClient.js";
import {
  clearBoatcastSchemaCache,
  detectBoatcastSchema,
  MOTOR_START_TABLES,
} from "../../lib/boatcast/oritenSchema.js";
import { MOTOR_START_JOB, nextHistory, HISTORY_DAYS } from "../../lib/boatcast/motorStartJob.js";
import { createBoatcastProbeHandler } from "../../lib/boatcast/probe.js";
import { createFakeSupabaseClient } from "../../lib/scrapeJobs/testing/fakeSupabaseClient.js";
import {
  createFakeFetch,
  show,
  FORBIDDEN,
  withMissingTables,
  routeOriten,
  same,
  RACE_ID,
  OK_MST,
  THREE,
} from "./boatcast-job-fixtures.js";
import { evaluateParser } from "./boatcast-job-parse-rows.js";
import { runDaily, mstRouter } from "./boatcast-job-scenes-3.js";
import { noWaitPacer } from "./boatcast-job-scenes-1.js";

let check, withMutant;
let parserMutants;

/** 変異で壊れた版は、評価の途中で例外になることがある。例外も「検証が失敗した」として数える */
export const safeEval = async (fn) => {
  try {
    return await fn();
  } catch (e) {
    return [`例外: ${e.message}`];
  }
};

/** 元の verify の1つの塊 { } を割った 1/3 */
async function scene1() {
  const mk = () =>
    createFakeSupabaseClient({ tables: { venue_motor_start_dates: [] } });
  const off = await runDaily({
    mode: "off",
    client: mk(),
    fetchImpl: createFakeFetch(mstRouter()),
  });
  check("(f) off: 何も取得しない", off.result.body.skipped === "mode_off");
  const c1 = mk();
  const f1 = createFakeFetch(mstRouter());
  const shadow = await runDaily({ mode: "shadow", client: c1, fetchImpl: f1 });
  const shadowState = shadow.store.state.get(MOTOR_START_JOB);
  check(
    "(f) shadow: 24件取得・解析のみ。書かず、対象日を処理済みにしない",
    f1.calls.length === 24 &&
      c1.writes.length === 0 &&
      !shadowState.last_target_date &&
      shadow.result.body.fetched === 24,
  );
  const c2 = mk();
  const live = await runDaily({
    mode: "live",
    client: c2,
    fetchImpl: createFakeFetch(mstRouter()),
  });
  const liveState = live.store.state.get(MOTOR_START_JOB);
  check(
    "(f) live: 24会場の（会場, 使用開始日）を書き、対象日（2026-09-21）を処理済みにする",
    c2.data.venue_motor_start_dates.length === 24 &&
      liveState.last_target_date === "2026-09-21" &&
      liveState.last_rows_written === 24,
    show(liveState),
  );
  // 日ごとの取得の履歴（完了の定義A・Bの実測。日ごとの成否・完了時刻）
  const hist = liveState.last_report?.history;
  check(
    "(f) last_report.history に、対象日ごとの取得件数・完了時刻・成否が残る（本体のテーブルは新しい日付が現れたときだけ増えるため）",
    Array.isArray(hist) &&
      hist.length === 1 &&
      hist[0].date === "2026-09-21" &&
      hist[0].fetched === 24 &&
      hist[0].expected === 24 &&
      hist[0].complete === true &&
      typeof hist[0].doneAt === "string",
    show(hist),
  );
  return { mk, c2 };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
async function scene2({ mk, c2 }) {
  {
    const entry = (date, fetched = 24) => ({
      date,
      fetched,
      expected: 24,
      failed: [],
      complete: true,
      doneAt: "x",
    });
    const twoDays = nextHistory([entry("2026-09-20", 23)], entry("2026-09-21"));
    const replaced = nextHistory(twoDays, entry("2026-09-21", 22));
    const many = Array.from({ length: 20 }, (_, i) =>
      entry(`2026-08-${String(i + 1).padStart(2, "0")}`),
    );
    check(
      "(f) 履歴: 同じ対象日の再実行（補足の起動）は置き換え、直近14日分だけ残す",
      twoDays.length === 2 &&
        replaced.length === 2 &&
        replaced[1].fetched === 22 &&
        nextHistory(many, entry("2026-09-01")).length === HISTORY_DAYS &&
        nextHistory(undefined, entry("2026-09-21")).length === 1,
    );
  }
  // 2回目: 同じ組は書かない。日付が変わった会場だけ追記（履歴）
  const c3 = createFakeSupabaseClient({
    tables: { venue_motor_start_dates: c2.data.venue_motor_start_dates },
  });
  const again = await runDaily({
    mode: "live",
    client: c3,
    fetchImpl: createFakeFetch(
      mstRouter({ 15: { status: 200, body: "20260917\n" } }),
    ),
  });
  const marugame = c3.data.venue_motor_start_dates.filter(
    (r) => r.venue_code === 15,
  );
  check(
    "(f) 2回目: 同じ組は書かない。使用開始日が変わった会場（丸亀）だけ、新しい行を追記する（履歴）",
    again.store.state.get(MOTOR_START_JOB).last_rows_written === 1 &&
      marugame.length === 2 &&
      c3.data.venue_motor_start_dates.length === 25,
    show(marugame),
  );
  // 一部失敗: incomplete（対象日を処理済みにしない）＋alerts
  const c4 = mk();
  const part = await runDaily({
    mode: "live",
    client: c4,
    fetchImpl: createFakeFetch(mstRouter({ "07": FORBIDDEN })),
  });
  const partState = part.store.state.get(MOTOR_START_JOB);
  check(
    "(f) 一部失敗: 取れた23件を書き、incomplete（対象日を処理済みにしない=補足の起動が再処理）。alerts に出す",
    c4.data.venue_motor_start_dates.length === 23 &&
      part.result.body.incomplete === true &&
      !partState.last_target_date &&
      partState.last_report?.alerts?.some(
        (a) => a.key === "motor_start_incomplete" && a.text.includes("07"),
      ),
    show(partState),
  );
  // 全失敗: error
  const c5 = mk();
  const blockedRun = await runDaily({
    mode: "live",
    client: c5,
    fetchImpl: createFakeFetch(() => FORBIDDEN),
  });
  check(
    "(f) 最初から続けて失敗: error（成功にしない）・データなし",
    blockedRun.result.status === 500 && c5.writes.length === 0,
  );
  // 未適用のDB
  const c6 = withMissingTables(mk(), ["venue_motor_start_dates"]);
  return { mk, c6 };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
async function scene3({ mk, c6 }) {
  clearBoatcastSchemaCache(c6);
  const unapplied = await runDaily({
    mode: "live",
    client: c6,
    fetchImpl: createFakeFetch(mstRouter()),
  });
  check(
    "(f) 091が未適用のDB: 書かず error",
    unapplied.result.status === 500 &&
      /091/.test(unapplied.store.state.get(MOTOR_START_JOB).last_error),
  );
  const c7 = withMissingTables(mk(), ["venue_motor_start_dates"]);
  clearBoatcastSchemaCache(c7);
  check(
    "(f) 未適用の判定: 存在しないテーブルは false（結果はキャッシュされ、再確認しない）",
    (await detectBoatcastSchema(c7, MOTOR_START_TABLES)) === false,
  );
}

async function scene4() {
  {
    const s1 = await scene1();
    const s2 = await scene2(s1);
    await scene3(s2);
  }
}

async function scene5() {
  // ---------------------------------------------------------------------------
  // (g) probe
  // ---------------------------------------------------------------------------
  {
    const mkRes = () => {
      const r = { code: 0, body: null };
      r.status = (c) => ((r.code = c), r);
      r.json = (b) => ((r.body = b), r);
      return r;
    };
    process.env.CRON_SECRET = "test-secret";
    const mkHandler = (mode, fetchImpl) =>
      createBoatcastProbeHandler({
        getClient: async () => ({}),
        createStore: () => ({
          readState: async () => ({
            available: true,
            row: mode ? { job: realJob.ORITEN_JOB, mode } : null,
          }),
        }),
        fetchImpl,
        pacer: noWaitPacer,
      });
    const auth = { authorization: "Bearer test-secret" };
    const noAuth = mkRes();
    await mkHandler(
      "shadow",
      createFakeFetch(() => OK_MST),
    )({ headers: {}, query: { probe: "1" } }, noAuth);
    check("(g) probe: 認証なしは401（取得しない）", noAuth.code === 401);
    const off = mkRes();
    const fOff = createFakeFetch(() => OK_MST);
    await mkHandler("off", fOff)({ headers: auth, query: { probe: "1" } }, off);
    check(
      "(g) probe: mode が off（行なしを含む）は409で、取得しない",
      off.code === 409 && fOff.calls.length === 0,
    );
    const fp = createFakeFetch(
      routeOriten(() => ({
        status: 200,
        body: THREE,
        lastModified: "Mon, 21 Sep 2026 01:16:32 GMT",
      })),
    );
    const ok = mkRes();
    await mkHandler("shadow", fp)({ headers: auth, query: { probe: "1" } }, ok);
    check(
      "(g) probe: shadow なら、カナリア（bc_mst）だけを取り（1リクエスト）、ステータス・本文の先頭・リージョン・所要時間を返す",
      ok.code === 200 &&
        same(fp.calls, [CANARY_URL]) &&
        ok.body.canary.status === 200 &&
        ok.body.canary.head.startsWith("20260323") &&
        ok.body.sample === null &&
        "region" in ok.body &&
        typeof ok.body.elapsedMs === "number",
      show(ok.body),
    );
    const fp2 = createFakeFetch(
      routeOriten(() => ({
        status: 200,
        body: THREE,
        lastModified: "Mon, 21 Sep 2026 01:16:32 GMT",
      })),
    );
    const ok2 = mkRes();
    await mkHandler("live", fp2)(
      { headers: auth, query: { probe: "1", race: RACE_ID } },
      ok2,
    );
    check(
      "(g) probe: race を指定すると、オリジナル展示のファイルも1件取る（合計2リクエスト）。書き込みなし",
      fp2.calls.length === 2 &&
        ok2.body.sample.status === 200 &&
        ok2.body.sample.lastModified === "2026-09-21T01:16:32.000Z" &&
        ok2.body.sample.head.startsWith("data="),
      show(ok2.body),
    );
    const f403 = createFakeFetch(() => FORBIDDEN);
    const blocked = mkRes();
    await mkHandler("shadow", f403)(
      { headers: auth, query: { probe: "1" } },
      blocked,
    );
    check(
      "(g) probe: カナリアが403でも、結果（403）をそのまま返す（判断は呼び出し側）",
      blocked.code === 200 &&
        blocked.body.canary.status === 403 &&
        blocked.body.canary.head === null,
    );
    delete process.env.CRON_SECRET;
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・withMutant） */
export async function runBoatcastJobScenes4(env) {
  ({ check, withMutant } = env);
  await scene4();
  await scene5();
}

async function scene6() {
  parserMutants = [
    [
      "項目名の空白（全角スペース）を除かない",
      [[String.raw`.replace(/[\s\u3000]+/g, "")`, `.replace(/[ ]+/g, "")`]],
    ],
    [
      "欠測（--.--）を null にせず0にする",
      [
        [
          "else if (MISSING_RE.test(v)) values.push(null);",
          "else if (MISSING_RE.test(v)) values.push(0);",
        ],
      ],
    ],
    [
      "列数の不一致を検出しない",
      [["if (cols.length !== 2 + count) {", "if (false) {"]],
    ],
    [
      "先頭の data= を確認しない（HTMLのエラーページを通す）",
      [['if (lines[0]?.trim() !== "data=") {', "if (false) {"]],
    ],
    ["枠番の重複を検出しない", [["if (seen.has(boatNumber)) {", "if (false) {"]]],
    [
      "計測不可を計測ありとして扱う（選手の行なしをエラーにする）",
      [["if (flag === 2) {", "if (false) {"]],
    ],
    [
      "値の形式の検査をしない（数値でない値を通す）",
      [
        [
          "else return fail(`値が数値でも欠測表記でもありません: ${raw}`);",
          "else values.push(Number(v));",
        ],
      ],
    ],
    [
      "bc_mst の日付の妥当性を確認しない",
      [
        ["Number.isNaN(date.getTime()) ||", "false ||"],
        ["date.getUTCFullYear() !== Number(y) ||", "false ||"],
        ["date.getUTCMonth() + 1 !== Number(mo) ||", "false ||"],
        ["date.getUTCDate() !== Number(d)", "false"],
      ],
    ],
  ];
  for (const [label, replacements] of parserMutants) {
    const failed = await withMutant("oritenParser.js", replacements, async (m) =>
      safeEval(() => evaluateParser(m)),
    );
    check(
      `(i) 変異検証（パーサー）: ${label} → 検証が失敗する（${failed.length}項目）`,
      failed.length > 0,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・withMutant） */
export async function runBoatcastJobScenes5(env) {
  ({ check, withMutant } = env);
  await scene6();
}
