/**
 * 朝夜のまとめ（Slack）に流す「新しいブログの図の PNG」の行を作る（ADR 0099、docs/design/blog-charts/contract.md 8節）。
 *
 * 新しい = 指定の時刻より後に origin/master で足された・変わった図の JSON（public/blog-charts/*.json）。
 * 図ごとに本番の URL（/blog-charts/{id}.{preset}.png）を取り、PNG が配られているかを content-type と先頭8バイトで確かめる
 * （無い PNG は rewrite で 200 の index.html が返るので、status では判定できない）。作らなかった・失敗した理由は
 * 本番の /ai-snapshots/status.json の blogChartPng から添える。
 *
 * 使い方（オーケストレーターが朝夜のまとめを作るとき。前回のまとめの時刻を渡す）:
 *   git fetch origin master && node scripts/content/blog-chart-png-digest.js --since 2026-10-20T21:00+09:00
 * 出力: Slack にそのまま貼れる行。新しい図が無ければ「なし」の1行
 */
import { execFileSync } from "node:child_process";
import {
  BLOG_CHART_PNG_PRESETS,
  blogChartPngPath,
  blogChartPngSize,
  isPngResponse,
} from "../../src/utils/blogChartPng.js";

const SITE = "https://www.boat-ai.jp";

/** 指定の時刻より後に足された・変わった図の JSON の id（ファイル名）。消えたものは除く */
export function changedChartIds(gitLogOutput) {
  const ids = new Set();
  for (const line of gitLogOutput.split("\n")) {
    const m = line.trim().match(/^public\/blog-charts\/([a-z0-9-]+)\.json$/);
    if (m) ids.add(m[1]);
  }
  return [...ids].sort();
}

/** URL の返事が PNG か。先頭8バイトだけ読む */
async function checkPng(url) {
  const res = await fetch(url, { headers: { Range: "bytes=0-7" } });
  const head = new Uint8Array(await res.arrayBuffer()).slice(0, 8);
  return isPngResponse(res.headers.get("content-type"), head);
}

async function readStatus() {
  const res = await fetch(`${SITE}/ai-snapshots/status.json`);
  if (!res.ok) return null;
  try {
    return (await res.json()).blogChartPng ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {{ id: string, preset: string, ok: boolean }[]} checks
 * @param {object|null} status 本番の status.json の blogChartPng
 * @returns {string[]}
 */
export function digestLines(checks, status) {
  if (checks.length === 0) return ["新しいブログの図の画像: なし"];
  const lines = ["新しいブログの図の画像:"];
  for (const { id, preset, ok } of checks) {
    const key = `${id}.${preset}`;
    const { width, height } = blogChartPngSize(BLOG_CHART_PNG_PRESETS[preset]);
    const size = `${preset} ${width}×${height}`;
    if (ok) {
      lines.push(`- ${id}（${size}）: ${SITE}${blogChartPngPath(id, preset)}`);
      continue;
    }
    const reason =
      status?.skipped?.[key] ??
      status?.errors?.[key] ??
      "本番にまだ無い（デプロイ前か、ビルドで撮れなかった。/ai-snapshots/status.json を確認）";
    lines.push(`- ${id}（${size}）: 作られていない。${reason}`);
  }
  return lines;
}

async function main() {
  const i = process.argv.indexOf("--since");
  const since = i > 0 ? process.argv[i + 1] : null;
  if (!since) {
    throw new Error(
      "--since に前回のまとめの時刻を渡す（例 --since 2026-10-20T21:00+09:00）",
    );
  }
  const log = execFileSync(
    "git",
    [
      "log",
      "origin/master",
      `--since=${since}`,
      "--diff-filter=AM",
      "--name-only",
      "--format=",
      "--",
      "public/blog-charts/",
    ],
    { encoding: "utf8" },
  );
  const ids = changedChartIds(log);
  const checks = [];
  for (const id of ids) {
    for (const preset of Object.keys(BLOG_CHART_PNG_PRESETS)) {
      const ok = await checkPng(`${SITE}${blogChartPngPath(id, preset)}`);
      checks.push({ id, preset, ok });
    }
  }
  const status = ids.length > 0 ? await readStatus() : null;
  console.log(digestLines(checks, status).join("\n"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`図の画像の一覧を作れなかった: ${err.message}`);
    process.exit(1);
  });
}
