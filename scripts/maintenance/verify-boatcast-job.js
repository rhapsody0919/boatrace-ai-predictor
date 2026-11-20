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
import { CANARY_URL } from "../lib/boatcast/boatcastClient.js";




import { SCRAPE_JOBS, validateRegistry } from "../lib/scrapeJobs/registry.js";
import { hostKeyOf } from "../lib/scrapeJobs/politeFetch.js";





import {
  show,
  same,
  THREE,
  TWO,
  HALF,
  MISSING,
  UNMEASURABLE,
  RACE_ID,
} from "./verifyData/boatcast-job-fixtures.js";
import { evaluateParser, evaluateRows } from "./verifyData/boatcast-job-parse-rows.js";
import { evaluateJob } from "./verifyData/boatcast-job-job.js";
import { runBoatcastJobScenes1 } from "./verifyData/boatcast-job-scenes-1.js";
import { runBoatcastJobScenes2 } from "./verifyData/boatcast-job-scenes-2.js";
import { runBoatcastJobScenes3 } from "./verifyData/boatcast-job-scenes-3.js";
import { runBoatcastJobScenes4, runBoatcastJobScenes5 } from "./verifyData/boatcast-job-scenes-4.js";
import { runBoatcastJobScenes6 } from "./verifyData/boatcast-job-scenes-5.js";
import { runBoatcastJobScenes7, runBoatcastJobScenes8 } from "./verifyData/boatcast-job-scenes-6.js";

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
  /** 積まれた sleep を起床時刻の順に消化する（消化の途中で積まれた分も拾う） */
  async function runAll() {
    await drain();
    for (let guard = 0; timers.length > 0; guard++) {
      if (guard > 1000) throw new Error("仮想の時計: sleep が終わらない");
      timers.sort((a, b) => a.at - b.at);
      const next = timers.shift();
      t = Math.max(t, next.at);
      next.resolve();
      await drain();
    }
  }
  return {
    now: () => t,
    sleep: (ms) =>
      new Promise((resolve) => {
        timers.push({ at: t + ms, resolve });
      }),
    /**
     * promise が終わるまで sleep を消化し続ける。消化するものが無いのに終わらない場合は、待ち合わせが噛み合って
     * いない（このまま待つと固まる）ので落とす — CIを何時間も占有させないため
     */
    async runUntil(promise) {
      let pending = true;
      const settled = promise.then(
        (v) => {
          pending = false;
          return v;
        },
        (e) => {
          pending = false;
          throw e;
        },
      );
      settled.catch(() => {}); // 例外は呼び出し側の await で受ける
      while (pending) {
        await runAll();
        if (pending && timers.length === 0) {
          throw new Error("仮想の時計: 消化する sleep が無いのに終わらない");
        }
      }
      return settled;
    },
  };
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readRoot = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

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

// ---- 後半の場面（verifyData/boatcast-job-scenes-1.js・boatcast-job-scenes-2.js・boatcast-job-scenes-3.js・boatcast-job-scenes-4.js） ----
await runBoatcastJobScenes1({ check, SLOT });
await runBoatcastJobScenes2({ check, createVirtualClock, SLOT });
await runBoatcastJobScenes3({ check });
await runBoatcastJobScenes4({ check, withMutant });

// ---------------------------------------------------------------------------
// (h) 配線・DDL・文書
// ---------------------------------------------------------------------------
{
  check(
    "(h) レジストリ: 整合している。boatcast_oriten は窓型（発走20分前の1本・許容幅40分）、boatcast_motor_start は日次（06:30）",
    same(validateRegistry(), []) &&
      SCRAPE_JOBS.boatcast_oriten.kind === "window" &&
      same(SCRAPE_JOBS.boatcast_oriten.offsets, [-20]) &&
      SCRAPE_JOBS.boatcast_oriten.graceMin === 40 &&
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
  {
    // 共有の politeFetch は、登録したパス（レジストリの breakerUrls。boatrace.jp の beforeinfo）の 403 でだけ
    // ブレーカーを開く（BOA-1145）。BOATCAST の 403（未公開のファイル）は従来どおり成功の側で、ジョブ内で扱う
    const pf = await import("../lib/scrapeJobs/politeFetch.js");
    const cb = await import("../lib/scrapeJobs/circuitBreaker.js");
    const breaker = cb.createCircuitBreaker();
    let n = 0;
    const f = pf.createPoliteFetch({
      breaker,
      sleep: async () => {},
      fetchImpl: async () => (n++, new Response("", { status: 403 })),
    });
    const url = "https://race.boatcast.jp/txt/04/bc_oriten_20261026_04_01.txt";
    const r1 = await f(url);
    const r2 = await f(url);
    check(
      "(h) 共有の politeFetch: BOATCAST の 403 は再試行せず 403 をそのまま返し、ブレーカーを開かない（403 で開くのは登録したパスだけ。BOATCASTの403の扱いは、ジョブ内）。429/503 だけを再試行の対象にしている",
      /RETRYABLE_STATUSES = new Set\(\[429, 503\]\)/.test(
        readRoot("scripts/lib/scrapeJobs/politeFetch.js"),
      ) &&
        r1.status === 403 &&
        r2.status === 403 &&
        n === 2 &&
        breaker.snapshot(pf.pathKeyOf(url)).openUntil === 0 &&
        breaker.snapshot(pf.hostKeyOf(url)).openUntil === 0 &&
        ![...pf.DEFAULT_BLOCK_PATH_KEYS].some((k) => k.includes("boatcast")),
    );
  }

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
/**
 * 変異ごとに別のモジュールとして読み込むための通し番号。以前は import の URL を `?t=${Date.now()}` で区別していたが、
 * 同じファイルの変異が同じミリ秒に続くと URL が一致し、ESM のキャッシュから直前の変異が返る。CIで「間隔・並行」の
 * 変異の代わりに「間隔を空けない」変異が評価され、検証が失敗した（BOA-648、run 36840737023 attempt 1）。
 * 逆に、壊れた直前の変異で代わりに評価されて変異検証が素通りすることもあるので、時刻ではなく通し番号で区別する
 */
let mutantSeq = 0;
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
    `${fileName.replace(/\.js$/, "")}.mutant-${process.pid}-${++mutantSeq}.tmp.mjs`,
  );
  fs.writeFileSync(tmp, mutated);
  try {
    return await runFn(await import(tmp));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// ---- 後半の場面（verifyData/boatcast-job-scenes-4.js・boatcast-job-scenes-5.js・boatcast-job-scenes-6.js） ----
await runBoatcastJobScenes5({ check, withMutant });
await runBoatcastJobScenes6({ check, SLOT, withMutant });
await runBoatcastJobScenes7({ out, check, createVirtualClock, withMutant });

if (failures > 0) {
  out.error(`\n${failures}件の検証が失敗しました`);
  process.exit(1);
}

// ---- 後半の場面（verifyData/boatcast-job-scenes-6.js） ----
runBoatcastJobScenes8({ out, check, createVirtualClock, withMutant });
