/**
 * verify-snapshot-status.js - AI スナップショット生成の結果のまとめ（scripts/lib/snapshotStatus.js）の検証。
 *
 * 生成の失敗はビルドを止めない代わりに、ログの最後のまとめと /ai-snapshots/status.json で見えるようにする
 * （SEO 再点検 F5）。失敗を「OK」と書いてしまうと、#1393 の前と同じく気づけなくなる。
 */
import { summarizeSnapshotRun } from "../lib/snapshotStatus.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

const at = "2026-10-12T00:00:00.000Z";

{
  const { status, lines } = summarizeSnapshotRun({
    total: 121,
    failed: [],
    generatedAt: at,
  });
  check(
    "全件成功なら ok: true、成功件数は総数",
    status.ok === true && status.blog.succeeded === 121,
  );
  check(
    "全件成功のまとめに警告の印を付けない",
    !lines.join("\n").includes("⚠️"),
  );
}

{
  const failed = [
    {
      id: "beginner-basics",
      error:
        "page.goto: Target page, context or browser has been closed\nCall log: ...",
    },
    { id: "betting-strategy", error: "timeout" },
  ];
  const { status, lines } = summarizeSnapshotRun({
    total: 121,
    failed,
    relaunches: 2,
    generatedAt: at,
  });
  const text = lines.join("\n");
  check("失敗があれば ok: false", status.ok === false);
  check("成功件数は総数から失敗を引いた数", status.blog.succeeded === 119);
  check(
    "失敗した記事の ID を status に残す",
    JSON.stringify(status.blog.failedIds) ===
      JSON.stringify(["beginner-basics", "betting-strategy"]),
  );
  check(
    "まとめに件数と警告の印を出す",
    text.includes("119/121") && text.includes("⚠️"),
  );
  check(
    "まとめに失敗した記事の ID とエラーの1行目を出す（Call log は出さない）",
    text.includes("beginner-basics: page.goto") && !text.includes("Call log"),
  );
  check(
    "起動し直した回数を残す",
    status.browserRelaunches === 2 && text.includes("2 回起動し直した"),
  );
}

{
  const { status, lines } = summarizeSnapshotRun({
    total: 121,
    failed: [],
    fatalError: "browser.newPage: closed",
    generatedAt: at,
  });
  check(
    "途中で止まったら ok: false（失敗0件でも OK にしない）",
    status.ok === false,
  );
  check(
    "途中で止まったら成功件数を出さない（何件書けたか分からない）",
    status.blog.succeeded === null,
  );
  check(
    "途中で止まった理由をまとめに出す",
    lines.join("\n").includes("途中で止まった") &&
      status.blog.fatalError === "browser.newPage: closed",
  );
}

if (failures > 0) {
  console.error(`\n❌ ${failures}件の検証に失敗`);
  process.exit(1);
}
console.log("\n✅ 全ての検証に成功");
