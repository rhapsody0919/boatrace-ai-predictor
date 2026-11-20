/**
 * verify-motor-pretest.js - 前検タイム・前検順位・節時点のモーター/ボート2連対率（N23、motor_pretest_stats。
 * tasks.md T4b-20）の取得・解析・保存・日次ジョブ・過去分CLIの検証。DBにも取得先にも接続しない
 * （実ページのフィクスチャ・インメモリのSupabaseクライアント・fetch・時計を差し替える）。
 *
 * 確認すること:
 *   (a) パーサー: 実ページ（scripts/lib/__fixtures__/motorPretest/）の項目を、見出しのラベルで解釈する。前検順位は、前検タイムの
 *       昇順で並べたページの「順位」と一致する（ページの既定の「順位」＝モーター2連対率の順位を、前検順位と取り違えない）。
 *       データが無いページ・未知のラベル・必須ラベルの欠落・想定外のセル・選手の重複は、黙って通さず unrecognized
 *   (b) 行の組み立て・書き込み: 変更の無い行は書かない（numeric の文字列と数値の差で「変更あり」に倒れない）・取得時刻 updated_at・
 *       テーブル未適用（マイグレーション090）は成功にしない
 *   (c) 日次ジョブ: off・行なしで何も取得しない・shadow は書かず対象日を処理済みにしない・live は書く・同じ日の2回目は何もしない・
 *       0件はエラー・races が無い／races_init が未完了なら取得しない・一時的な失敗の会場だけを補足の起動が再取得する・
 *       期待した選手が載っていない／前検タイムが欠けたら通知（1回きり）・構造の変化の通知・別のページを保存しない
 *   (d) 過去分CLI: 対象の会場×日（節の初日のみ・全日）・取得（窓・日次上限・サーキットブレーカー・再開・想定外の内容）・解析・投入
 *       （--apply が無ければ書かない・変更の無い行は書かない）
 *   (e) 配線: レジストリ・maxDuration・vercel.json の cron（UTC→JST換算。オッズの運用窓 07:00〜23:59 JST の外）・認証
 *
 * 実行: node scripts/maintenance/verify-motor-pretest.js
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SCRAPE_JOBS, validateRegistry } from "../lib/scrapeJobs/registry.js";

import { createFakeSupabaseClient } from "../lib/scrapeJobs/testing/fakeSupabaseClient.js";
import { MOTOR_PRETEST_PARSER_VERSION, buildMotorPretestUrl } from "../lib/motorPretestParser.js";


import * as backfill from "./motor-pretest-backfill.js";
import { cronWiring } from "./verifyData/cronWiring.js";

import { runMotorPretestScenes1 } from "./verifyData/motor-pretest-scenes-1.js";
import { runMotorPretestScenes2 } from "./verifyData/motor-pretest-scenes-2.js";
import { runMotorPretestScenes3 } from "./verifyData/motor-pretest-scenes-3.js";
import { runMotorPretestScenes4 } from "./verifyData/motor-pretest-scenes-4.js";
import { runMotorPretestScenes5, runMotorPretestScenes6 } from "./verifyData/motor-pretest-scenes-5.js";

// 検証の対象コードが出すログは捨て、結果の行だけを出す
const out = { log: console.log, error: console.error };
console.log = console.warn = console.error = () => {};

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
const jst = (text) => new Date(`${text}+09:00`);

const ROOT = path.resolve(new URL("../../", import.meta.url).pathname);
const FIXTURES = path.join(ROOT, "scripts/lib/__fixtures__/motorPretest");
const fx = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");
const TODA = fx("rankingmotor_02_20260921.html"); // 戸田 2026-09-21（節の途中）46人
const TOKUYAMA = fx("rankingmotor_18_20260921.html"); // 徳山 2026-09-21 45人（既定の並び）
const TOKUYAMA_BY_TIME = fx("rankingmotor_18_20260921_sort5.html"); // 同じ徳山を前検タイムの昇順で並べたページ
const SALADPAN = fx("rankingmotor_11_20260922.html"); // びわこ 2026-09-22（グレード表示なし）45人
const TOKONAME = fx("rankingmotor_08_20251205.html"); // 常滑 2025-12-05（過去日）52人
const OMURA = fx("rankingmotor_24_20251204.html"); // 大村 2025-12-04（過去日・節の初日）45人
const NO_DATA = fx("rankingmotor_22_20260921.html"); // 開催の無い日・会場

/** フィクスチャを、別の会場・日付のページに見せる（同じ表を、違う会場・日付として取得した想定の検証用） */
const asPage = (html, venueCode, date) =>
  html
    .replaceAll(/hd=\d{8}/g, `hd=${date.replaceAll("-", "")}`)
    .replace(
      /text_place2_\d{2}\./,
      `text_place2_${String(venueCode).padStart(2, "0")}.`,
    );

// ---- 後半の場面（verifyData/motor-pretest-scenes-1.js・motor-pretest-scenes-2.js・motor-pretest-scenes-3.js・motor-pretest-scenes-4.js・motor-pretest-scenes-5.js） ----
runMotorPretestScenes1({ check, show, same, TODA, TOKUYAMA, TOKUYAMA_BY_TIME, SALADPAN, TOKONAME, OMURA, NO_DATA });
await runMotorPretestScenes2({ check, show, same, jst, TODA, TOKUYAMA, NO_DATA });
await runMotorPretestScenes3({ check, show, same, jst });
await runMotorPretestScenes4({ check, show, same, TODA, TOKUYAMA, asPage });
await runMotorPretestScenes5({ out, check, show, same });
{
  // download・parse・load を、一時ディレクトリと、偽の取得・DBで通す
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "motor-pretest-"));
  const races = [
    ["2025-12-03", 2],
    ["2025-12-04", 2],
    ["2025-12-04", 18],
    ["2025-12-10", 2],
    ["2025-12-11", 2],
  ].map(([race_date, venue_code]) => ({
    race_id: `${race_date}-${String(venue_code).padStart(2, "0")}-01`,
    race_date,
    venue_code,
    race_number: 1,
  }));
  const client = createFakeSupabaseClient({
    tables: { races, motor_pretest_stats: [] },
  });
  const optsFor = (extra = []) =>
    backfill.validateOptions(
      backfill.parseArgs(
        [
          "download",
          "--from=2025-12-03",
          "--to=2025-12-31",
          `--archive-dir=${tmp}`,
          ...extra,
        ],
        new Date("2026-01-05T10:00:00+09:00"),
      ),
    );
  const insideWindow = () => new Date("2026-09-22T02:00:00+09:00");
  const requested = [];
  const depsFor = (resolve, now = insideWindow) => ({
    client,
    log: () => {},
    sleep: async () => {},
    now,
    fetchOnce: async (url) => {
      requested.push(url);
      const r = await resolve(url);
      return {
        status: r.status,
        bytes: new TextEncoder().encode(r.body ?? ""),
        ms: 1,
        lastModified: null,
      };
    },
  });
  const okPage = (url) => {
    const jcd = Number(new URL(url).searchParams.get("jcd"));
    const hd = new URL(url).searchParams.get("hd");
    return {
      status: 200,
      body: asPage(
        TODA,
        jcd,
        `${hd.slice(0, 4)}-${hd.slice(4, 6)}-${hd.slice(6, 8)}`,
      ),
    };
  };

  // 窓の外（12:00 JST）: 何も取得せず、安全に停止（2）
  const outside = await backfill.cmdDownload(
    optsFor(),
    depsFor(okPage, () => new Date("2026-09-22T12:00:00+09:00")),
  );
  check(
    "CLI download: 実行窓（JST 00-06）の外では、1件も取得せず、安全に停止する（終了コード2）",
    outside === 2 && requested.length === 0,
    show({ outside, n: requested.length }),
  );

  // plan（dry-run）: ネットワークなし
  const planOpts = optsFor();
  planOpts.dryRun = true;
  const planCode = await backfill.cmdDownload(planOpts, depsFor(okPage));
  check(
    "CLI plan: ネットワーク・書き込みなし（終了コード0）",
    planCode === 0 &&
      requested.length === 0 &&
      !fs.existsSync(path.join(tmp, "manifest.jsonl")),
  );

  // 日次上限（1件）で停止 → 再開
  const limited = await backfill.cmdDownload(
    optsFor(["--daily-limit=1"]),
    depsFor(okPage),
  );
  check(
    "CLI download: 日次上限に達したら安全に停止する（終了コード2・1件取得）",
    limited === 2 && requested.length === 1,
    show({ limited, n: requested.length }),
  );
  const finished = await backfill.cmdDownload(optsFor(), depsFor(okPage));
  check(
    "CLI download: 再実行は続きから（取得済みは再取得しない）。first-days の3件（02-20251203・18-20251204・02-20251210）を取得し終える",
    finished === 0 &&
      requested.length === 3 &&
      new Set(requested).size === 3 &&
      fs.existsSync(backfill.rawPath(tmp, "02-20251203")) &&
      fs.existsSync(backfill.rawPath(tmp, "18-20251204")) &&
      fs.existsSync(backfill.rawPath(tmp, "02-20251210")),
    show({ finished, requested }),
  );
  const again = await backfill.cmdDownload(optsFor(), depsFor(okPage));
  check(
    "CLI download: 完了済みの再実行は0リクエスト（終了コード0）",
    again === 0 && requested.length === 3,
  );
  check(
    "CLI download: User-Agent は BoatraceAIBot/1.0",
    backfill.USER_AGENT.startsWith("BoatraceAIBot/1.0"),
  );

  // parse → load
  const parseCode = await backfill.cmdParse(
    backfill.parseArgs([
      "parse",
      `--archive-dir=${tmp}`,
      "--from=2025-12-03",
      "--to=2025-12-31",
    ]),
    { log: () => {} },
  );
  const loadOpts = backfill.parseArgs([
    "load",
    `--archive-dir=${tmp}`,
    "--from=2025-12-03",
    "--to=2025-12-31",
  ]);
  const plan = backfill.buildLoadPlan(loadOpts);
  check(
    "CLI parse: 保存したHTMLを中間JSONにする。投入対象は3ページ・138行（前検タイムあり138行）",
    parseCode === 0 &&
      plan.pages === 3 &&
      plan.rows.length === 138 &&
      plan.missingParsed.length === 0,
    show({ parseCode, pages: plan.pages, rows: plan.rows.length }),
  );
  const dryLoad = await backfill.cmdLoad(loadOpts, { client, log: () => {} });
  check(
    "CLI load: --apply が無ければ書き込まない（終了コード0）",
    dryLoad === 0 && client.data.motor_pretest_stats.length === 0,
  );
  const applyOpts = { ...loadOpts, apply: true, sleepMs: 0 };
  const applied = await backfill.cmdLoad(applyOpts, {
    client,
    log: () => {},
    sleep: async () => {},
  });
  check(
    "CLI load --apply: 138行を書く（会場・日付ごと。キーが重複しない）",
    applied === 0 &&
      client.data.motor_pretest_stats.length === 138 &&
      new Set(
        client.data.motor_pretest_stats.map(
          (r) => `${r.race_date}|${r.venue_code}|${r.racer_id}`,
        ),
      ).size === 138,
    show({ applied, n: client.data.motor_pretest_stats.length }),
  );
  const upsertsBefore = client.writesTo("motor_pretest_stats").length;
  const reapplied = await backfill.cmdLoad(applyOpts, {
    client,
    log: () => {},
    sleep: async () => {},
  });
  check(
    "CLI load --apply: 2回目は、変更の無い行を書かない（upsert を呼ばない）",
    reapplied === 0 &&
      client.writesTo("motor_pretest_stats").length === upsertsBefore,
  );
  const noTable = await backfill.cmdLoad(applyOpts, {
    client: createFakeSupabaseClient({
      failOn: {
        "motor_pretest_stats:select":
          "Could not find the table 'public.motor_pretest_stats' in the schema cache",
      },
    }),
    log: () => {},
    sleep: async () => {},
  });
  check(
    "CLI load --apply: テーブルが無い（マイグレーション090が未適用）なら、書かずに失敗（終了コード1）",
    noTable === 1,
  );

  // 取得の安全策: 403が2回連続 → サーキットブレーカー（4）。データが無い・別のページが3回連続 → 4
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "motor-pretest-"));
  const opts2 = () => ({ ...optsFor(["--scope=all-days"]), archiveDir: tmp2 });
  requested.length = 0;
  const blocked = await backfill.cmdDownload(
    opts2(),
    depsFor(async () => ({ status: 403, body: "" })),
  );
  check(
    "CLI download: 403が2回連続したらサーキットブレーカー（終了コード4）で停止する",
    blocked === 4 && requested.length === 2,
    show({ blocked, n: requested.length }),
  );
  const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), "motor-pretest-"));
  requested.length = 0;
  const invalid = await backfill.cmdDownload(
    { ...optsFor(["--scope=all-days"]), archiveDir: tmp3 },
    depsFor(async () => ({ status: 200, body: NO_DATA })),
  );
  check(
    "CLI download: 開催のある会場×日のはずのページが「データがありません」を3回連続で返したら、内容が想定外として停止する（終了コード4）",
    invalid === 4 && requested.length === 3,
    show({ invalid, n: requested.length }),
  );
  const manifest3 = backfill.rawPath(tmp3, "02-20251203");
  check("CLI download: 想定外の内容は保存しない", !fs.existsSync(manifest3));
  const v = backfill.validateHtml(
    new TextEncoder().encode(asPage(TODA, 2, "2025-12-03")),
    { venueCode: 2, date: "2025-12-03" },
  );
  let mismatchThrown = null;
  try {
    backfill.validateHtml(new TextEncoder().encode(TODA), {
      venueCode: 2,
      date: "2025-12-03",
    });
  } catch (error) {
    mismatchThrown = error;
  }
  let venueMismatch = null;
  try {
    backfill.validateHtml(
      new TextEncoder().encode(asPage(TODA, 5, "2025-12-03")),
      {
        venueCode: 2,
        date: "2025-12-03",
      },
    );
  } catch (error) {
    venueMismatch = error;
  }
  check(
    "CLI 検査: 要求した会場・日付のページなら通し、別の日・別の会場のページは拒否する",
    v.status === "ok" &&
      mismatchThrown !== null &&
      /別のページ/.test(mismatchThrown.message) &&
      venueMismatch !== null &&
      /別のページ/.test(venueMismatch.message),
  );
  // 日次ジョブとCLIが、同じ取得ロジックを共有している（二重実装しない）
  check(
    "取得ロジックの共有: CLI は、日次ジョブと同じパーサー版・URL組み立て・行の組み立て・書き込みを使う",
    backfill.buildItems([{ venue_code: 2, race_date: "2025-12-03" }], {
      from: "2025-12-03",
      to: "2025-12-03",
      scope: "all-days",
    })[0].url === buildMotorPretestUrl(2, "2025-12-03") &&
      MOTOR_PRETEST_PARSER_VERSION === "rankingmotor/v1",
  );
  for (const dir of [tmp, tmp2, tmp3])
    fs.rmSync(dir, { recursive: true, force: true });
}

// ===========================================================================
// (e) 配線
// ===========================================================================
{
  const def = SCRAPE_JOBS.motor_pretest;
  check(
    "レジストリ: motor_pretest は日次・05:20指定・boatrace.jp・maxDuration300・整合性の検査が通る",
    def?.kind === "daily" &&
      def.targetTimeJst === "05:20" &&
      same(def.hosts, ["boatrace.jp"]) &&
      def.maxDurationSec === 300 &&
      validateRegistry().length === 0,
    show(validateRegistry()),
  );
  // api の本文の字は読まず、export（config・default）と、共通ラッパへ渡した引数で見る
  const api = await cronWiring(() => import("../../api/cron/motor-pretest.js"));
  check(
    "api/cron/motor-pretest.js: maxDuration はレジストリと同じ300・共通ラッパを job 名 motor_pretest で1回通し、その戻りを default export にする",
    api.config?.maxDuration === 300 &&
      api.made.length === 1 &&
      api.made[0].options.job === "motor_pretest" &&
      typeof api.made[0].options.run === "function" &&
      api.handler === api.made[0].handler,
    show({ config: api.config, jobs: api.made.map((m) => m.options.job) }),
  );
  const vercel = JSON.parse(
    fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"),
  );
  const crons = vercel.crons.filter(
    (c) => c.path === "/api/cron/motor-pretest",
  );
  const jstMinutes = (schedule) => {
    const [min, hour] = schedule.split(" ");
    return ((Number(hour) + 9) % 24) * 60 + Number(min);
  };
  check(
    "vercel.json: motor-pretest の cron は3本（UTC 20:30・21:00・21:30 = JST 05:30・06:00・06:30）",
    same(
      crons.map((c) => c.schedule),
      ["30 20 * * *", "0 21 * * *", "30 21 * * *"],
    ) &&
      same(
        crons.map((c) => jstMinutes(c.schedule)),
        [330, 360, 390],
      ),
    show(crons),
  );
  check(
    "vercel.json: 全ての起動が、オッズの運用窓（07:00〜23:59 JST）の外（07:00前）で、指定時刻(05:20)より後",
    crons.every(
      (c) =>
        jstMinutes(c.schedule) < 7 * 60 &&
        jstMinutes(c.schedule) >= 5 * 60 + 20,
    ),
  );
  check(
    "vercel.json: api/cron/*.js は syd1 に固定されている",
    same(vercel.functions?.["api/cron/*.js"]?.regions, ["syd1"]),
  );
  const res = { statusCode: null, body: null };
  res.status = (s) => ((res.statusCode = s), res);
  res.json = (b) => ((res.body = b), res);
  const prevSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "verify-secret";
  await api.handler({ headers: {} }, res);
  process.env.CRON_SECRET = prevSecret;
  check(
    "api/cron/motor-pretest.js: 認証なしのリクエストは401",
    res.statusCode === 401,
  );
}

if (failures > 0) {
  out.error(`\n${failures}件の検証が失敗しました`);
  process.exit(1);
}

// ---- 後半の場面（verifyData/motor-pretest-scenes-5.js） ----
runMotorPretestScenes6({ out, check, show, same });
