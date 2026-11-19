/**
 * verify-racer-snapshot-plan.js - 選手ページのスナップショットを作る範囲（scripts/lib/racerSnapshotPlan.js、BOA-848）の検証。
 *
 * - 本番のビルドだけで sitemap の全員を作る。Preview・手元では作らない（本番 DB に数千のリクエストを送らない）
 * - RACER_SNAPSHOT_LIMIT があれば本番以外でもその人数だけ作る。本番では無視する
 * - sitemap に載る選手（isRacerIndexable の集合）だけ。選手以外の URL・番号の形が違う URL は拾わない
 * - 本番では今の本番から写すか全員を描くかの判定（decideRacerSnapshotSource）、写した HTML の書き換えと参照の照合
 *   （adaptCopiedRacerHtml）、写せなかった選手だけ描くこと（Vercel の費用、2026-11-05、ADR 0032 追記）
 */
import {
  adaptCopiedRacerHtml,
  canSaveRacerSnapshot,
  decideRacerSnapshotSource,
  mainAssetsOf,
  olderIso,
  planRacerSnapshots,
  sourceChangedDuringCopy,
  RACER_SNAPSHOT_TEMPLATE_VERSION,
} from "../lib/racerSnapshotPlan.js";

import { readFileSync } from "node:fs";
import { renderWithFreshPage } from "../lib/renderWithFreshPage.js";
import { mapWithConcurrency } from "../lib/scrapeJobs/concurrency.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

const loc = (p) => `<url><loc>https://www.boat-ai.jp${p}</loc></url>`;
const sitemapXml = [
  loc("/"),
  loc("/racers"),
  loc("/racer/3256"),
  loc("/racer/3257"),
  loc("/racer/3304"),
  loc("/racer/3256"),
  loc("/blog/some-article"),
  loc("/racer/123"),
  loc("/en/racer/3999"),
].join("\n");

{
  const { ids } = planRacerSnapshots({ vercelEnv: "production", sitemapXml });
  check(
    "本番: sitemap の選手だけ、重複なしで全員",
    JSON.stringify(ids) === JSON.stringify(["3256", "3257", "3304"]),
    JSON.stringify(ids),
  );
}
{
  const { ids, reason } = planRacerSnapshots({
    vercelEnv: "production",
    limit: "1",
    sitemapXml,
  });
  check("本番: RACER_SNAPSHOT_LIMIT は無視して全員", ids.length === 3);
  check("本番: 無視したことを理由に出す", reason.includes("無視"));
}
for (const vercelEnv of ["preview", "development", undefined]) {
  const { ids } = planRacerSnapshots({ vercelEnv, sitemapXml });
  check(`${vercelEnv ?? "VERCEL_ENV なし"}: 作らない`, ids.length === 0);
  const empty = planRacerSnapshots({ vercelEnv, limit: "", sitemapXml });
  check(
    `${vercelEnv ?? "VERCEL_ENV なし"}: 空の RACER_SNAPSHOT_LIMIT では作らない`,
    empty.ids.length === 0,
  );
}
{
  const { ids } = planRacerSnapshots({
    vercelEnv: "preview",
    limit: "2",
    sitemapXml,
  });
  check(
    "Preview: RACER_SNAPSHOT_LIMIT=2 なら先頭2人",
    JSON.stringify(ids) === JSON.stringify(["3256", "3257"]),
    JSON.stringify(ids),
  );
}
{
  const { ids } = planRacerSnapshots({
    vercelEnv: "preview",
    limit: "50",
    sitemapXml,
  });
  check("Preview: 人数より大きい指定なら全員", ids.length === 3);
}
for (const limit of ["0", "-1", "abc", "2.5"]) {
  const { ids, reason } = planRacerSnapshots({
    vercelEnv: "preview",
    limit,
    sitemapXml,
  });
  check(
    `Preview: RACER_SNAPSHOT_LIMIT=${limit} は作らず、理由を出す`,
    ids.length === 0 && reason.includes("正の整数ではない"),
  );
}

// BOA-1183: 取得が遅い部品・空の正常完了・失敗を区別する。
const completedHtml = (motor = "done", history = "done") =>
  `<div data-snapshot-ready="true" data-snapshot-motor="${motor}"><section data-snapshot-history="${history}"></section></div>`;
check("全て完了したHTMLを保存する", canSaveRacerSnapshot(completedHtml()));
check("データなしの正常完了も保存する", canSaveRacerSnapshot(completedHtml("empty", "empty")));
for (const state of ["loading", "error"]) {
  check(`モーター ${state} は skipped`, !canSaveRacerSnapshot(completedHtml(state)));
  check(`履歴 ${state} は skipped`, !canSaveRacerSnapshot(completedHtml("done", state)));
}
check("集計中が残れば skipped", !canSaveRacerSnapshot(completedHtml() + "集計中…"));
check("読み込み中が残れば skipped", !canSaveRacerSnapshot(completedHtml() + "読み込み中..."));
check("ready が無ければ skipped", !canSaveRacerSnapshot(completedHtml().replace('data-snapshot-ready="true"', "")));
check("目印のない旧HTMLは skipped", !canSaveRacerSnapshot('<div data-snapshot-ready="true"></div>'));

// 実際の生成関数（写す道・描く道）だけを取り出し、ブラウザ・ファイルI/O・fetch・環境変数を差し替える。
// 生成スクリプトのトップレベル（本番向け生成）は実行しない。
const generatorSource = readFileSync(
  new URL("../generate-ai-snapshots.js", import.meta.url),
  "utf8",
);
const generatorBody = generatorSource.slice(
  generatorSource.indexOf("async function fetchFromSource("),
  generatorSource.indexOf("function generateWinningTechniqueSnapshot("),
);
const INDEX_HTML =
  '<script type="module" crossorigin src="/assets/main-NEW1.js"></script><link rel="stylesheet" crossorigin href="/assets/main-NEW2.css">';
function loadGenerator({
  ids = ["3256"],
  env = {},
  fetchImpl,
  distFiles = [],
  writes,
  removed = [],
  writeFile,
}) {
  return new Function(
    "planRacerSnapshots",
    "readFileSync",
    "statSync",
    "path",
    "DIST_DIR",
    "SNAPSHOT_DIR",
    "mkdirSync",
    "renderWithFreshPage",
    "RACER_CONCURRENCY",
    "dedupeDefaultTitle",
    "writeFileSync",
    "canSaveRacerSnapshot",
    "console",
    "process",
    "fetch",
    "RACER_SOURCE_ORIGIN",
    "RACER_COPY_CONCURRENCY",
    "mainAssetsOf",
    "adaptCopiedRacerHtml",
    "decideRacerSnapshotSource",
    "olderIso",
    "sourceChangedDuringCopy",
    "mapWithConcurrency",
    "rmSync",
    generatorBody + "; return generateRacerSnapshots;",
  )(
    () => ({ ids, reason: "test" }),
    (p) => (String(p).endsWith("index.html") ? INDEX_HTML : ""),
    (p) => {
      if (!distFiles.some((f) => String(p).endsWith(f)))
        throw new Error("ENOENT");
      return { isFile: () => true };
    },
    { join: (...parts) => parts.join("/") },
    "dist",
    "snapshots",
    () => {},
    renderWithFreshPage,
    1,
    (html) => html,
    writeFile ?? ((...args) => writes.push(args)),
    canSaveRacerSnapshot,
    { log() {}, error() {} },
    { env },
    fetchImpl ??
      (async () => {
        throw new Error("fetch は呼ばない");
      }),
    "https://src.example",
    4,
    mainAssetsOf,
    adaptCopiedRacerHtml,
    decideRacerSnapshotSource,
    olderIso,
    sourceChangedDuringCopy,
    mapWithConcurrency,
    (p) => removed.push(String(p)),
  );
}

for (const scenario of [
  "done",
  "empty",
  "loading",
  "error",
  "timeout",
  "closed",
  "noindex",
]) {
  const writes = [];
  let boundedWait = false;
  const page = {
    goto: async () => {},
    waitForSelector: async (selector, options) => {
      boundedWait =
        selector === '[data-snapshot-ready="true"]' &&
        options.timeout === 20000;
      if (scenario === "timeout" || scenario === "closed") {
        const err = new Error(scenario);
        err.name = scenario === "timeout" ? "TimeoutError" : "Error";
        throw err;
      }
    },
    getAttribute: async () => (scenario === "noindex" ? "noindex" : "index"),
    content: async () => completedHtml(scenario, scenario),
  };
  const generate = loadGenerator({ writes });
  const result = await generate(async () => page, "http://localhost");
  const save = scenario === "done" || scenario === "empty";
  check(`生成 ${scenario}: 有限の待機を使う`, boundedWait);
  check(`生成 ${scenario}: 保存件数`, writes.length === (save ? 1 : 0));
  check(
    `生成 ${scenario}: failed と skipped を分ける`,
    result.failed.length === (scenario === "closed" ? 1 : 0) &&
      result.skipped.length === (!save && scenario !== "closed" ? 1 : 0),
  );
}

// ---- 写す道（Vercel の費用、2026-11-05、ADR 0032 追記） ----
const NOW = Date.parse("2026-11-05T12:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();
const okStatus = (over = {}) => ({
  generatedAt: hoursAgo(1),
  racer: {
    total: 317,
    succeeded: 317,
    failedIds: [],
    skippedIds: [],
    fatalError: null,
    mode: "render",
    renderedAt: hoursAgo(3),
    templateVersion: RACER_SNAPSHOT_TEMPLATE_VERSION,
    ...over,
  },
});
{
  const d = decideRacerSnapshotSource({ sourceStatus: okStatus(), nowMs: NOW });
  check(
    "判定: 版が同じ・3時間前なら写す",
    d.mode === "copy" && d.renderedAt === hoursAgo(3),
    JSON.stringify(d),
  );
}
for (const [label, sourceStatus, extra] of [
  ["取れない（null）", null],
  ["racer の無い版", { generatedAt: hoursAgo(1), blog: {} }],
  [
    "写す道の前の版（templateVersion なし）",
    okStatus({
      templateVersion: undefined,
      mode: undefined,
      renderedAt: undefined,
    }),
  ],
  [
    "版が違う",
    okStatus({ templateVersion: RACER_SNAPSHOT_TEMPLATE_VERSION + 1 }),
  ],
  ["途中で止まった", okStatus({ fatalError: "boom" })],
  ["renderedAt が無い", okStatus({ renderedAt: undefined })],
  ["renderedAt が壊れている", okStatus({ renderedAt: "x" })],
  ["20時間を越えた", okStatus({ renderedAt: hoursAgo(20.1) })],
  ["未来の時刻（11分）", okStatus({ renderedAt: hoursAgo(-11 / 60) })],
  ["強制", okStatus(), { forceRender: true }],
]) {
  const d = decideRacerSnapshotSource({ sourceStatus, nowMs: NOW, ...extra });
  check(
    `判定: ${label} なら全員を描く`,
    d.mode === "render" && d.reason.length > 0,
    JSON.stringify(d),
  );
}
check(
  "判定: ちょうど20時間・9分先の時刻は写す（境界）",
  decideRacerSnapshotSource({
    sourceStatus: okStatus({ renderedAt: hoursAgo(20) }),
    nowMs: NOW,
  }).mode === "copy" &&
    decideRacerSnapshotSource({
      sourceStatus: okStatus({ renderedAt: hoursAgo(-9 / 60) }),
      nowMs: NOW,
    }).mode === "copy",
);
check("olderIso: 古い方", olderIso(hoursAgo(1), hoursAgo(5)) === hoursAgo(5));
check(
  "olderIso: 読めない方は捨てる",
  olderIso(undefined, hoursAgo(2)) === hoursAgo(2) &&
    olderIso("x", null) === null,
);
check(
  "mainAssetsOf: dist/index.html の main の js・css",
  JSON.stringify(mainAssetsOf(INDEX_HTML)) ===
    JSON.stringify({
      js: "/assets/main-NEW1.js",
      css: "/assets/main-NEW2.css",
    }),
);
check("mainAssetsOf: 無ければ null", mainAssetsOf("<html></html>") === null);

const copiedPage = (extra = "") =>
  `<html><head><link rel="stylesheet" crossorigin="" href="/assets/main-OLD9.css"><link rel="icon" href="/favicon.ico"></head>` +
  `<body><a href="/racer/3257">x</a><a href="https://www.boat-ai.jp/x.png">y</a><img src="//cdn.example/a.png">${completedHtml()}${extra}` +
  `<script type="module" crossorigin="" src="/assets/main-OLD8.js"></script></body></html>`;
const ctx = {
  mainAssets: { js: "/assets/main-NEW1.js", css: "/assets/main-NEW2.css" },
  distHas: (p) =>
    ["/assets/main-NEW1.js", "/assets/main-NEW2.css", "/favicon.ico"].includes(
      p,
    ),
};
{
  const r = adaptCopiedRacerHtml(copiedPage(), ctx);
  check(
    "写し: main の js・css をこのビルドのものに書き換える",
    r.ok &&
      r.html.includes('src="/assets/main-NEW1.js"') &&
      r.html.includes('href="/assets/main-NEW2.css"') &&
      !r.html.includes("OLD"),
    JSON.stringify(r).slice(0, 200),
  );
  check(
    "写し: 拡張子の無いリンク（/racer/3257）・外のドメイン・// は照合しない",
    r.ok,
  );
}
{
  const r = adaptCopiedRacerHtml(
    copiedPage('<img src="/assets/chunk-ABC.js?v=1">'),
    ctx,
  );
  check(
    "写し: このビルドに無い参照が1つでもあれば写さない",
    !r.ok && r.reason.includes("/assets/chunk-ABC.js"),
    JSON.stringify(r),
  );
}
{
  const r = adaptCopiedRacerHtml(copiedPage('<img src="/logo-gone.png">'), ctx);
  check(
    "写し: /assets 以外の固定名（public/）も照合する",
    !r.ok && r.reason.includes("/logo-gone.png"),
  );
}
{
  // 本番に無い番号は catch-all で 200 の SPA の外枠（約5KB）が返る（2026-11-05 実測 /ai-snapshots/racer/0001.html）
  const spaShell =
    '<!doctype html><html><head><script type="module" src="/assets/main-OLD8.js"></script></head><body><div id="root"></div></body></html>';
  check(
    "写し: 200 の SPA の外枠は写さない",
    !adaptCopiedRacerHtml(spaShell, ctx).ok,
  );
  check(
    "写し: noindex は写さない",
    !adaptCopiedRacerHtml(
      copiedPage().replace(
        "<head>",
        '<head><meta name="robots" content="noindex, follow">',
      ),
      ctx,
    ).ok,
  );
}

// 写す道を生成関数ごと通す: 写せた選手は描かず、写せなかった選手だけ描く。描いた時刻は元の古い方を引き継ぐ
{
  const writes = [];
  const rendered = [];
  let statusReads = 0;
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.endsWith("/ai-snapshots/status.json")) {
      statusReads += 1;
      // 写している間に alias が切り替わった（2回目はもっと古い版）
      const s =
        statusReads === 1
          ? okStatus({ renderedAt: hoursAgo(2) })
          : okStatus({ renderedAt: hoursAgo(6) });
      return { status: 200, text: async () => JSON.stringify(s) };
    }
    if (u.endsWith("/racer/1111.html"))
      return { status: 200, text: async () => copiedPage() };
    if (u.endsWith("/racer/2222.html"))
      return {
        status: 200,
        text: async () => '<html><div id="root"></div></html>',
      };
    if (u.endsWith("/racer/3333.html"))
      return { status: 403, text: async () => "forbidden" };
    throw Object.assign(new Error("net"), { name: "TypeError" });
  };
  const page = {
    goto: async (url) => rendered.push(String(url).split("/").pop()),
    waitForSelector: async () => {},
    getAttribute: async () => "index",
    content: async () => completedHtml(),
  };
  const generate = loadGenerator({
    ids: ["1111", "2222", "3333", "4444"],
    env: { VERCEL_ENV: "production" },
    fetchImpl,
    distFiles: [
      "/assets/main-NEW1.js",
      "/assets/main-NEW2.css",
      "/favicon.ico",
    ],
    writes,
  });
  const realNow = Date.now;
  Date.now = () => NOW;
  let r;
  try {
    r = await generate(async () => page, "http://localhost");
  } finally {
    Date.now = realNow;
  }
  check("写す道: mode=copy", r.mode === "copy", r.mode);
  check("写す道: 写せたのは1111だけ", r.copied === 1);
  check(
    "写す道: 写せなかった3人だけ描く",
    JSON.stringify(rendered.sort()) ===
      JSON.stringify(["2222", "3333", "4444"]),
    JSON.stringify(rendered),
  );
  check("写す道: 保存は4人", writes.length === 4 && r.rendered === 3);
  check(
    "写す道: 描いた時刻は読み直しと比べて古い方（6時間前）",
    r.renderedAt === hoursAgo(6),
    r.renderedAt,
  );
  check(
    "写す道: 写せなかった理由を件数で残す",
    r.copyFailures["HTTP 403"] === 1 &&
      r.copyFailures["取得の失敗: TypeError"] === 1 &&
      Object.keys(r.copyFailures).some((k) => k.startsWith("保存の目印が無い")),
    JSON.stringify(r.copyFailures),
  );
}
// 本番以外（RACER_SNAPSHOT_LIMIT の Preview）は写さず描く。status.json も読まない
{
  const writes = [];
  const generate = loadGenerator({ env: { VERCEL_ENV: "preview" }, writes });
  const page = {
    goto: async () => {},
    waitForSelector: async () => {},
    getAttribute: async () => "index",
    content: async () => completedHtml(),
  };
  const r = await generate(async () => page, "http://localhost");
  check(
    "Preview: 写さず描く（fetch を呼ばない）",
    r.mode === "render" && r.rendered === 1 && r.copied === 0,
  );
}
// 写す元の status.json が取れなければ全員を描く（今までの動き）
{
  const writes = [];
  const generate = loadGenerator({
    ids: ["1111", "2222"],
    env: { VERCEL_ENV: "production" },
    fetchImpl: async () => ({ status: 503, text: async () => "" }),
    writes,
  });
  const page = {
    goto: async () => {},
    waitForSelector: async () => {},
    getAttribute: async () => "index",
    content: async () => completedHtml(),
  };
  const r = await generate(async () => page, "http://localhost");
  check(
    "status.json が 503: 全員を描く",
    r.mode === "render" && r.rendered === 2 && r.copied === 0,
  );
}
// ---- /code-review の指摘の再現（PR #2286） ----
check(
  "sourceChangedDuringCopy: 読み直せない（null）なら写したまま",
  sourceChangedDuringCopy(null) === null,
);
check(
  "sourceChangedDuringCopy: 同じ版なら写したまま",
  sourceChangedDuringCopy(okStatus()) === null,
);
check(
  "sourceChangedDuringCopy: 版が変わった・止まった・racer が消えたら描き直す",
  sourceChangedDuringCopy(
    okStatus({ templateVersion: RACER_SNAPSHOT_TEMPLATE_VERSION + 1 }),
  ) !== null &&
    sourceChangedDuringCopy(okStatus({ fatalError: "boom" })) !== null &&
    sourceChangedDuringCopy({ generatedAt: hoursAgo(1) }) !== null,
);
const okPage = {
  goto: async () => {},
  waitForSelector: async () => {},
  getAttribute: async () => "index",
  content: async () => completedHtml(),
};
const runAt = async (generate) => {
  const realNow = Date.now;
  Date.now = () => NOW;
  try {
    return await generate(async () => okPage, "http://localhost");
  } finally {
    Date.now = realNow;
  }
};
{
  // 写している間に alias が版2（全員を描き直した版）へ切り替わった → 写した HTML を捨て、全員を描く
  const writes = [];
  const removed = [];
  let statusReads = 0;
  const generate = loadGenerator({
    ids: ["1111", "2222"],
    env: { VERCEL_ENV: "production" },
    distFiles: [
      "/assets/main-NEW1.js",
      "/assets/main-NEW2.css",
      "/favicon.ico",
    ],
    writes,
    removed,
    fetchImpl: async (url) => {
      if (String(url).endsWith("/status.json")) {
        statusReads += 1;
        const s =
          statusReads === 1
            ? okStatus()
            : okStatus({
                templateVersion: RACER_SNAPSHOT_TEMPLATE_VERSION + 1,
              });
        return { status: 200, text: async () => JSON.stringify(s) };
      }
      return { status: 200, text: async () => copiedPage() };
    },
  });
  const r = await runAt(generate);
  check(
    "指摘2: 写している間に版が変わったら写したものを消して全員を描く",
    r.mode === "render" &&
      r.copied === 0 &&
      r.rendered === 2 &&
      removed.length === 2 &&
      r.decisionReason.includes("版が変わった") &&
      r.renderedAt === new Date(NOW).toISOString(),
    JSON.stringify({ ...r, removed }),
  );
}
{
  // 1人の書き込みが失敗しても段全体を止めず、その選手は描く側へ
  const writes = [];
  let firstCopyWrite = true;
  const generate = loadGenerator({
    ids: ["1111", "2222"],
    env: { VERCEL_ENV: "production" },
    distFiles: [
      "/assets/main-NEW1.js",
      "/assets/main-NEW2.css",
      "/favicon.ico",
    ],
    writes,
    writeFile: (file, html) => {
      if (String(file).endsWith("1111.html") && firstCopyWrite) {
        firstCopyWrite = false;
        throw Object.assign(new Error("no space left"), { code: "ENOSPC" });
      }
      writes.push([file, html]);
    },
    fetchImpl: async (url) =>
      String(url).endsWith("/status.json")
        ? { status: 200, text: async () => JSON.stringify(okStatus()) }
        : { status: 200, text: async () => copiedPage() },
  });
  const r = await runAt(generate);
  check(
    "指摘3: 写した HTML の書き込みの失敗で段を止めず、その選手だけ描く",
    r.mode === "copy" &&
      r.copied === 1 &&
      r.rendered === 1 &&
      r.copyFailures["書き込みの失敗: ENOSPC"] === 1,
    JSON.stringify(r),
  );
}
{
  // 取得の失敗の理由に undici の err.cause.code を残す
  const generate = loadGenerator({
    ids: ["1111"],
    env: { VERCEL_ENV: "production" },
    writes: [],
    fetchImpl: async (url) => {
      if (String(url).endsWith("/status.json"))
        return { status: 200, text: async () => JSON.stringify(okStatus()) };
      throw Object.assign(new TypeError("fetch failed"), {
        cause: { code: "ECONNREFUSED" },
      });
    },
  });
  const r = await runAt(generate);
  check(
    "指摘4: 取得の失敗の理由に原因の code を残す",
    r.copyFailures["取得の失敗: TypeError ECONNREFUSED"] === 1,
    JSON.stringify(r.copyFailures),
  );
}

if (failures > 0) {
  console.error(`\n❌ ${failures}件の検証に失敗`);
  process.exit(1);
}
console.log("\n✅ 全ての検証に成功");
