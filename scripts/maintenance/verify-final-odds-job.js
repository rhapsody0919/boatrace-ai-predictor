/**
 * verify-final-odds-job.js - 締切時オッズ（公式）の取り直し（BOA-496、api/cron/odds-final.js）の検証。
 * DBにも取得先にも接続しない（取得関数・既存行の読み取り・書き込みを差し替え、フィクスチャのHTMLを返す）。
 *
 * フィクスチャは公式の実ページ（scripts/lib/__fixtures__/odds/）。締切後の5ページ（2026-09-19 江戸川1R。
 * `.tab4_time`「締切時オッズ」表示）と、発売中のページ（オッズ更新時間の表示）・未公開のページ。
 *
 * 確認すること:
 *   (a) 解析: 締切後の5ページから、券種ごとの通り数（単勝6・複勝6・3連単120・3連複20・2連単30・2連複15・拡連複15）。
 *       票0（「0.0」）は 0 のまま残る（keepZero）。発売中のページは not_final、未公開は unpublished
 *   (b) 保存済みの判定: 必要な列が空でないページだけを保存済みにする（複勝は判定に使わない）
 *   (c) 再試行の判定・保存行の組み立て（ハンドラー）:
 *       全ページ締切時 → ok・全7列を1行で保存／1ページ目が発売中 → no_values・取得は1ページだけ・保存しない／
 *       1ページだけ失敗 → partial・取れた券種だけ保存・失敗したページ名を error に／再試行では未保存のページだけ取る／
 *       全券種保存済み → skipped_have_data・取得しない／shadow → 既存行を読まず書かない／未公開 → no_values／
 *       ブレーカーは例外のまま（共通ラッパが retryAt を付ける）
 *   (d) 設定: レジストリ（offset 5・許容幅55分・再試行300秒・検査が通る）、api/cron/odds-final.js の maxDuration、
 *       vercel.json の cron（JST 07:00〜23:55 の5分ごと）
 */
import fs from "node:fs";
import {
  FINAL_ODDS_COLUMNS,
  createFinalOddsSlotHandler,
  parseFinalOddsPage,
  savedPagesOf,
} from "../lib/scrapeJobs/finalOddsHandlers.js";
import { liveOddsUrl } from "../lib/liveOdds.js";
import { BreakerOpenError } from "../lib/scrapeJobs/circuitBreaker.js";
import {
  SCRAPE_JOBS,
  graceMinFor,
  validateRegistry,
} from "../lib/scrapeJobs/registry.js";

const printOut = console.log.bind(console);
const printErr = console.error.bind(console);
console.log = () => {};
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
const show = (v) => JSON.stringify(v);
const count = (v) => (v ? Object.keys(v).length : null);

const FIX = (name) =>
  fs.readFileSync(
    new URL(`../lib/__fixtures__/odds/${name}`, import.meta.url),
    "utf8",
  );

const FINAL_HTML = {
  tf: FIX("oddstf-2026-09-19-05-01.html"),
  "3t": FIX("odds3t-2026-09-19-05-01.html"),
  "3f": FIX("odds3f-2026-09-19-05-01.html"),
  "2tf": FIX("odds2tf-2026-09-19-05-01.html"),
  k: FIX("oddsk-2026-09-19-05-01.html"),
};
const PREDEADLINE_TF = FIX("oddstf-zero-votes-2026-09-28-03-08.html");
const PREDEADLINE_3T = FIX("odds3t-predeadline-2026-09-29-21-02.html");
const UNPUBLISHED_TF = FIX("oddstf-unpublished-2026-09-25-05-01.html");

const RACE_ID = "2026-09-19-05-01";
const TARGET = { date: "2026-09-19", venue: 5, raceNo: 1 };
const NOW = new Date("2026-09-19T01:10:00Z");

// ---------------------------------------------------------------------------
// (a) 解析
// ---------------------------------------------------------------------------
{
  const parsed = Object.fromEntries(
    Object.entries(FINAL_HTML).map(([page, html]) => [
      page,
      parseFinalOddsPage(page, html),
    ]),
  );
  check(
    "(a) 締切後の5ページはすべて final",
    Object.values(parsed).every((p) => p.status === "final"),
    show(
      Object.fromEntries(Object.entries(parsed).map(([k, p]) => [k, p.status])),
    ),
  );
  const counts = {
    win: count(parsed.tf.patch.win_all),
    place: count(parsed.tf.patch.place_all),
    trifecta: count(parsed["3t"].patch.trifecta_all),
    trio: count(parsed["3f"].patch.trio_all),
    exacta: count(parsed["2tf"].patch.exacta_all),
    quinella: count(parsed["2tf"].patch.quinella_all),
    wide: count(parsed.k.patch.wide_all),
  };
  check(
    "(a) 券種ごとの通り数（単勝6・複勝6・3連単120・3連複20・2連単30・2連複15・拡連複15）",
    show(counts) ===
      show({
        win: 6,
        place: 6,
        trifecta: 120,
        trio: 20,
        exacta: 30,
        quinella: 15,
        wide: 15,
      }),
    show(counts),
  );
  check(
    "(a) 値は数値・レンジ（拡連複・複勝は {low, high}）で、キーの形は race_odds の *_all と同じ",
    typeof parsed["3t"].patch.trifecta_all["1-2-3"] === "number" &&
      typeof parsed.tf.patch.win_all["1"] === "number" &&
      typeof parsed.k.patch.wide_all["1-2"]?.low === "number" &&
      typeof parsed.tf.patch.place_all["1"]?.high === "number" &&
      Object.keys(parsed["3f"].patch.trio_all).every((k) => {
        const n = k.split("-").map(Number);
        return n[0] < n[1] && n[1] < n[2];
      }),
  );

  // 票0: 締切後の単勝ページの1艇目と3連単の1通り目を「0.0」に書き換える
  const zeroTf = FINAL_HTML.tf.replace(
    /(<td class="oddsPoint[^"]*">)\s*[\d.]+\s*(<\/td>)/,
    "$10.0$2",
  );
  const zero3t = FINAL_HTML["3t"].replace(
    /(<td class="oddsPoint[^"]*">)\s*[\d.]+\s*(<\/td>)/,
    "$10.0$2",
  );
  const zw = parseFinalOddsPage("tf", zeroTf);
  const z3 = parseFinalOddsPage("3t", zero3t);
  check(
    "(a) 票0（0.0）は 0 のまま残る（単勝・3連単。キーを落とさない）",
    zeroTf !== FINAL_HTML.tf &&
      zw.patch.win_all?.["1"] === 0 &&
      count(zw.patch.win_all) === 6 &&
      Object.values(z3.patch.trifecta_all ?? {}).includes(0) &&
      count(z3.patch.trifecta_all) === 120,
    show([zw.patch.win_all, count(z3.patch.trifecta_all)]),
  );
  check(
    "(a) 発売中のページ（オッズ更新時間の表示）は not_final で、列を返さない",
    parseFinalOddsPage("tf", PREDEADLINE_TF).status === "not_final" &&
      parseFinalOddsPage("3t", PREDEADLINE_3T).status === "not_final" &&
      count(parseFinalOddsPage("tf", PREDEADLINE_TF).patch) === 0,
  );
  check(
    "(a) 未公開のページは unpublished",
    parseFinalOddsPage("tf", UNPUBLISHED_TF).status === "unpublished",
  );
}

// ---------------------------------------------------------------------------
// (b) 保存済みの判定
// ---------------------------------------------------------------------------
check(
  "(b) 既存行なし → 保存済みなし／空の jsonb は未保存／複勝だけ無くても単勝があれば tf は保存済み",
  savedPagesOf(null).size === 0 &&
    savedPagesOf({ trifecta_all: {} }).size === 0 &&
    show([
      ...savedPagesOf({
        win_all: { 1: 2.0 },
        place_all: null,
        exacta_all: { "1-2": 3 },
        quinella_all: null,
      }),
    ]) === show(["tf"]),
);

// ---------------------------------------------------------------------------
// (c) ハンドラー
// ---------------------------------------------------------------------------
const PAGE_OF_URL = new Map(
  Object.keys(FINAL_HTML).map((page) => [
    liveOddsUrl({ ...TARGET, page }),
    page,
  ]),
);

/** 取得・読み取り・書き込みを記録するテスト用の環境 */
function makeEnv({
  html = FINAL_HTML,
  status = {},
  existing = null,
  throwFor,
} = {}) {
  const env = { fetched: [], saved: [], loaded: 0 };
  env.ctx = (mode = "live") => ({
    mode,
    client: {},
    now: () => NOW,
    politeFetch: async (url) => {
      const page = PAGE_OF_URL.get(url);
      if (!page) throw new Error(`想定外のURL: ${url}`);
      env.fetched.push(page);
      if (throwFor?.[page]) throw throwFor[page];
      const code = status[page] ?? 200;
      return new Response(html[page], { status: code });
    },
  });
  env.handler = createFinalOddsSlotHandler({
    loadExisting: async () => {
      env.loaded++;
      return existing;
    },
    save: async (_client, row) => {
      env.saved.push(row);
    },
  });
  return env;
}
const SLOT = {
  job: "odds_final",
  race_id: RACE_ID,
  offset_min: 5,
  attempts: 1,
};

{
  const env = makeEnv();
  const r = await env.handler(SLOT, env.ctx());
  const row = env.saved[0] ?? {};
  check(
    "(c) 全ページが締切時オッズ → ok・5ページを取り、全7列を1行で保存（captured_at 付き）",
    r.outcome === "ok" &&
      r.rowsWritten === 1 &&
      r.rowsParsed === 1 &&
      env.fetched.length === 5 &&
      env.fetched[0] === "tf" &&
      env.saved.length === 1 &&
      row.race_id === RACE_ID &&
      row.captured_at === NOW.toISOString() &&
      FINAL_ODDS_COLUMNS.every((c) => count(row[c]) > 0),
    show({ r, fetched: env.fetched, keys: Object.keys(row) }),
  );
}
{
  const env = makeEnv({ html: { ...FINAL_HTML, tf: PREDEADLINE_TF } });
  const r = await env.handler(SLOT, env.ctx());
  check(
    "(c) 1ページ目がまだ発売中の表示 → no_values（再試行）・取得は1ページだけ・保存しない",
    r.outcome === "no_values" &&
      show(env.fetched) === show(["tf"]) &&
      env.saved.length === 0 &&
      /締切時オッズ/.test(r.error ?? ""),
    show({ r, fetched: env.fetched }),
  );
}
{
  const env = makeEnv({ html: { ...FINAL_HTML, tf: UNPUBLISHED_TF } });
  const r = await env.handler(SLOT, env.ctx());
  check(
    "(c) 未公開（中止・順延の可能性）→ no_values・1ページだけ・保存しない",
    r.outcome === "no_values" &&
      env.fetched.length === 1 &&
      env.saved.length === 0,
    show(r),
  );
}
{
  const env = makeEnv({ status: { k: 500 } });
  const r = await env.handler(SLOT, env.ctx());
  const row = env.saved[0] ?? {};
  check(
    "(c) 拡連複のページだけ HTTP 500 → partial（再試行）・取れた券種だけ保存し、wide_all は送らない（前回の値を消さない）",
    r.outcome === "partial" &&
      env.saved.length === 1 &&
      !("wide_all" in row) &&
      count(row.trifecta_all) === 120 &&
      count(row.win_all) === 6 &&
      /k\(error HTTP 500\)/.test(r.error ?? ""),
    show({ r, keys: Object.keys(row) }),
  );
}
{
  const env = makeEnv({ html: { ...FINAL_HTML, "3f": PREDEADLINE_3T } });
  const r = await env.handler(SLOT, env.ctx());
  check(
    "(c) 途中のページだけまだ発売中の表示 → partial・そのページの列は保存しない",
    r.outcome === "partial" &&
      !("trio_all" in (env.saved[0] ?? {})) &&
      /3f\(not_final\)/.test(r.error ?? ""),
    show(r),
  );
}
{
  const existing = {
    win_all: { 1: 1.5 },
    place_all: { 1: { low: 1.1, high: 1.3 } },
    trifecta_all: { "1-2-3": 5 },
    trio_all: { "1-2-3": 2 },
    exacta_all: { "1-2": 3 },
    quinella_all: { "1-2": 2 },
    wide_all: null,
  };
  const env = makeEnv({ existing });
  const r = await env.handler({ ...SLOT, attempts: 2 }, env.ctx());
  check(
    "(c) 再試行: 未保存の拡連複だけを取る（1ページ目＝確認も拡連複）→ ok・wide_all だけを保存",
    r.outcome === "ok" &&
      show(env.fetched) === show(["k"]) &&
      show(Object.keys(env.saved[0] ?? {}).sort()) ===
        show(["captured_at", "race_id", "wide_all"]),
    show({ r, fetched: env.fetched, saved: env.saved }),
  );
}
{
  const full = Object.fromEntries(FINAL_ODDS_COLUMNS.map((c) => [c, { 1: 1 }]));
  full.exacta_all = { "1-2": 1 };
  full.quinella_all = { "1-2": 1 };
  const env = makeEnv({ existing: full });
  const r = await env.handler({ ...SLOT, attempts: 3 }, env.ctx());
  check(
    "(c) 全券種が保存済み → skipped_have_data・取得しない",
    r.outcome === "skipped_have_data" &&
      env.fetched.length === 0 &&
      env.saved.length === 0,
    show(r),
  );
}
{
  const env = makeEnv({ existing: { win_all: { 1: 1 } } });
  const r = await env.handler(SLOT, env.ctx("shadow"));
  check(
    "(c) shadow: 既存行を読まず、書かない・5ページを取り resultDigest を返す",
    r.outcome === "ok" &&
      env.loaded === 0 &&
      env.saved.length === 0 &&
      r.rowsWritten === 0 &&
      env.fetched.length === 5 &&
      /^[0-9a-f]{16}$/.test(r.resultDigest ?? ""),
    show(r),
  );
}
{
  const env = makeEnv({
    throwFor: {
      tf: new BreakerOpenError("boatrace.jp", NOW.getTime() + 60000),
    },
  });
  let thrown = null;
  try {
    await env.handler(SLOT, env.ctx());
  } catch (error) {
    thrown = error;
  }
  check(
    "(c) ブレーカーが開いている → BreakerOpenError をそのまま投げる（共通ラッパが breaker_open・retryAt にする）",
    thrown instanceof BreakerOpenError && env.saved.length === 0,
    String(thrown),
  );
}
{
  const env = makeEnv({ throwFor: { tf: new Error("timeout") } });
  const r = await env.handler(SLOT, env.ctx());
  check(
    "(c) 1ページ目の通信エラー → error（再試行）・保存しない",
    r.outcome === "error" &&
      /tf: timeout/.test(r.error ?? "") &&
      env.saved.length === 0,
    show(r),
  );
}

// ---------------------------------------------------------------------------
// (d) 設定
// ---------------------------------------------------------------------------
{
  const def = SCRAPE_JOBS.odds_final;
  check(
    "(d) レジストリ: 窓型・offset 5（締切5分後）・許容幅55分（締切60分後まで）・再試行300秒・boatrace.jp",
    def?.kind === "window" &&
      show(def.offsets) === show([5]) &&
      graceMinFor(def, 5) === 55 &&
      def.retrySec === 300 &&
      show(def.hosts) === show(["boatrace.jp"]),
    show(def),
  );
  check(
    "(d) レジストリの整合性検査が通る",
    validateRegistry().length === 0,
    show(validateRegistry()),
  );
  const cronSrc = fs.readFileSync(
    new URL("../../api/cron/odds-final.js", import.meta.url),
    "utf8",
  );
  const maxDuration = Number(/maxDuration:\s*(\d+)/.exec(cronSrc)?.[1]);
  check(
    "(d) api/cron/odds-final.js の maxDuration がレジストリと一致し、job='odds_final' で登録している",
    maxDuration === def.maxDurationSec &&
      /job:\s*"odds_final"/.test(cronSrc) &&
      /createFinalOddsSlotHandler\(\)/.test(cronSrc),
    String(maxDuration),
  );
  const vercel = JSON.parse(
    fs.readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"),
  );
  const crons = vercel.crons.filter((c) => c.path === "/api/cron/odds-final");
  check(
    "(d) vercel.json: /api/cron/odds-final を5分ごと・UTC 22-23,0-14 時（JST 07:00〜23:55）で1本",
    crons.length === 1 && crons[0].schedule === "*/5 22-23,0-14 * * *",
    show(crons),
  );
}

if (failures > 0) {
  printErr(`\n${failures} 件の検証が失敗しました`);
  process.exit(1);
}
printOut("\nALL PASS");
