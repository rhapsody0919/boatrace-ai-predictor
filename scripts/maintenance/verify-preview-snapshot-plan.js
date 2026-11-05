/**
 * verify-preview-snapshot-plan.js - ブログ・翻訳・一覧のボット向けスナップショットを Preview で作るか
 * （scripts/lib/previewSnapshotPlan.js、Vercel の費用 2026-11-05、ADR 0032 追記）の検証。
 *
 * - 本番・手元（VERCEL_ENV が preview 以外）は必ず作る（本番のボット向け HTML を欠かさない）
 * - Preview は既定で作らない。コミットのメッセージの [bot-html] か BOT_SNAPSHOTS_ON_PREVIEW=1 で作る
 * - 生成スクリプトが VERCEL_GIT_COMMIT_MESSAGE・BOT_SNAPSHOTS_ON_PREVIEW を渡し、作らないときはブログ等を呼ばないこと
 */
import { readFileSync } from "node:fs";
import {
  planBlogSnapshots,
  PREVIEW_BOT_HTML_MARKER,
} from "../lib/previewSnapshotPlan.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

for (const vercelEnv of ["production", "development", undefined]) {
  const p = planBlogSnapshots({ vercelEnv, commitMessage: "feat: x" });
  check(`${vercelEnv ?? "VERCEL_ENV なし"}: 作る`, p.build === true, p.reason);
}
{
  const p = planBlogSnapshots({
    vercelEnv: "preview",
    commitMessage: "feat: x",
  });
  check(
    "Preview: 既定では作らない・理由に印の名前",
    p.build === false && p.reason.includes(PREVIEW_BOT_HTML_MARKER),
    p.reason,
  );
}
{
  const p = planBlogSnapshots({ vercelEnv: "preview" });
  check("Preview: メッセージが無くても作らない", p.build === false);
}
check("印は [bot-html]", PREVIEW_BOT_HTML_MARKER === "[bot-html]");
{
  const p = planBlogSnapshots({
    vercelEnv: "preview",
    commitMessage:
      "chore: Preview でボット向け HTML を確かめる [bot-html]\n\n本文",
  });
  check(
    "Preview: メッセージに [bot-html] なら作る",
    p.build === true,
    p.reason,
  );
}
for (const optIn of ["1", "true"]) {
  const p = planBlogSnapshots({
    vercelEnv: "preview",
    commitMessage: "x",
    optIn,
  });
  check(
    `Preview: BOT_SNAPSHOTS_ON_PREVIEW=${optIn} なら作る`,
    p.build === true,
  );
}
for (const optIn of ["0", "", "false"]) {
  const p = planBlogSnapshots({
    vercelEnv: "preview",
    commitMessage: "x",
    optIn,
  });
  check(
    `Preview: BOT_SNAPSHOTS_ON_PREVIEW=${JSON.stringify(optIn)} では作らない`,
    p.build === false,
  );
}
check(
  "本番では印が無くても作る（[bot-html] は Preview だけの開く鍵）",
  planBlogSnapshots({ vercelEnv: "production", optIn: "0" }).build === true,
);

// 生成スクリプトの配線（判定の結果でブログ等を呼ぶか、status に作らなかった理由を書くか）
const source = readFileSync(
  new URL("../generate-ai-snapshots.js", import.meta.url),
  "utf8",
);
check(
  "生成: VERCEL_ENV・VERCEL_GIT_COMMIT_MESSAGE・BOT_SNAPSHOTS_ON_PREVIEW を渡す",
  /planBlogSnapshots\(\{\s*vercelEnv: process\.env\.VERCEL_ENV,\s*commitMessage: process\.env\.VERCEL_GIT_COMMIT_MESSAGE,\s*optIn: process\.env\.BOT_SNAPSHOTS_ON_PREVIEW,?\s*\}\)/.test(
    source,
  ),
);
check(
  "生成: 作らないときはブログ・翻訳・一覧を呼ばない",
  /if \(blogPlan\.build\) \{\s*\(\{ failed, translatedResult, listResult \} = await generateBlogFamily\(/.test(
    source,
  ),
);
check(
  "生成: 作らなかった理由を status.json に渡す",
  /skipped: blogPlan\.build \? null : blogPlan\.reason/.test(source),
);

if (failures > 0) {
  console.error(`\n❌ ${failures}件の検証に失敗`);
  process.exit(1);
}
console.log("\n✅ 全ての検証に成功");
