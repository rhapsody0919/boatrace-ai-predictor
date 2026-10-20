/**
 * 朝夜のまとめ（Slack）に流す「新しいブログの図の PNG」の行を作る（ADR 0099、docs/design/blog-charts/contract.md 8節）。
 *
 * 新しい = 前回のまとめから、本番に配られている版（status.json の blogChartPng.commit）までに足された・変わった
 * 図の JSON（public/blog-charts/*.json）。上限を配られた版にするのは、マージ直後（ビルド中）の図を「まだ無い」と出して
 * 次のまとめの窓から落とさないため。出力の最後の行に、次に渡す --since（配られた版）を出す。
 * 図ごとに本番の URL（/blog-charts/{id}.{preset}.png）を取り、PNG が配られているかを content-type と先頭8バイトで確かめる
 * （無い PNG は rewrite で 200 の index.html が返るので、status では判定できない）。作らなかった・失敗した理由は
 * 本番の /ai-snapshots/status.json の blogChartPng から添える。
 *
 * 使い方（オーケストレーターが朝夜のまとめを作るとき）。--since は前回の出力の最後の行のコミット。初回だけ時刻でよい:
 *   git fetch origin master && node scripts/content/blog-chart-png-digest.js --since 3255c4a51
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

/**
 * 窓の始まりのコミット。since がコミットならそのまま、時刻なら upTo の履歴でその時刻より前の最後のコミット
 * @param {string} since 前回のまとめのコミット（7〜40桁の16進）か時刻
 * @param {string} upTo 本番に配られている版のコミット
 * @param {(args: string[]) => string} git
 */
export function resolveSince(since, upTo, git) {
  if (/^[0-9a-f]{7,40}$/.test(since)) return since;
  const sha = git(["rev-list", "-1", `--before=${since}`, upTo]).trim();
  if (!sha) throw new Error(`${since} より前のコミットが ${upTo} の履歴に無い`);
  return sha;
}

/**
 * 窓の中で足された・変わった図の JSON を出す git の引数。git log でなく2点の diff にするのは、窓の中で足して消した
 * JSON を拾わず、名前を変えた JSON（新しい id）を A として拾うため（代わりの審査 P3-4）
 */
export function gitDiffArgs(fromSha, upTo) {
  return [
    "diff",
    "--no-renames",
    "--diff-filter=AM",
    "--name-only",
    fromSha,
    upTo,
    "--",
    "public/blog-charts/",
  ];
}

/** git diff の出力から図の JSON の id（ファイル名）を取る */
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
  if (!res.ok) throw new Error(`status.json が HTTP ${res.status}`);
  const png = (await res.json())?.blogChartPng;
  if (!png) {
    throw new Error(
      "status.json に blogChartPng が無い（書き出す版がまだ本番に無いか、記事のスナップショットの生成が途中で止まった）",
    );
  }
  if (png.fatalError) {
    throw new Error(
      `本番のビルドで図の PNG の書き出しが途中で止まった: ${png.fatalError}`,
    );
  }
  if (!png.commit) {
    throw new Error(
      "status.json に blogChartPng.commit が無い（VERCEL_GIT_COMMIT_SHA の無いビルド）",
    );
  }
  return png;
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
      "本番に無い（ビルドで撮れなかった。/ai-snapshots/status.json を確認）";
    lines.push(`- ${id}（${size}）: 作られていない。${reason}`);
  }
  return lines;
}

async function main() {
  const i = process.argv.indexOf("--since");
  const since = i > 0 ? process.argv[i + 1] : null;
  if (!since) {
    throw new Error(
      "--since に前回の出力の最後の行のコミット（初回は時刻 2026-10-20T21:00+09:00 の形）を渡す",
    );
  }
  const status = await readStatus();
  const git = (args) => execFileSync("git", args, { encoding: "utf8" });
  const log = git(
    gitDiffArgs(resolveSince(since, status.commit, git), status.commit),
  );
  const ids = changedChartIds(log);
  const checks = [];
  for (const id of ids) {
    for (const preset of Object.keys(BLOG_CHART_PNG_PRESETS)) {
      const ok = await checkPng(`${SITE}${blogChartPngPath(id, preset)}`);
      checks.push({ id, preset, ok });
    }
  }
  console.log(
    [
      ...digestLines(checks, status),
      `（次のまとめは --since ${status.commit.slice(0, 9)}）`,
    ].join("\n"),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`図の画像の一覧を作れなかった: ${err.message}`);
    process.exit(1);
  });
}
