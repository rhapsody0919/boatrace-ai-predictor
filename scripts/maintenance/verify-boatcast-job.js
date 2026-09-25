/**
 * verify-boatcast-job.js - BOATCASTのオリジナル展示（N25）・モーター使用開始日（N26）のパーサー・行の組み立て・取得ジョブ・
 * 403の扱い・公開マップ・DDL案の検証（docs/design/boatcast-original-exhibition/）。DBにも取得先にも接続しない
 * （実ファイルのフィクスチャ・偽クライアント・メモリのストア）。
 *
 *   (a) 解析: 実ファイル（scripts/lib/__fixtures__/boatcast/、2026-09-21に取得）で、3項目・2項目（直線なし）・半周ラップ・
 *       欠測（--.--）・計測不可（状態2）を、項目名（位置ではなくラベル）で解釈する。HTMLのエラーページ・列数の不一致・数値でない値・
 *       枠番の重複・未知の項目名を区別する。モーター使用開始日（bc_mst）
 *   (b) 行の組み立て・公開マップ: 縦持ちの行（艇×項目）、内容のハッシュ（選手名・項目の並びの順序に依存しない）、
 *       公開マップ（全24会場。江戸川は対象外）とフィクスチャの項目名の一致、403の再試行の判断（最大3回で打ち切り）
 *   (c) 取得ジョブ（processOritenRace）: shadow は何も書かない・live は書く。同じ内容の再取得は書かない。書く順序は「値 → レース単位」。
 *       未適用のDB・想定外の構造・HTTPエラーでは、書かずに error。403は再試行・打ち切り。マップ外の会場は取得しない
 *   (d) 共通ラッパ・403の扱い: off・行なしは何もしない。各tickの先頭でカナリアを1回だけ取り、失敗ならデータを取らず error・alerts に出す。
 *       カナリアが正常な403は、未公開（再試行）→ 打ち切り（skipped_not_target）。リクエストの間隔は2.2秒以上
 *   (e) 予定表・通知: 対象会場のレースにだけスロットを作る。alerts（カナリア失敗・parse_anomaly・会場のデータ無し）の更新と解除
 *   (f) モーター使用開始日（日次）: 全24会場・新しい組だけ書く・一部失敗は incomplete＋alerts・最初から続けて失敗は error
 *   (g) probe: 認証・mode の制限・書き込みなし
 *   (h) 配線・DDL・文書: maxDuration とレジストリの一致、vercel.json の cron、ホスト（別ブレーカー）、DDL案の列とコードが書く行の一致・RLS・
 *       匿名のSELECTなし、台帳・tasks.md・runbook・ADR
 *   (i) 変異検証: パーサー・行の組み立て・取得ジョブを壊した版で、上の検証が失敗する
 *
 * 実行: node scripts/maintenance/verify-boatcast-job.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as realParser from "../lib/boatcast/oritenParser.js";
import * as realRows from "../lib/boatcast/oritenRows.js";
import * as realJob from "../lib/boatcast/oritenJob.js";
import {
  ALL_VENUE_CODES,
  ORITEN_PUBLIC_MAP,
  expectedValueRows,
  isPublicVenue,
  publicVenueCodes,
} from "../lib/boatcast/publicMap.js";
import {
  BOATCAST_MIN_INTERVAL_MS,
  CANARY_URL,
  buildMotorStartUrl,
  buildOritenUrl,
  checkCanary,
  createPacer,
} from "../lib/boatcast/boatcastClient.js";
import {
  clearBoatcastSchemaCache,
  detectBoatcastSchema,
  MOTOR_START_TABLES,
} from "../lib/boatcast/oritenSchema.js";
import {
  ABORT_AFTER_CONSECUTIVE_FAILURES,
  HISTORY_DAYS,
  MOTOR_START_JOB,
  createMotorStartRun,
  fetchMotorStartDates,
  nextHistory,
} from "../lib/boatcast/motorStartJob.js";
import { createBoatcastProbeHandler } from "../lib/boatcast/probe.js";
import { runScrapeJob } from "../lib/scrapeJobs/cronWrapper.js";
import { SCRAPE_JOBS, validateRegistry } from "../lib/scrapeJobs/registry.js";
import { hostKeyOf } from "../lib/scrapeJobs/politeFetch.js";
import { BreakerOpenError } from "../lib/scrapeJobs/circuitBreaker.js";
import { computeWindowStats } from "../lib/scrapeJobs/monitor.js";
import { createMemoryStore } from "../lib/scrapeJobs/testing/memoryStore.js";
import { createFakeSupabaseClient } from "../lib/scrapeJobs/testing/fakeSupabaseClient.js";
import { evaluateJobStates } from "../lib/scrapeJobs/monitor.js";

// 検証の対象コードが出すログ（書き込みの要約・警告）は捨て、結果の行だけを出す
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 仮想の時計。now/sleep を差し替えて、実時間・実タイマーに依存せずに「並行して呼んでも順番に間隔を空けて通るか」を
 * 検証するために使う。実タイマーで測ると、CIランナーの負荷で発火が前後した分だけ観測上の間隔が縮み、コードが正しくても
 * 落ちる（2026-09-25、30ms間隔の検証が「31ms・27ms」で失敗。PR #839のCI run 36109118255）。
 *
 * runAll() は、積まれた sleep を起床時刻の早い順に消化し、その都度 setImmediate で待っていた側の続きを流す
 * （進むのは仮想の時刻だけで、実時間は待たない）。
 */
function createVirtualClock() {
  let t = 0;
  const timers = [];
  const drain = () => new Promise((resolve) => setImmediate(resolve));
  return {
    now: () => t,
    sleep: (ms) =>
      new Promise((resolve) => {
        timers.push({ at: t + ms, resolve });
      }),
    /** 積まれた sleep を起床時刻の順に消化する（消化の途中で積まれた分も拾う） */
    async runAll() {
      await drain();
      for (let guard = 0; timers.length > 0; guard++) {
        if (guard > 1000) throw new Error("仮想の時計: sleep が終わらない");
        timers.sort((a, b) => a.at - b.at);
        const next = timers.shift();
        t = Math.max(t, next.at);
        next.resolve();
        await drain();
      }
    },
  };
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURES = path.join(ROOT, "scripts/lib/__fixtures__/boatcast");
const readFixture = (name) =>
  fs.readFileSync(path.join(FIXTURES, name), "utf8");
const readRoot = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const THREE = readFixture("oriten-3items-tamagawa-r01.txt"); // 05 多摩川（一周・まわり足・直線）
const TWO = readFixture("oriten-2items-suminoe-r01.txt"); // 12 住之江（一周・まわり足）
const HALF = readFixture("oriten-halflap-kiryu-r01.txt"); // 01 桐生（半周ラップ・まわり足・直線）
const MISSING = readFixture("oriten-lap-missing-mikuni-r01.txt"); // 10 三国（一周が --.--）
const UNMEASURABLE = readFixture("oriten-unmeasurable-shimonoseki-r06.txt"); // 19 下関（計測不可）
const MST = readFixture("mst-suminoe-12.txt");
const HTML_ERROR = `<!doctype html>\n<html lang="ja">\n<head><title>エラーが発生しました | BOATCAST</title></head></html>\n`;

// ---------------------------------------------------------------------------
// (a) 解析と (b) 行の組み立て・公開マップ を、差し替え可能なモジュールに対して評価する（変異検証で、壊した版にも同じ評価をかける）
// ---------------------------------------------------------------------------
/** @returns {string[]} 失敗した項目のラベル */
function evaluateParser(m) {
  const failed = [];
  const expect = (label, pass) => {
    if (!pass) failed.push(label);
  };
  const three = m.parseOritenText(THREE);
  expect(
    "3項目: status=measured・計測あり",
    three.status === "measured" && three.measureFlag === 1,
  );
  expect(
    "3項目: 項目名は空白（全角スペース）を除く（一　周→一周、直　線→直線）",
    same(three.labels, ["一周", "まわり足", "直線"]),
  );
  expect(
    "3項目: 6艇・艇番順・値",
    three.rows.length === 6 &&
      same(
        three.rows.map((r) => r.boatNumber),
        [1, 2, 3, 4, 5, 6],
      ) &&
      same(three.rows[0].values, [37.24, 6.04, 6.8]),
  );
  expect(
    "選手名の空白（全角スペース）を除く",
    three.rows[0].racerName === "長尾章平",
  );
  const two = m.parseOritenText(TWO);
  expect(
    "2項目（直線なし）: 項目名で解釈する",
    same(two.labels, ["一周", "まわり足"]) &&
      same(two.rows[0].values, [37.47, 11.51]),
  );
  const half = m.parseOritenText(HALF);
  expect(
    "半周ラップ: 一周ではなく半周ラップとして解釈する",
    same(half.labels, ["半周ラップ", "まわり足", "直線"]) &&
      half.rows[0].values[0] === 18.91,
  );
  const missing = m.parseOritenText(MISSING);
  expect(
    "欠測（--.--）は null。他の項目の値は読める",
    missing.status === "measured" &&
      missing.rows.every((r) => r.values[0] === null && r.values[1] !== null),
  );
  const unmeasurable = m.parseOritenText(UNMEASURABLE);
  expect(
    "計測不可（状態2）: 項目名のみ・選手の行なし",
    unmeasurable.status === "unmeasurable" &&
      unmeasurable.measureFlag === 2 &&
      unmeasurable.rows.length === 0 &&
      unmeasurable.labels.length === 3,
  );
  // 位置ではなくラベル: 項目の順序が違っても、ラベルに対応した値になる
  const reordered = m.parseOritenText(
    "data=\n1\t3\n直　線\t一　周\tまわり足\n1\t選手　　名\t7.00\t37.00\t5.50\n",
  );
  expect(
    "項目の順序が違っても、ラベルで対応する（位置に依存しない）",
    same(reordered.labels, ["直線", "一周", "まわり足"]) &&
      same(reordered.rows[0].values, [7, 37, 5.5]),
  );
  // 未知のラベル
  const unknown = m.parseOritenText(
    "data=\n1\t2\n一　周\tフライング\n1\t選手　　名\t37.00\t1.23\n",
  );
  expect(
    "未知の項目名は unknownLabels に出し、値は読む（取りこぼさない）",
    same(unknown.unknownLabels, ["フライング"]) &&
      unknown.status === "measured" &&
      same(unknown.rows[0].values, [37, 1.23]),
  );
  // 構造の異常
  const bad = (label, text, needle) => {
    const p = m.parseOritenText(text);
    expect(
      `異常: ${label}`,
      p.status === "unrecognized" &&
        p.anomalies.length > 0 &&
        (needle === undefined || p.anomalies.join(" ").includes(needle)),
    );
  };
  bad("HTMLのエラーページ（先頭が data= ではない）", HTML_ERROR, "data=");
  bad("空", "");
  bad("計測状態の行が壊れている", "data=\nx\ty\n一　周\n");
  bad("計測状態が1・2以外", "data=\n3\t1\n一　周\n1\t選手\t37.00\n");
  bad(
    "項目名の数が項目数と違う",
    "data=\n1\t3\n一　周\tまわり足\n1\t選手\t37.00\t5.00\t7.00\n",
  );
  bad("項目名が重複", "data=\n1\t2\n一　周\t一　周\n1\t選手\t37.00\t37.00\n");
  bad(
    "選手の行の列数が違う",
    "data=\n1\t2\n一　周\tまわり足\n1\t選手\t37.00\n",
    "列数",
  );
  bad(
    "値が数値でも欠測でもない",
    "data=\n1\t1\n一　周\n1\t選手\tabc\n",
    "数値",
  );
  bad("枠番が範囲外", "data=\n1\t1\n一　周\n7\t選手\t37.00\n", "枠番");
  bad(
    "枠番が重複",
    "data=\n1\t1\n一　周\n1\t選手\t37.00\n1\t選手\t37.10\n",
    "重複",
  );
  bad("計測ありなのに選手の行がない", "data=\n1\t1\n一　周\n", "選手の行");
  bad(
    "計測不可なのに選手の行がある",
    "data=\n2\t1\n一　周\n1\t選手\t37.00\n",
    "計測不可",
  );
  // 改行コード・末尾の改行
  const crlf = m.parseOritenText(THREE.replace(/\n/g, "\r\n"));
  expect(
    "CRLF でも解析できる",
    crlf.status === "measured" && crlf.rows.length === 6,
  );
  // bc_mst
  expect(
    "bc_mst: YYYYMMDD → YYYY-MM-DD",
    m.parseMotorStartDate(MST) === "2026-03-23" &&
      m.parseMotorStartDate("20260806") === "2026-08-06",
  );
  expect(
    "bc_mst: 不正な日付・HTMLは null",
    m.parseMotorStartDate("20261340") === null &&
      m.parseMotorStartDate("20260231") === null &&
      m.parseMotorStartDate(HTML_ERROR) === null &&
      m.parseMotorStartDate("") === null &&
      m.parseMotorStartDate("2026-03-23") === null,
  );
  return failed;
}

function evaluateRows(mRows, mParser) {
  const failed = [];
  const expect = (label, pass) => {
    if (!pass) failed.push(label);
  };
  const RID = "2026-09-21-05-01";
  const three = mParser.parseOritenText(THREE);
  const built = mRows.buildOritenRows(three, {
    raceId: RID,
    lastModified: "Mon, 21 Sep 2026 01:16:32 GMT",
  });
  expect(
    "行: 6艇×3項目=18行の縦持ち",
    built.values.length === 18 &&
      built.values.every((v) => v.race_id === RID) &&
      built.values.filter((v) => v.kind === "一周").length === 6,
  );
  expect(
    "行: 艇1の値（項目名で対応）",
    same(
      built.values
        .filter((v) => v.boat_number === 1)
        .map((v) => [v.kind, v.value]),
      [
        ["一周", 37.24],
        ["まわり足", 6.04],
        ["直線", 6.8],
      ],
    ),
  );
  expect(
    "レース単位の行: 状態・項目数・項目名・ハッシュ・公開時刻（Last-Modified）",
    built.report.measure_status === 1 &&
      built.report.item_count === 3 &&
      built.report.item_labels === "一周|まわり足|直線" &&
      built.report.content_hash.length === 64 &&
      built.report.source_last_modified === "2026-09-21T01:16:32.000Z" &&
      built.report.parser_version === three.parserVersion,
  );
  const missing = mRows.buildOritenRows(mParser.parseOritenText(MISSING), {
    raceId: RID,
  });
  expect(
    "欠測は value=null の行として残す（行は存在する）",
    missing.values.length === 18 &&
      missing.values
        .filter((v) => v.kind === "一周")
        .every((v) => v.value === null),
  );
  const unmeasurable = mRows.buildOritenRows(
    mParser.parseOritenText(UNMEASURABLE),
    { raceId: RID },
  );
  expect(
    "計測不可: 値の行なし・状態2のレース単位の行だけ",
    unmeasurable.values.length === 0 &&
      unmeasurable.report.measure_status === 2,
  );
  expect(
    "想定外の構造は行を作らない",
    mRows.buildOritenRows(mParser.parseOritenText(HTML_ERROR), {
      raceId: RID,
    }) === null,
  );
  expect(
    "Last-Modified が無い・不正なら null",
    mRows.buildOritenRows(three, { raceId: RID }).report
      .source_last_modified === null &&
      mRows.parseLastModified("不正") === null,
  );
  // ハッシュ
  const h = (text) => mRows.computeOritenHash(mParser.parseOritenText(text));
  expect(
    "ハッシュ: 同じ内容は同じ",
    h(THREE) === h(THREE.replace(/\n/g, "\r\n")),
  );
  expect(
    "ハッシュ: 選手名の表記が変わっても変わらない（保存しないため）",
    h(THREE) === h(THREE.replace("長尾　　章平", "長尾　　彰平")),
  );
  expect(
    "ハッシュ: 値が変わると変わる",
    h(THREE) !== h(THREE.replace("37.24", "37.25")),
  );
  expect(
    "ハッシュ: 欠測と値ありは違う",
    h(MISSING) !== h(MISSING.replace("--.--", "37.00")),
  );
  // 公開マップとの照合
  const cmp = mRows.compareLabelsToMap(
    ["一周", "まわり足", "フライング"],
    ["一周", "まわり足", "直線"],
  );
  expect(
    "マップとの照合: マップに無い項目名・ファイルに無い項目名",
    same(cmp, { unexpected: ["フライング"], missing: ["直線"] }) &&
      same(mRows.compareLabelsToMap(["直線", "一周"], ["一周", "直線"]), {
        unexpected: [],
        missing: [],
      }),
  );
  // 403の再試行の判断
  const d = mRows.decideNotPublished;
  expect(
    "403: 発走8分前（1回目）→ 5分後に再試行、3分前（2回目）→ 8分後、-5分（3回目）→ 打ち切り",
    same(d(8), { final: false, retrySec: 300 }) &&
      same(d(5), { final: false, retrySec: 300 }) &&
      same(d(3), { final: false, retrySec: 480 }) &&
      same(d(0), { final: false, retrySec: 480 }) &&
      same(d(-3.9), { final: false, retrySec: 480 }) &&
      same(d(-4), { final: true }) &&
      same(d(-7), { final: true }),
  );
  expect(
    "403: 発走時刻が不明・過去日（バックフィル）は、打ち切り（待たない）",
    same(d(undefined), { final: true }) &&
      same(d(Number.NEGATIVE_INFINITY), { final: true }) &&
      same(d(NaN), { final: true }),
  );
  // 通常の進行で、取得は最大3回
  {
    let m = 8; // 1回目: 発走の8分前
    let attempts = 1;
    for (;;) {
      const r = d(m);
      if (r.final) break;
      m -= r.retrySec / 60;
      attempts++;
      if (attempts > 6) break;
    }
    expect(
      `403の通常の進行（8分前から）は最大3回で打ち切り（実際: ${attempts}回）`,
      attempts === 3,
    );
  }
  return failed;
}

function evaluateMap() {
  const failed = [];
  const expect = (label, pass) => {
    if (!pass) failed.push(label);
  };
  const codes = Object.keys(ORITEN_PUBLIC_MAP).sort();
  expect("公開マップは全24会場を持つ", same(codes, [...ALL_VENUE_CODES]));
  expect(
    "対象は23会場（江戸川(03)は常時403で対象外・excluded）",
    publicVenueCodes().length === 23 &&
      !isPublicVenue("03") &&
      ORITEN_PUBLIC_MAP["03"].status === "excluded" &&
      ORITEN_PUBLIC_MAP["03"].items.length === 0,
  );
  expect(
    "住之江・尼崎・徳山は直線なしの2項目、桐生は半周ラップ、他は3項目",
    ["12", "13", "18"].every((c) => ORITEN_PUBLIC_MAP[c].items.length === 2) &&
      ORITEN_PUBLIC_MAP["01"].items[0] === "半周ラップ" &&
      publicVenueCodes()
        .filter((c) => !["12", "13", "18"].includes(c))
        .every((c) => ORITEN_PUBLIC_MAP[c].items.length === 3),
  );
  expect(
    "期待件数 = 艇数 × 項目数（3項目会場=18、2項目会場=12、対象外=0）",
    expectedValueRows("05") === 18 &&
      expectedValueRows("12") === 12 &&
      expectedValueRows("03") === 0 &&
      expectedValueRows("99") === 0,
  );
  // フィクスチャの項目名が、マップと一致する（マップは観測した実ファイルに基づく）
  const fx = [
    ["05", THREE],
    ["12", TWO],
    ["01", HALF],
    ["10", MISSING],
    ["19", UNMEASURABLE],
  ];
  for (const [jo, text] of fx) {
    const p = realParser.parseOritenText(text);
    expect(
      `フィクスチャ(${jo})の項目名がマップと一致する`,
      same(p.labels, ORITEN_PUBLIC_MAP[jo].items),
    );
  }
  return failed;
}

for (const [label, failed] of [
  ["(a) 解析", evaluateParser(realParser)],
  ["(b) 行の組み立て・403の判断", evaluateRows(realRows, realParser)],
  ["(b) 公開マップ", evaluateMap()],
]) {
  check(`${label}: 全項目が通る`, failed.length === 0, failed.join(" / "));
}

// ---------------------------------------------------------------------------
// 共通の部品: 偽の取得・偽のクライアント
// ---------------------------------------------------------------------------
const RACE_ID = "2026-09-21-05-01";
const RACE = {
  race_id: RACE_ID,
  race_date: "2026-09-21",
  start_time: "10:30:00",
};

/** URL → 応答 の偽の fetch（ctx.politeFetch の代わり）。呼び出しのURLを記録する */
function createFakeFetch(router) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const r = await router(url);
    return new Response(r.body ?? null, {
      status: r.status,
      headers: r.lastModified ? { "last-modified": r.lastModified } : {},
    });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}
const OK_MST = { status: 200, body: "20260323\n" };
const FORBIDDEN = { status: 403, body: HTML_ERROR };
/** カナリアは正常、オリジナル展示は body を返す */
const routeOriten = (oritenResponse) => (url) =>
  url === CANARY_URL ? OK_MST : oritenResponse(url);

const fetchTextOf = (fetchImpl) => async (url) => {
  const { fetchBoatcast } = await import("../lib/boatcast/boatcastClient.js");
  return fetchBoatcast(url, { fetchImpl, pacer: { wait: async () => {} } });
};

function freshClient(extra = {}) {
  const c = createFakeSupabaseClient({
    tables: {
      races: [RACE],
      race_original_exhibition: [],
      race_original_exhibition_values: [],
      scrape_slots: [],
      ...extra,
    },
  });
  clearBoatcastSchemaCache(c);
  return c;
}
/** 指定したテーブルが無い（PGRST205）DBのふりをする */
function withMissingTables(client, tables) {
  return {
    ...client,
    from(table) {
      if (!tables.includes(table)) return client.from(table);
      const err = {
        data: null,
        error: {
          code: "PGRST205",
          message: `Could not find the table 'public.${table}' in the schema cache`,
        },
      };
      const b = {
        select: () => b,
        limit: () => b,
        eq: () => b,
        maybeSingle: () => b,
        upsert: () => b,
        delete: () => b,
        then: (resolve, reject) => Promise.resolve(err).then(resolve, reject),
      };
      return b;
    },
  };
}
const orderOf = (client) =>
  client.writes.filter((w) => w.op === "upsert").map((w) => w.table);

// ---------------------------------------------------------------------------
// (c) 取得ジョブ
// ---------------------------------------------------------------------------
/** 取得ジョブの評価（変異検証で、壊した版にも同じ評価をかける） */
async function evaluateJob(processFn) {
  const failed = [];
  const expect = (label, pass) => {
    if (!pass) failed.push(label);
  };
  const go = (over = {}) =>
    processFn({
      raceId: RACE_ID,
      race: RACE,
      mode: "live",
      minutesToStart: 8,
      client: over.client ?? freshClient(),
      fetchText: fetchTextOf(
        createFakeFetch(
          routeOriten(() => ({
            status: 200,
            body: THREE,
            lastModified: "Mon, 21 Sep 2026 01:16:32 GMT",
          })),
        ),
      ),
      ...over,
    });

  // shadow
  {
    const client = freshClient();
    const r = await go({ mode: "shadow", client });
    expect(
      "shadow: 何も書かず、resultDigest・件数を返す",
      r.outcome === "ok" &&
        r.rowsWritten === 0 &&
        r.resultDigest?.length === 64 &&
        r.rowsParsed === 18 &&
        r.rowsExpected === 18 &&
        client.writes.length === 0,
    );
  }
  // live
  {
    const client = freshClient();
    const r = await go({ client });
    expect(
      "live: ok。値18行＋レース単位1行を書く",
      r.outcome === "ok" &&
        r.rowsWritten === 19 &&
        client.data.race_original_exhibition_values.length === 18 &&
        client.data.race_original_exhibition.length === 1,
    );
    expect(
      "書く順序: 値 → レース単位の行（レース単位の行が「完了」の目印）",
      same(orderOf(client), [
        "race_original_exhibition_values",
        "race_original_exhibition",
      ]),
    );
    const rep = client.data.race_original_exhibition[0];
    expect(
      "レース単位の行: 状態・ハッシュ・公開時刻・更新時刻",
      rep.measure_status === 1 &&
        rep.content_hash === r.resultDigest &&
        rep.source_last_modified === "2026-09-21T01:16:32.000Z" &&
        typeof rep.updated_at === "string",
    );
    // 冪等: 同じ内容の再取得は書かない
    const before = client.writes.length;
    const again = await go({ client });
    expect(
      "同じ内容の再取得は何も書かない（rowsWritten=0・書き込みの呼び出しなし）",
      again.outcome === "ok" &&
        again.rowsWritten === 0 &&
        client.writes.length === before,
    );
    // 内容が変わったら書き直す（1艇の1項目だけが変わる）
    const changed = await go({
      client,
      fetchText: fetchTextOf(
        createFakeFetch(
          routeOriten(() => ({
            status: 200,
            body: THREE.replace("37.24", "37.30"),
          })),
        ),
      ),
    });
    const row = client.data.race_original_exhibition_values.find(
      (v) => v.boat_number === 1 && v.kind === "一周",
    );
    expect(
      "内容が変わったら書き直す（変わった行だけ）",
      changed.outcome === "ok" &&
        row.value === 37.3 &&
        changed.rowsWritten === 2,
      `written=${changed.rowsWritten} value=${row?.value}`,
    );
  }
  // 項目が減った（艇×項目の行を残さない）
  {
    const client = freshClient();
    await go({ client });
    await go({
      client,
      fetchText: fetchTextOf(
        createFakeFetch(routeOriten(() => ({ status: 200, body: TWO }))),
      ),
      raceId: RACE_ID,
    });
    const kinds = new Set(
      client.data.race_original_exhibition_values.map((v) => v.kind),
    );
    expect(
      "新しい内容に無い項目（直線）の古い行は消す",
      !kinds.has("直線") &&
        client.data.race_original_exhibition_values.length === 12,
      show([...kinds]),
    );
  }
  // 計測不可
  {
    const client = freshClient();
    const r = await go({
      client,
      fetchText: fetchTextOf(
        createFakeFetch(
          routeOriten(() => ({ status: 200, body: UNMEASURABLE })),
        ),
      ),
    });
    expect(
      "計測不可: ok（0件エラーにしない）。レース単位の行のみ書く",
      r.outcome === "ok" &&
        r.rowsExpected === 0 &&
        r.rowsParsed === 0 &&
        client.data.race_original_exhibition[0].measure_status === 2 &&
        client.data.race_original_exhibition_values.length === 0,
    );
  }
  // 未知の項目名: 値は保存し、warnings で通知する
  {
    const client = freshClient();
    const body =
      "data=\n1\t2\n一　周\tフライング\n1\t選手　　名\t37.00\t1.23\n";
    const r = await go({
      client,
      fetchText: fetchTextOf(
        createFakeFetch(routeOriten(() => ({ status: 200, body }))),
      ),
    });
    expect(
      "未知の項目名: 保存し（取りこぼさない）、warnings に出す",
      r.outcome === "ok" &&
        client.data.race_original_exhibition_values.some(
          (v) => v.kind === "フライング",
        ) &&
        r.warnings.some((w) => w.includes("フライング")),
      show(r.warnings),
    );
  }
  // マップと項目名が違う会場（住之江の想定は2項目。3項目のファイル）
  {
    const client = freshClient({
      races: [
        {
          race_id: "2026-09-21-12-01",
          race_date: "2026-09-21",
          start_time: "15:19:00",
        },
      ],
    });
    const r = await go({ client, raceId: "2026-09-21-12-01", mode: "shadow" });
    expect(
      "公開マップと項目名が違う: 保存は続け、warnings に出す",
      r.outcome === "ok" &&
        r.warnings.some((w) => w.includes("公開マップと項目名が違います")),
      show(r.warnings),
    );
  }
  // 未適用のDB
  {
    const client = withMissingTables(freshClient(), [
      "race_original_exhibition",
      "race_original_exhibition_values",
    ]);
    clearBoatcastSchemaCache(client);
    const r = await go({ client });
    expect(
      "091が未適用のDB: 書かず error（成功にしない。理由を残す）",
      r.outcome === "error" && /091/.test(r.error),
    );
    const s = await go({ client, mode: "shadow" });
    expect(
      "091が未適用でも shadow は動く（取得・解析のみ）",
      s.outcome === "ok",
    );
  }
  // 構造の異常
  {
    const client = freshClient();
    const r = await go({
      client,
      fetchText: fetchTextOf(
        createFakeFetch(routeOriten(() => ({ status: 200, body: HTML_ERROR }))),
      ),
    });
    expect(
      "200でHTML（構造の変化）: 書かず error（parse_anomaly）",
      r.outcome === "error" &&
        /^parse_anomaly/.test(r.error) &&
        r.anomalies.length > 0 &&
        client.writes.length === 0,
    );
  }
  // HTTPエラー
  for (const status of [404, 500, 503, 429]) {
    const client = freshClient();
    const r = await go({
      client,
      fetchText: fetchTextOf(
        createFakeFetch(routeOriten(() => ({ status, body: "x" }))),
      ),
    });
    expect(
      `HTTP ${status}: 書かず error（403と混同しない。再試行）`,
      r.outcome === "error" &&
        r.error.includes(String(status)) &&
        client.writes.length === 0,
    );
  }
  // 403（カナリアは呼び出し側が確認済み）
  {
    const f403 = fetchTextOf(createFakeFetch(routeOriten(() => FORBIDDEN)));
    const first = await go({ fetchText: f403, minutesToStart: 8 });
    expect(
      "403（発走8分前）: no_values・5分後に再試行（データ無しにしない）",
      first.outcome === "no_values" &&
        first.retrySec === 300 &&
        first.rowsWritten === 0,
      show(first),
    );
    const second = await go({ fetchText: f403, minutesToStart: 3 });
    expect(
      "403（発走3分前）: no_values・8分後に再試行",
      second.outcome === "no_values" && second.retrySec === 480,
    );
    const third = await go({ fetchText: f403, minutesToStart: -5 });
    expect(
      "403（発走の5分後）: 打ち切り（skipped_not_target・noData）",
      third.outcome === "skipped_not_target" &&
        third.noData === true &&
        third.rowsWritten === 0,
    );
    const past = await go({ fetchText: f403, minutesToStart: undefined });
    expect(
      "403（発走時刻が不明）: 打ち切り（待たない）",
      past.outcome === "skipped_not_target",
    );
  }
  // マップ外の会場（江戸川）は取得しない
  {
    const fetchImpl = createFakeFetch(
      routeOriten(() => ({ status: 200, body: THREE })),
    );
    const r = await go({
      raceId: "2026-09-21-03-01",
      race: {
        race_id: "2026-09-21-03-01",
        race_date: "2026-09-21",
        start_time: "10:00:00",
      },
      fetchText: fetchTextOf(fetchImpl),
    });
    expect(
      "公開マップ外の会場（江戸川）: 取得せず（リクエスト0）、打ち切り",
      r.outcome === "skipped_not_target" && fetchImpl.calls.length === 0,
    );
  }
  // 未確認の会場（実ファイルを確認できていない）は、別扱い: 取得せず、スロットも期待件数の分母にも入れない
  {
    const map = {
      ...ORITEN_PUBLIC_MAP,
      19: { name: "下関", status: "unconfirmed", items: [] },
    };
    const fetchImpl = createFakeFetch(
      routeOriten(() => ({ status: 200, body: THREE })),
    );
    const r = await go({
      raceId: "2026-09-21-19-01",
      race: {
        race_id: "2026-09-21-19-01",
        race_date: "2026-09-21",
        start_time: "10:00:00",
      },
      map,
      fetchText: fetchTextOf(fetchImpl),
    });
    expect(
      "未確認の会場: 取得せず（リクエスト0）・期待件数0・対象会場の一覧に入れない",
      r.outcome === "skipped_not_target" &&
        fetchImpl.calls.length === 0 &&
        expectedValueRows("19", 6, map) === 0 &&
        !publicVenueCodes(map).includes("19"),
    );
  }
  // races に行が無い
  {
    const r = await go({ race: null });
    expect("races に行が無い: error", r.outcome === "error");
  }
  return failed;
}
check(
  "(c) 取得ジョブ: shadow/live・冪等・順序・未適用・異常・HTTPエラー・403・マップ外の評価がすべて通る",
  await (async () => {
    const failed = await evaluateJob(realJob.processOritenRace);
    if (failed.length > 0) out.error(failed.join("\n"));
    return failed.length === 0;
  })(),
);

// ---------------------------------------------------------------------------
// (d) 共通ラッパ・403の扱い・リクエストの間隔
// ---------------------------------------------------------------------------
const SLOT = (raceId, extra = {}) => ({
  job: realJob.ORITEN_JOB,
  race_id: raceId,
  offset_min: -8,
  lease_until: new Date(Date.now() + 60000).toISOString(),
  attempts: 1,
  last_attempt_at: "2026-09-21T10:22:30+09:00",
  ...extra,
});
const NOW = () => new Date("2026-09-21T10:22:40+09:00"); // 発走(10:30)の約7分前
const noWaitPacer = { wait: async () => {} };

async function runWrapped({
  mode,
  rows,
  client,
  fetchImpl,
  slots,
  handlerOptions = {},
  now = NOW,
}) {
  realJob.clearTicks();
  const memory = createMemoryStore({
    rows: rows ?? {
      [realJob.ORITEN_JOB]: {
        job: realJob.ORITEN_JOB,
        mode,
        consecutive_failures: 0,
      },
    },
    slots: slots ?? [SLOT(RACE_ID)],
  });
  const store = realJob.createOritenStore(client, {
    base: memory,
    // 全て失敗した起動の last_report は、共通ラッパを経由せず直接書く（本番は scrape_job_state の update）。テストではメモリのストアへ
    saveReport: async (job, report) => {
      memory.state.get(job).last_report = report;
    },
  });
  const result = await runScrapeJob({
    job: realJob.ORITEN_JOB,
    store,
    handleSlot: realJob.createOritenSlotHandler({
      pacer: noWaitPacer,
      venueNoData: async () => null,
      ...handlerOptions,
    }),
    now,
    client,
    modeGated: true,
    politeFetch: fetchImpl,
  });
  return { result, store: memory };
}
{
  const client = freshClient();
  const oriten = () => ({
    status: 200,
    body: THREE,
    lastModified: "Mon, 21 Sep 2026 01:16:32 GMT",
  });
  const f0 = createFakeFetch(routeOriten(oriten));
  const off = await runWrapped({ mode: "off", client, fetchImpl: f0 });
  check(
    "(d) off: 何も取得せず、DBにも予定表にも書かない",
    off.result.body.skipped === "mode_off" &&
      f0.calls.length === 0 &&
      client.writes.length === 0 &&
      off.store.completed.length === 0,
  );
  const noRow = await runWrapped({ rows: {}, client, fetchImpl: f0 });
  check(
    "(d) 行なし: off として扱い、何も取得しない（行を作るのみ）",
    noRow.result.body.skipped === "mode_off" &&
      f0.calls.length === 0 &&
      noRow.store.state.get(realJob.ORITEN_JOB)?.mode === "off",
  );

  const f1 = createFakeFetch(routeOriten(oriten));
  const shadow = await runWrapped({ mode: "shadow", client, fetchImpl: f1 });
  check(
    "(d) shadow: 取得・解析のみ。データには書かず、予定表に result_digest を残す。カナリア→オリジナル展示の順に2リクエスト",
    same(f1.calls, [CANARY_URL, buildOritenUrl(RACE_ID)]) &&
      client.writes.length === 0 &&
      shadow.store.completed.length === 1 &&
      shadow.store.completed[0].outcome === "ok" &&
      shadow.store.completed[0].resultDigest?.length === 64,
    show(f1.calls),
  );
  const f2 = createFakeFetch(routeOriten(oriten));
  const live = await runWrapped({ mode: "live", client, fetchImpl: f2 });
  check(
    "(d) live: 書き込み、予定表を完了にする",
    client.data.race_original_exhibition_values.length === 18 &&
      live.store.completed.length === 1 &&
      live.store.completed[0].rowsWritten === 19,
  );
}
{
  // カナリア: 各tickの先頭で1回だけ。複数スロットでも1回
  const client = freshClient({
    races: ["05", "06", "12"].map((jo) => ({
      race_id: `2026-09-21-${jo}-01`,
      race_date: "2026-09-21",
      start_time: "10:30:00",
    })),
  });
  const fetchImpl = createFakeFetch(
    routeOriten(() => ({ status: 200, body: THREE })),
  );
  const { store } = await runWrapped({
    mode: "shadow",
    client,
    fetchImpl,
    slots: ["05", "06", "12"].map((jo) => SLOT(`2026-09-21-${jo}-01`)),
  });
  check(
    "(d) カナリア: 複数スロットでも、tickの先頭で1回だけ（最初のリクエストがカナリア）",
    fetchImpl.calls.filter((u) => u === CANARY_URL).length === 1 &&
      fetchImpl.calls[0] === CANARY_URL &&
      fetchImpl.calls.length === 4 &&
      store.completed.length === 3,
    show(fetchImpl.calls),
  );
}
{
  // カナリアが403: データを取らず、全スロットが error（データ無しにしない）。alerts に出す。連続失敗で監視が通知
  const client = freshClient();
  const fetchImpl = createFakeFetch(() => FORBIDDEN);
  const { result, store } = await runWrapped({
    mode: "live",
    client,
    fetchImpl,
  });
  const state = store.state.get(realJob.ORITEN_JOB);
  check(
    "(d) カナリアが403: データを取らない（リクエストはカナリアの1件のみ）。スロットは error で再試行（打ち切りにしない）",
    same(fetchImpl.calls, [CANARY_URL]) &&
      store.retried.length === 1 &&
      store.retried[0].outcome === "error" &&
      /canary_failed/.test(store.retried[0].error) &&
      store.completed.length === 0 &&
      result.status === 500,
    show({
      calls: fetchImpl.calls,
      retried: store.retried.map((r) => r.outcome),
    }),
  );
  check(
    "(d) カナリアが403: last_report.alerts に canary_failed（until付き）。連続失敗も記録される",
    state.last_report?.alerts?.some(
      (a) =>
        a.key === "canary_failed" && a.until && a.text.includes("カナリア"),
    ) && state.consecutive_failures === 1,
    show(state.last_report),
  );
  // 監視が、last_report.alerts を通知する
  const alerts = evaluateJobStates(
    [
      {
        job: realJob.ORITEN_JOB,
        mode: "live",
        ...state,
        last_tick_at: NOW().toISOString(),
      },
    ],
    NOW(),
  );
  check(
    "(d) 監視: canary_failed が job_report として通知される",
    alerts.some(
      (a) => a.kind === "job_report" && a.key.endsWith("canary_failed"),
    ),
    show(alerts),
  );
  // カナリアが本文不正（200だがYYYYMMDDでない）・ネットワークエラーも失敗
  const bodyBad = await checkCanary({
    fetchImpl: createFakeFetch(() => ({ status: 200, body: HTML_ERROR })),
    pacer: noWaitPacer,
  });
  const netErr = await checkCanary({
    fetchImpl: async () => {
      throw new Error("ECONNRESET");
    },
    pacer: noWaitPacer,
  });
  const okCanary = await checkCanary({
    fetchImpl: createFakeFetch(() => OK_MST),
    pacer: noWaitPacer,
  });
  check(
    "(d) カナリア判定: 200＋YYYYMMDD だけが ok（403・本文不正・ネットワークエラーは失敗）",
    okCanary.ok && !bodyBad.ok && !netErr.ok && netErr.status === null,
  );
}
{
  // ブレーカーが開いている（politeFetch が BreakerOpenError を投げる）: カナリアの失敗として通知せず、breaker_open で再試行する
  const client = freshClient();
  const until = new Date("2026-09-21T10:24:00+09:00").getTime();
  const { result, store } = await runWrapped({
    mode: "live",
    client,
    fetchImpl: async () => {
      throw new BreakerOpenError("host:race.boatcast.jp", until);
    },
  });
  const state = store.state.get(realJob.ORITEN_JOB);
  check(
    "(d) ブレーカーが開いている: canary_failed の通知を出さず、breaker_open で再試行する（ブレーカーが閉じる頃まで）",
    store.retried.length === 1 &&
      store.retried[0].outcome === "breaker_open" &&
      new Date(store.retried[0].retryAt).getTime() === until &&
      !state.last_report?.alerts?.some((a) => a.key === "canary_failed") &&
      result.status === 200,
    show({
      retried: store.retried.map((r) => r.outcome),
      report: state.last_report,
    }),
  );
}
{
  // カナリアが正常で、データが403: 未公開（再試行）→ 打ち切り
  const client = freshClient();
  const f403 = createFakeFetch(routeOriten(() => FORBIDDEN));
  const early = await runWrapped({ mode: "live", client, fetchImpl: f403 });
  const claimedMs = new Date("2026-09-21T10:22:30+09:00").getTime();
  check(
    "(d) 403（カナリア正常）: 発走の約7分前 → no_values で再試行（claimから290秒後）",
    early.store.retried.length === 1 &&
      early.store.retried[0].outcome === "no_values" &&
      new Date(early.store.retried[0].retryAt).getTime() ===
        claimedMs + 290 * 1000 &&
      early.store.completed.length === 0,
    show(early.store.retried.map((r) => [r.outcome, r.retryAt])),
  );
  const late = await runWrapped({
    mode: "live",
    client,
    fetchImpl: createFakeFetch(routeOriten(() => FORBIDDEN)),
    now: () => new Date("2026-09-21T10:36:00+09:00"),
  });
  check(
    "(d) 403（カナリア正常）: 発走の6分後 → 打ち切り（skipped_not_target で完了。予定表の expired にしない）",
    late.store.completed.length === 1 &&
      late.store.completed[0].outcome === "skipped_not_target",
    show(late.store.completed.map((c) => c.outcome)),
  );
  const stats = computeWindowStats([
    ...[
      ["ok", "2026-09-21T01:23:00Z"],
      ["skipped_not_target", "2026-09-21T01:36:00Z"],
    ].map(([outcome, doneAt]) => ({
      job: realJob.ORITEN_JOB,
      race_id: "r",
      offset_min: -8,
      race_date: "2026-09-21",
      status: "done",
      outcome,
      run_mode: "live",
      done_at: doneAt,
      races: { start_time: "10:30:00", cancellation_status: null },
    })),
  ]);
  check(
    "(d) 監視: 打ち切り（skipped_not_target）は窓内取得率の分母に入れない",
    stats.length === 1 && stats[0].total === 1,
  );
}
{
  // リクエストの間隔（2.2秒以上）
  let t = 0;
  const sleeps = [];
  const pacer = createPacer({
    minIntervalMs: BOATCAST_MIN_INTERVAL_MS,
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
  });
  const started = [];
  for (let i = 0; i < 4; i++) {
    await pacer.wait();
    started.push(t);
    t += 100; // リクエスト自体の所要時間
  }
  const gaps = started.slice(1).map((s, i) => s - started[i]);
  check(
    "(d) リクエストの間隔は、直前の開始から2.2秒以上（調査時と同じ2秒に余裕）",
    BOATCAST_MIN_INTERVAL_MS >= 2200 && gaps.every((g) => g >= 2200),
    show(gaps),
  );
  // 並行して呼んでも、順番に間隔を空ける（仮想の時計。実時間・実タイマーには依存しない → 負荷でぶれない）
  const clock = createVirtualClock();
  const p2 = createPacer({
    minIntervalMs: 30,
    now: clock.now,
    sleep: clock.sleep,
  });
  const starts = [];
  const concurrent = Promise.all(
    [0, 1, 2].map(async () => {
      await p2.wait();
      starts.push(clock.now());
    }),
  );
  await clock.runAll();
  await concurrent;
  check(
    "(d) 並行して呼んでも、全て間隔以上ずつ空く（順番に通す）",
    starts.length === 3 && starts.slice(1).every((x, k) => x - starts[k] >= 30),
    show(starts),
  );
  check(
    "(d) URLの組み立て: txt/{jo}/bc_oriten_{日}_{jo}_{rr}.txt、モーター使用開始日は hp_txt/（txt/ は403）",
    buildOritenUrl("2026-09-21-05-01") ===
      "https://race.boatcast.jp/txt/05/bc_oriten_20260921_05_01.txt" &&
      buildMotorStartUrl("12") ===
        "https://race.boatcast.jp/hp_txt/12/bc_mst_12.txt" &&
      CANARY_URL === buildMotorStartUrl("12"),
  );
}

// ---------------------------------------------------------------------------
// (e) 予定表・通知
// ---------------------------------------------------------------------------
{
  const races = [
    ["03", "10:00:00"], // 江戸川（対象外）
    ["05", "10:30:00"],
    ["12", "15:19:00"],
    ["05", "07:00:00"], // 期限+許容幅を過ぎたレース（作らない）
  ].map(([jo, start], i) => ({
    race_id: `2026-09-21-${jo}-${String(i + 1).padStart(2, "0")}`,
    race_date: "2026-09-21",
    start_time: start,
  }));
  const client = freshClient({ races });
  const store = realJob.createOritenStore(client, {
    base: createMemoryStore(),
  });
  const created = await store.ensureSlots({
    date: "2026-09-21",
    now: new Date("2026-09-21T10:00:00+09:00"),
  });
  const ids = client.data.scrape_slots.map((s) => s.race_id).sort();
  check(
    "(e) 予定表: 公開マップの対象会場のレースにだけスロットを作る（江戸川・期限+許容幅を過ぎたものは作らない）",
    created === 2 &&
      same(ids, ["2026-09-21-05-02", "2026-09-21-12-03"]) &&
      client.data.scrape_slots.every(
        (s) => s.job === realJob.ORITEN_JOB && s.offset_min === -8,
      ),
    show(ids),
  );
}
{
  const now = new Date("2026-09-21T10:30:00+09:00");
  const tick = (over) => ({
    canary: null,
    anomalies: [],
    warnings: [],
    venueAlerts: [],
    ...over,
  });
  const failedTick = tick({ canary: { ok: false, detail: "HTTP 403" } });
  const r1 = realJob.mergeReport(undefined, failedTick, now);
  check(
    "(e) 通知: カナリア失敗 → canary_failed（60分のuntil）",
    r1?.alerts.length === 1 &&
      r1.alerts[0].key === "canary_failed" &&
      new Date(r1.alerts[0].until).getTime() === now.getTime() + 60 * 60 * 1000,
  );
  const r2 = realJob.mergeReport(
    r1,
    tick({ canary: { ok: true, detail: "ok" } }),
    new Date(now.getTime() + 60000),
  );
  check(
    "(e) 通知: カナリアが正常に戻ると canary_failed を外す",
    r2?.alerts.length === 0,
    show(r2),
  );
  const r3 = realJob.mergeReport(
    undefined,
    tick({ anomalies: ["x"], warnings: ["y"] }),
    now,
  );
  check(
    "(e) 通知: parse_anomaly（構造の異常・項目名の不一致の件数と例）",
    r3?.alerts[0].key === "parse_anomaly" && /2件/.test(r3.alerts[0].text),
  );
  check(
    "(e) 通知: 変化が無ければ書かない（undefined）",
    realJob.mergeReport({ alerts: [] }, tick(), now) === undefined &&
      realJob.mergeReport(r1, tick(), new Date(now.getTime() + 1000)) ===
        undefined,
  );
  check(
    "(e) 通知: until を過ぎた前回の通知は残さない",
    realJob.mergeReport(r1, tick(), new Date(now.getTime() + 2 * 3600 * 1000))
      ?.alerts.length === 0,
  );
  const r4 = realJob.mergeReport(
    undefined,
    tick({ venueAlerts: [{ key: "no_data:10", text: "三国" }] }),
    now,
  );
  check(
    "(e) 通知: 会場のデータ無し（no_data:会場）",
    r4?.alerts[0].key === "no_data:10" && r4.alerts[0].until,
  );

  // 会場のデータ無しの閾値
  const slotRows = (n, outcome) =>
    Array.from({ length: n }, (_, i) => ({
      job: realJob.ORITEN_JOB,
      race_id: `2026-09-21-10-${String(i + 1).padStart(2, "0")}`,
      race_date: "2026-09-21",
      status: "done",
      outcome,
    }));
  const many = createFakeSupabaseClient({
    tables: {
      scrape_slots: [
        ...slotRows(2, "skipped_not_target"),
        ...slotRows(0, "ok"),
      ],
    },
  });
  const alert = await realJob.evaluateVenueNoData(many, "2026-09-21-10-12");
  const few = createFakeSupabaseClient({
    tables: {
      scrape_slots: [
        ...slotRows(1, "skipped_not_target"),
        ...slotRows(8, "ok").map((s, i) => ({
          ...s,
          race_id: `2026-09-21-10-${20 + i}`,
        })),
      ],
    },
  });
  const noAlert = await realJob.evaluateVenueNoData(few, "2026-09-21-10-12");
  check(
    "(e) 会場のデータ無し: 完了レースの半分以上・3件以上（今回を含む）で通知。1件（三国R12のような散発）では通知しない",
    alert?.key === "no_data:10" && noAlert === null,
    show({ alert, noAlert }),
  );
  // parse_anomaly が起動の通知に入る
  const client = freshClient();
  const fetchImpl = createFakeFetch(
    routeOriten(() => ({ status: 200, body: HTML_ERROR })),
  );
  const { store } = await runWrapped({ mode: "live", client, fetchImpl });
  check(
    "(e) 200でHTML（構造の変化）: スロットは error・last_report.alerts に parse_anomaly",
    store.retried[0]?.outcome === "error" &&
      store.state
        .get(realJob.ORITEN_JOB)
        .last_report?.alerts?.some((a) => a.key === "parse_anomaly"),
    show(store.state.get(realJob.ORITEN_JOB)),
  );
}

// ---------------------------------------------------------------------------
// (f) モーター使用開始日（日次）
// ---------------------------------------------------------------------------
const mstRouter =
  (over = {}) =>
  (url) => {
    const jo = /bc_mst_(\d{2})\.txt/.exec(url)?.[1];
    if (over[jo]) return over[jo];
    const n = Number(jo);
    return {
      status: 200,
      body: `2026${String((n % 12) + 1).padStart(2, "0")}15\n`,
    };
  };
{
  const f = createFakeFetch(mstRouter());
  const r = await fetchMotorStartDates({ fetchImpl: f, pacer: noWaitPacer });
  check(
    "(f) 全24会場を取得・解析する（hp_txt/{jo}/bc_mst_{jo}.txt）",
    r.rows.length === 24 &&
      r.failures.length === 0 &&
      f.calls.length === 24 &&
      f.calls.every((u) => /\/hp_txt\/\d{2}\/bc_mst_\d{2}\.txt$/.test(u)) &&
      r.rows[0].venue_code === 1 &&
      /^\d{4}-\d{2}-\d{2}$/.test(r.rows[0].start_date),
  );
  const partial = await fetchMotorStartDates({
    fetchImpl: createFakeFetch(
      mstRouter({ "07": FORBIDDEN, 15: { status: 200, body: "abc" } }),
    ),
    pacer: noWaitPacer,
  });
  check(
    "(f) 一部（403・本文不正）が失敗しても、他は取る（失敗の会場と理由を返す）",
    partial.rows.length === 22 &&
      same(
        partial.failures.map((x) => x.venue),
        ["07", "15"],
      ) &&
      !partial.aborted,
  );
  const blocked = await fetchMotorStartDates({
    fetchImpl: createFakeFetch(() => FORBIDDEN),
    pacer: noWaitPacer,
  });
  check(
    `(f) 最初から${ABORT_AFTER_CONSECUTIVE_FAILURES}件続けて失敗したら、取得を止める（アクセス拒否・接続の異常の疑い。リクエストは3件）`,
    blocked.aborted === true &&
      blocked.failures.length === 3 &&
      blocked.rows.length === 0,
  );
  const stopped = await fetchMotorStartDates({
    fetchImpl: createFakeFetch(mstRouter()),
    pacer: noWaitPacer,
    shouldStop: (() => {
      let n = 0;
      return () => ++n > 5;
    })(),
  });
  check(
    "(f) 時間切れ（ソフトデッドライン）で止まる",
    stopped.stopped === true && stopped.rows.length === 5,
  );
}
async function runDaily({ mode, client, fetchImpl, rows, targetNow }) {
  const memory = createMemoryStore({
    rows: rows ?? {
      [MOTOR_START_JOB]: {
        job: MOTOR_START_JOB,
        mode,
        consecutive_failures: 0,
      },
    },
  });
  const result = await runScrapeJob({
    job: MOTOR_START_JOB,
    store: memory,
    run: createMotorStartRun({ pacer: noWaitPacer }),
    now: () => targetNow ?? new Date("2026-09-21T06:40:00+09:00"),
    client,
    politeFetch: fetchImpl,
  });
  return { result, store: memory };
}
{
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

// ---------------------------------------------------------------------------
// (h) 配線・DDL・文書
// ---------------------------------------------------------------------------
{
  check(
    "(h) レジストリ: 整合している。boatcast_oriten は窓型（発走8分前・許容幅30分）、boatcast_motor_start は日次（06:30）",
    same(validateRegistry(), []) &&
      SCRAPE_JOBS.boatcast_oriten.kind === "window" &&
      same(SCRAPE_JOBS.boatcast_oriten.offsets, [-8]) &&
      SCRAPE_JOBS.boatcast_oriten.graceMin === 30 &&
      SCRAPE_JOBS.boatcast_oriten.concurrency === 1 &&
      SCRAPE_JOBS.boatcast_motor_start.kind === "daily" &&
      SCRAPE_JOBS.boatcast_motor_start.targetTimeJst === "06:30",
    show(validateRegistry()),
  );
  check(
    "(h) 別ホスト: hosts は race.boatcast.jp。ブレーカーのキーは host:race.boatcast.jp（boatrace.jp のブレーカーとは独立）",
    same(SCRAPE_JOBS.boatcast_oriten.hosts, ["race.boatcast.jp"]) &&
      same(SCRAPE_JOBS.boatcast_motor_start.hosts, ["race.boatcast.jp"]) &&
      hostKeyOf(CANARY_URL) === "host:race.boatcast.jp" &&
      hostKeyOf(CANARY_URL) !== hostKeyOf("https://www.boatrace.jp/"),
  );
  const vercel = JSON.parse(readRoot("vercel.json"));
  const cronOf = (p) =>
    vercel.crons.filter((c) => c.path === p).map((c) => c.schedule);
  check(
    "(h) vercel.json: boatcast-oriten は毎分（UTC 22〜23時・0〜14時 = JST 07:00〜23:59）、boatcast-motor-start は06:30・08:00 JST。api/cron の functions は syd1",
    same(cronOf("/api/cron/boatcast-oriten"), ["* 22-23,0-14 * * *"]) &&
      same(cronOf("/api/cron/boatcast-motor-start"), [
        "30 21 * * *",
        "0 23 * * *",
      ]) &&
      vercel.functions["api/cron/*.js"].regions.includes("syd1"),
    show(vercel.crons.filter((c) => /boatcast/.test(c.path))),
  );
  for (const [file, job] of [
    ["boatcast-oriten", "boatcast_oriten"],
    ["boatcast-motor-start", "boatcast_motor_start"],
  ]) {
    const src = readRoot(`api/cron/${file}.js`);
    const m = /maxDuration:\s*(\d+)/.exec(src);
    check(
      `(h) api/cron/${file}.js: maxDuration(${m?.[1]}) がレジストリの maxDurationSec(${SCRAPE_JOBS[job].maxDurationSec}) と一致し、ハンドラーをexportする`,
      m &&
        Number(m[1]) === SCRAPE_JOBS[job].maxDurationSec &&
        /export default/.test(src),
    );
  }
  check(
    "(h) 共有の politeFetch・ブレーカーは変更しない（BOATCASTの403の扱いは、ジョブ内）: politeFetch.js は 429/503 だけを再試行の対象にしている",
    /RETRYABLE_STATUSES = new Set\(\[429, 503\]\)/.test(
      readRoot("scripts/lib/scrapeJobs/politeFetch.js"),
    ) &&
      !/403/.test(
        readRoot("scripts/lib/scrapeJobs/politeFetch.js").replace(
          /\/\*[\s\S]*?\*\//g,
          "",
        ),
      ),
  );

  // DDL案とコードが書く行の一致・RLS
  const ddl = readRoot(
    "docs/db-migration/091_boatcast_original_exhibition.sql",
  );
  const body = ddl.replace(/^--.*$/gm, "");
  const columnsOf = (table) => {
    const m = new RegExp(
      `CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`,
    ).exec(body);
    return m
      ? m[1]
          .split("\n")
          .map((l) => l.trim().split(/\s+/)[0])
          .filter(
            (c) =>
              /^[a-z_]+$/.test(c) && !["PRIMARY", "CONSTRAINT"].includes(c),
          )
      : [];
  };
  const sampleRows = realRows.buildOritenRows(
    realParser.parseOritenText(THREE),
    {
      raceId: RACE_ID,
      lastModified: "Mon, 21 Sep 2026 01:16:32 GMT",
    },
  );
  const inDdl = (table, row) =>
    Object.keys(row).every((k) => columnsOf(table).includes(k));
  check(
    "(h) DDL 091: コードが書く行の列が、3表の定義に全てある（レース単位・値・使用開始日。updated_at はコードが設定）",
    inDdl("race_original_exhibition", sampleRows.report) &&
      inDdl("race_original_exhibition_values", sampleRows.values[0]) &&
      inDdl("venue_motor_start_dates", {
        venue_code: 1,
        start_date: "2026-03-23",
      }) &&
      columnsOf("race_original_exhibition").includes("updated_at") &&
      columnsOf("race_original_exhibition_values").includes("updated_at"),
    show({
      report: columnsOf("race_original_exhibition"),
      values: columnsOf("race_original_exhibition_values"),
      mst: columnsOf("venue_motor_start_dates"),
    }),
  );
  check(
    "(h) DDL 091: 主キーが (race_id, boat_number, kind)・race_id・(venue_code, start_date)。onConflict と一致する",
    /PRIMARY KEY \(race_id, boat_number, kind\)/.test(body) &&
      /race_id\s+varchar\(20\) PRIMARY KEY REFERENCES races/.test(body) &&
      /PRIMARY KEY \(venue_code, start_date\)/.test(body) &&
      readRoot("scripts/lib/boatcast/oritenJob.js").includes(
        'onConflict: "race_id,boat_number,kind"',
      ) &&
      readRoot("scripts/lib/boatcast/motorStartJob.js").includes(
        'onConflict: "venue_code,start_date"',
      ),
  );
  check(
    "(h) DDL 091: 3表ともRLS有効・anon/authenticatedの権限を剥奪・ポリシーなし・匿名のSELECTを付けない（公式コンテンツの再表示を含むため。ADR-0067）",
    [
      "race_original_exhibition",
      "race_original_exhibition_values",
      "venue_motor_start_dates",
    ].every(
      (t) =>
        new RegExp(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`).test(body) &&
        new RegExp(`REVOKE ALL ON ${t} FROM anon, authenticated`).test(body),
    ) && !/CREATE POLICY|GRANT/i.test(body),
  );
  check(
    "(h) DDL 091: 値の列は numeric(5,2)（秒）で、変更の無い行を比較する scale がコードに登録済み",
    /value\s+numeric\(5,2\)/.test(body) &&
      /race_original_exhibition_values:\s*\{\s*value:\s*2/.test(
        readRoot("scripts/lib/unchangedRows.js"),
      ),
  );
  const applied = readRoot("docs/db-migration/APPLIED.md");
  // 適用状況（適用済み/未適用）は本番の進行に伴って変わるため、ここでは
  // 「台帳に091の行があること」だけを見る。適用状況そのものを期待値に
  // 固定すると、適用が進んだ時点でこの検証が壊れる（2026-09-25、実際に
  // 091が適用済みになって失敗した）。
  check(
    "(h) 台帳: 091の行が載っている",
    /\| 091 \|[^\n]*091_boatcast_original_exhibition\.sql[^\n]*\|/.test(
      applied,
    ),
  );
  const tasks = readRoot("docs/design/scraping-vercel-consolidation/tasks.md");
  const t19 = tasks.split(/^### T4b-19 /m)[1]?.split(/^### |^---$/m)[0] ?? "";
  check(
    "(h) tasks.md: T4b-19（BOATCAST）があり、各データ項目（オリジナル展示・モーター使用開始日）に完了の定義A・B・Cの3行がある。B基準は「提案」と明記",
    t19.length > 0 &&
      (t19.match(/^- \[ \] 本番実測:/gm) ?? []).length === 2 &&
      (t19.match(/^- \[ \] タイミング実測:/gm) ?? []).length === 2 &&
      (t19.match(/^- \[ \] 継続監視:/gm) ?? []).length === 2 &&
      /提案/.test(t19),
    `len=${t19.length}`,
  );
  const runbook = readRoot(
    "docs/design/scraping-vercel-consolidation/verification-runbook.md",
  );
  check(
    "(h) runbook: 節「S. BOATCAST」に、probe・shadow・live・切り戻し・継続監視がある",
    /^## S\. BOATCAST/m.test(runbook) &&
      /probe=1/.test(runbook) &&
      /S-\d[^\n]*shadow/.test(runbook) &&
      /S-\d[^\n]*切り戻し/.test(runbook),
  );
  const adr = readRoot(
    "docs/adr/0067-official-site-content-redisplay-policy.md",
  );
  check(
    "(h) ADR-0067: BOATCAST（race.boatcast.jp）を新しい取得先として追加する追記案（承認済み・戸田/浜名湖/宮島を含む・負荷見積り・403の扱い・再配布しない）",
    /## 追記（2026-09-21）: BOATCAST/.test(adr) &&
      /race\.boatcast\.jp/.test(adr) &&
      /戸田/.test(adr) &&
      /403/.test(adr) &&
      /再配布/.test(adr),
  );
  check(
    "(h) 設計文書: spec.md（公開マップ・公開時刻の実測・負荷見積り）と plan.md（ER図）がある",
    fs.existsSync(
      path.join(ROOT, "docs/design/boatcast-original-exhibition/spec.md"),
    ) &&
      /```mermaid\s*\n\s*erDiagram/.test(
        readRoot("docs/design/boatcast-original-exhibition/plan.md"),
      ),
  );
}

// ---------------------------------------------------------------------------
// (i) 変異検証: 壊した版で、(a)(b)(c) の評価が失敗する
// ---------------------------------------------------------------------------
const LIB = path.join(ROOT, "scripts/lib/boatcast");
async function withMutant(fileName, replacements, runFn) {
  const source = fs.readFileSync(path.join(LIB, fileName), "utf8");
  let mutated = source;
  for (const [from, to] of replacements) {
    if (!mutated.includes(from)) {
      throw new Error(
        `変異の対象が見つかりません（${fileName}）: ${from.slice(0, 60)}`,
      );
    }
    mutated = mutated.replace(from, to);
  }
  const tmp = path.join(
    LIB,
    `${fileName.replace(/\.js$/, "")}.mutant-${process.pid}.tmp.mjs`,
  );
  fs.writeFileSync(tmp, mutated);
  try {
    return await runFn(await import(`${tmp}?t=${Date.now()}`));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
/** 変異で壊れた版は、評価の途中で例外になることがある。例外も「検証が失敗した」として数える */
const safeEval = async (fn) => {
  try {
    return await fn();
  } catch (e) {
    return [`例外: ${e.message}`];
  }
};
const parserMutants = [
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
const rowsMutants = [
  [
    "値の行の kind を項目の位置（番号）にする",
    [["kind: label,", "kind: String(i),"]],
  ],
  [
    "ハッシュに選手名を含める",
    [
      [
        "rows: [...parsed.rows]\n      .sort((a, b) => a.boatNumber - b.boatNumber)\n      .map((r) => [r.boatNumber, r.values]),",
        "rows: [...parsed.rows]\n      .sort((a, b) => a.boatNumber - b.boatNumber)\n      .map((r) => [r.boatNumber, r.racerName, r.values]),",
      ],
    ],
  ],
  [
    "公開時刻（Last-Modified）を保存しない",
    [
      [
        "source_last_modified: parseLastModified(lastModified),",
        "source_last_modified: null,",
      ],
    ],
  ],
  [
    "403を常に再試行する（打ち切らない）",
    [
      [
        "if (minutesToStart <= policy.finalAtOrBelowMin) return { final: true };",
        "",
      ],
    ],
  ],
  [
    "403の再試行の間隔を延ばさない（常に5分）",
    [
      [
        "return { final: false, retrySec: policy.secondRetrySec };",
        "return { final: false, retrySec: policy.firstRetrySec };",
      ],
    ],
  ],
  [
    "発走時刻が不明でも待つ（バックフィルで打ち切らない）",
    [
      [
        "if (!Number.isFinite(minutesToStart)) return { final: true };",
        "if (!Number.isFinite(minutesToStart)) return { final: false, retrySec: 300 };",
      ],
    ],
  ],
  [
    "計測不可のレースの行を作らない",
    [
      [
        "parsed.status !== ORITEN_STATUSES.measured &&\n    parsed.status !== ORITEN_STATUSES.unmeasurable",
        "parsed.status !== ORITEN_STATUSES.measured",
      ],
    ],
  ],
];
for (const [label, replacements] of rowsMutants) {
  const failed = await withMutant("oritenRows.js", replacements, async (m) =>
    safeEval(() => evaluateRows(m, realParser)),
  );
  check(
    `(i) 変異検証（行の組み立て）: ${label} → 検証が失敗する（${failed.length}項目）`,
    failed.length > 0,
  );
}
const jobMutants = [
  ["shadow でも書き込む", [['if (mode !== "live") {', "if (false) {"]]],
  [
    "計測不可でも、値の期待件数を持つ（0件エラーになる）",
    [
      [
        "rowsExpected: measured ? expectedValueRows(jo, 6, map) : 0,",
        "rowsExpected: expectedValueRows(jo, 6, map),",
      ],
    ],
  ],
  [
    "書く順序を逆にする（レース単位の行を先に書く）",
    [
      [
        '    "race_original_exhibition_values",\n      rows.values,',
        '    "race_original_exhibition_values_X",\n      rows.values,',
      ],
    ],
  ],
  [
    "091の適用を確認せずに書く",
    [
      [
        "if (!(await detectBoatcastSchema(client, ORITEN_TABLES))) {",
        "if (false) {",
      ],
    ],
  ],
  [
    "403を、カナリアの確認後でも常にデータ無しにする（再試行しない）",
    [
      [
        "const decision = decideNotPublished(minutesToStart);",
        "const decision = { final: true };",
      ],
    ],
  ],
  [
    "HTTP 403以外のエラーを error にせず成功扱いにする",
    [["if (res.status !== 200) {", "if (res.status !== 200 && false) {"]],
  ],
  [
    "構造の異常でも書き込む",
    [["if (parsed.status === ORITEN_STATUSES.unrecognized) {", "if (false) {"]],
  ],
  [
    "マップ外の会場（江戸川）も取得する",
    [['if (!entry || entry.status !== "public") {', "if (false) {"]],
  ],
  [
    "古い値の行を消さない",
    [
      [
        "if (existing) {\n    // 内容が変わったとき",
        "if (false) {\n    // 内容が変わったとき",
      ],
    ],
  ],
];
for (const [label, replacements] of jobMutants) {
  try {
    const failed = await withMutant("oritenJob.js", replacements, async (m) =>
      safeEval(() => evaluateJob(m.processOritenRace)),
    );
    check(
      `(i) 変異検証（取得ジョブ）: ${label} → 検証が失敗する（${failed.length}項目）`,
      failed.length > 0,
    );
  } catch (e) {
    check(`(i) 変異検証（取得ジョブ）: ${label}`, false, e.message);
  }
}
{
  // 予定表: 対象会場の絞り込みを外すと、対象外の会場（江戸川）のスロットができる
  const failedEnsure = await withMutant(
    "oritenJob.js",
    [
      [
        '(r) => venueEntry(venueOfRaceId(r.race_id), map)?.status === "public",',
        "() => true,",
      ],
    ],
    async (m) => {
      const races = [
        {
          race_id: "2026-09-21-03-01",
          race_date: "2026-09-21",
          start_time: "10:00:00",
        },
        {
          race_id: "2026-09-21-05-02",
          race_date: "2026-09-21",
          start_time: "10:30:00",
        },
      ];
      const client = freshClient({ races });
      const store = m.createOritenStore(client, { base: createMemoryStore() });
      await store.ensureSlots({
        date: "2026-09-21",
        now: new Date("2026-09-21T10:00:00+09:00"),
      });
      return client.data.scrape_slots.some((s) => s.race_id.includes("-03-"))
        ? ["江戸川のスロットができた"]
        : [];
    },
  );
  check(
    `(i) 変異検証（予定表）: 対象会場の絞り込みを外すと、対象外のスロットができる → 検証が失敗する（${failedEnsure.length}項目）`,
    failedEnsure.length > 0,
  );
  // カナリア: 失敗でもデータを取りに行く
  const failedCanary = await withMutant(
    "oritenJob.js",
    [["if (!canaryResult.ok) {", "if (false) {"]],
    async (m) => {
      const client = freshClient();
      const fetchImpl = createFakeFetch(() => FORBIDDEN);
      realJob.clearTicks();
      const memory = createMemoryStore({
        rows: {
          [realJob.ORITEN_JOB]: {
            job: realJob.ORITEN_JOB,
            mode: "live",
            consecutive_failures: 0,
          },
        },
        slots: [SLOT(RACE_ID)],
      });
      await runScrapeJob({
        job: realJob.ORITEN_JOB,
        store: m.createOritenStore(client, { base: memory }),
        handleSlot: m.createOritenSlotHandler({
          pacer: noWaitPacer,
          venueNoData: async () => null,
        }),
        now: NOW,
        client,
        politeFetch: fetchImpl,
      });
      return fetchImpl.calls.length > 1
        ? ["カナリアが失敗でもデータを取った"]
        : [];
    },
  );
  check(
    `(i) 変異検証（カナリア）: カナリアが失敗でも取得を続けると、リクエストが増える → 検証が失敗する（${failedCanary.length}項目）`,
    failedCanary.length > 0,
  );
}
{
  const failedPacer = await withMutant(
    "boatcastClient.js",
    [["const startAt = Math.max(t, nextAllowedAt);", "const startAt = t;"]],
    async (m) => {
      let t = 0;
      const p = m.createPacer({
        minIntervalMs: 2200,
        now: () => t,
        sleep: async (ms) => {
          t += ms;
        },
      });
      const s = [];
      for (let i = 0; i < 3; i++) {
        await p.wait();
        s.push(t);
      }
      return s.slice(1).every((x, i) => x - s[i] >= 2200)
        ? []
        : ["間隔が空かない"];
    },
  );
  check(
    `(i) 変異検証（間隔）: 間隔を空けないと検証が失敗する（${failedPacer.length}項目）`,
    failedPacer.length > 0,
  );
}
{
  // 待ってから次の時刻を予約する版は、逐次の呼び出しでは間隔が空くが、並行の呼び出しでは同じ nextAllowedAt を
  // 読んで全員が同時に通る。仮想の時計にしても並行の検証が効いていることの担保
  const failedConcurrentPacer = await withMutant(
    "boatcastClient.js",
    [
      [
        `      nextAllowedAt = startAt + minIntervalMs;
      if (startAt > t) await sleep(startAt - t);`,
        `      if (startAt > t) await sleep(startAt - t);
      nextAllowedAt = now() + minIntervalMs;`,
      ],
    ],
    async (m) => {
      const clock = createVirtualClock();
      const p = m.createPacer({
        minIntervalMs: 30,
        now: clock.now,
        sleep: clock.sleep,
      });
      const s = [];
      const concurrent = Promise.all(
        [0, 1, 2].map(async () => {
          await p.wait();
          s.push(clock.now());
        }),
      );
      await clock.runAll();
      await concurrent;
      const sequential = [];
      const inOrder = (async () => {
        for (let i = 0; i < 3; i++) {
          await p.wait();
          sequential.push(clock.now());
        }
      })();
      await clock.runAll();
      await inOrder;
      const spaced = (xs) => xs.slice(1).every((x, i) => x - xs[i] >= 30);
      return [
        ...(spaced(s) ? [] : ["並行の呼び出しで間隔が空かない"]),
        ...(spaced(sequential) ? ["逐次では間隔が空いてしまう（見逃す）"] : []),
      ];
    },
  );
  check(
    `(i) 変異検証（間隔・並行）: 待ってから次の時刻を予約すると、並行の呼び出しが同時に通る → 検証が失敗する（逐次だけでは見逃す）（${failedConcurrentPacer.length}項目）`,
    failedConcurrentPacer.length === 2,
    show(failedConcurrentPacer),
  );
}

if (failures > 0) {
  out.error(`\n${failures}件の検証が失敗しました`);
  process.exit(1);
}
out.log("\nすべての検証が通りました");
