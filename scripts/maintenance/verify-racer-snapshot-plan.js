/**
 * verify-racer-snapshot-plan.js - 選手ページのスナップショットを作る範囲（scripts/lib/racerSnapshotPlan.js、BOA-848）の検証。
 *
 * - 本番のビルドだけで sitemap の全員を作る。Preview・手元では作らない（本番 DB に数千のリクエストを送らない）
 * - RACER_SNAPSHOT_LIMIT があれば本番以外でもその人数だけ作る。本番では無視する
 * - sitemap に載る選手（isRacerIndexable の集合）だけ。選手以外の URL・番号の形が違う URL は拾わない
 */
import { canSaveRacerSnapshot, planRacerSnapshots } from "../lib/racerSnapshotPlan.js";

import { readFileSync } from "node:fs";
import { renderWithFreshPage } from "../lib/renderWithFreshPage.js";

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

// 実際の生成関数だけを取り出し、ブラウザとファイルI/Oを差し替える。
// 生成スクリプトのトップレベル（本番向け生成）は実行しない。
const generatorSource = readFileSync(new URL("../generate-ai-snapshots.js", import.meta.url), "utf8");
const generatorBody = generatorSource.slice(
  generatorSource.indexOf("async function generateRacerSnapshots("),
  generatorSource.indexOf("function generateWinningTechniqueSnapshot("),
);
for (const scenario of ["done", "empty", "loading", "error", "timeout", "closed", "noindex"]) {
  const writes = [];
  let boundedWait = false;
  const page = {
    goto: async () => {},
    waitForSelector: async (selector, options) => {
      boundedWait = selector === '[data-snapshot-ready="true"]' && options.timeout === 20000;
      if (scenario === "timeout" || scenario === "closed") {
        const err = new Error(scenario);
        err.name = scenario === "timeout" ? "TimeoutError" : "Error";
        throw err;
      }
    },
    getAttribute: async () => scenario === "noindex" ? "noindex" : "index",
    content: async () => completedHtml(scenario, scenario),
  };
  const generate = new Function(
    "planRacerSnapshots", "readFileSync", "path", "DIST_DIR", "SNAPSHOT_DIR",
    "mkdirSync", "renderWithFreshPage", "RACER_CONCURRENCY", "dedupeDefaultTitle",
    "writeFileSync", "canSaveRacerSnapshot", "console",
    generatorBody + "; return generateRacerSnapshots;",
  )(
    () => ({ ids: ["3256"], reason: "test" }), () => "", { join: (...parts) => parts.join("/") },
    "dist", "snapshots", () => {}, renderWithFreshPage, 1, (html) => html,
    (...args) => writes.push(args), canSaveRacerSnapshot, { log() {}, error() {} },
  );
  const result = await generate(async () => page, "http://localhost");
  const save = scenario === "done" || scenario === "empty";
  check(`生成 ${scenario}: 有限の待機を使う`, boundedWait);
  check(`生成 ${scenario}: 保存件数`, writes.length === (save ? 1 : 0));
  check(`生成 ${scenario}: failed と skipped を分ける`,
    result.failed.length === (scenario === "closed" ? 1 : 0) &&
    result.skipped.length === (!save && scenario !== "closed" ? 1 : 0));
}

if (failures > 0) {
  console.error(`\n❌ ${failures}件の検証に失敗`);
  process.exit(1);
}
console.log("\n✅ 全ての検証に成功");
