/**
 * AI の PR の審査（.github/workflows/review.yml）の各段で使う小さな道具。Node の組み込みだけを使う（npm ci をしないため）。
 */
import { appendFileSync } from "node:fs";

export function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

export function requireEnv(name, re = /\S/) {
  const value = process.env[name];
  if (!value || !re.test(value)) fail(`env ${name} が無いか、形が違う`);
  return value;
}

/** $GITHUB_OUTPUT に1行の値を書く（改行を含む値は書かない） */
export function setOutput(name, value) {
  const text = String(value);
  if (/[\r\n]/.test(text)) fail(`出力 ${name} に改行がある`);
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${name}=${text}\n`);
  else console.log(`${name}=${text}`);
}

/** GitHub API。失敗は握りつぶさず止める（取れない事実を「無い」と扱うと、検査が通る側に倒れうるため） */
export async function gh(token, method, pathAndQuery, body) {
  const res = await fetch(`https://api.github.com${pathAndQuery}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok)
    fail(
      `GitHub API ${method} ${pathAndQuery.split("?")[0]} が ${res.status} を返した`,
    );
  return res.json();
}

/** base...head の差分（merge-base から）と、head の木のモード */
export async function fetchDiff(token, repo, baseSha, headSha) {
  const compare = await gh(
    token,
    "GET",
    `/repos/${repo}/compare/${baseSha}...${headSha}`,
  );
  const files = (compare.files ?? []).map((f) => ({
    filename: f.filename,
    status: f.status,
    patch: f.patch,
    changes: f.changes,
    previous_filename: f.previous_filename,
  }));
  const tree = await gh(
    token,
    "GET",
    `/repos/${repo}/git/trees/${headSha}?recursive=1`,
  );
  const changed = new Set(files.map((f) => f.filename));
  const headModes = new Map(
    (tree.tree ?? [])
      .filter((e) => changed.has(e.path))
      .map((e) => [e.path, e.mode]),
  );
  return { files, headModes, treeTruncated: tree.truncated === true };
}
