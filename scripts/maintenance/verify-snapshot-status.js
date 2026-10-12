/**
 * verify-snapshot-status.js - AI スナップショット生成の結果のまとめ（scripts/lib/snapshotStatus.js）の検証。
 *
 * 生成の失敗はビルドを止めない代わりに、ログの最後のまとめと /ai-snapshots/status.json で見えるようにする
 * （SEO 再点検 F5）。失敗を「OK」と書いてしまうと、#1393 の前と同じく気づけなくなる。
 */
import {
  summarizeSnapshotRun,
  addSnapshotGroup,
  failedSnapshotGroups,
} from "../lib/snapshotStatus.js";
import { evaluateSnapshotStatus } from "../lib/botHtmlParity.js";

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

// ---- 翻訳記事・一覧（BOA-848 第2段） ----
{
  const { status, lines } = summarizeSnapshotRun({
    total: 121,
    failed: [],
    generatedAt: at,
  });
  for (const lang of ["en", "zh-TW", "ko"]) {
    addSnapshotGroup(status, lines, `blogI18n.${lang}`, {
      total: 25,
      failed: [],
    });
  }
  addSnapshotGroup(status, lines, "blogList", { total: 4, failed: [] });
  check(
    "翻訳・一覧が全件成功なら ok のまま、言語ごとの件数を残す",
    status.ok === true &&
      status.blogI18n.en.succeeded === 25 &&
      status.blogI18n["zh-TW"].total === 25 &&
      status.blogList.succeeded === 4,
  );
  check(
    "全件成功なら失敗の一覧は空",
    failedSnapshotGroups(status).length === 0,
  );
  const ev = evaluateSnapshotStatus(200, JSON.stringify(status));
  check(
    "照合の判定: ok で、翻訳と一覧の件数を出す",
    ev.level === "ok" &&
      ev.message.includes("en 25/25") &&
      ev.message.includes("一覧 4/4"),
    ev.message,
  );
}
{
  const { status, lines } = summarizeSnapshotRun({
    total: 121,
    failed: [],
    generatedAt: at,
  });
  addSnapshotGroup(status, lines, "blogI18n.en", { total: 25, failed: [] });
  addSnapshotGroup(status, lines, "blogI18n.ko", {
    total: 25,
    failed: [{ id: "beginner-basics", error: "timeout" }],
  });
  addSnapshotGroup(status, lines, "blogList", {
    total: null,
    failed: [],
    fatalError: "browser closed",
  });
  const text = lines.join("\n");
  check("翻訳が1件でも失敗したら ok: false", status.ok === false);
  check(
    "言語ごとの失敗した ID を残す",
    status.blogI18n.ko.succeeded === 24 &&
      status.blogI18n.ko.failedIds[0] === "beginner-basics" &&
      status.blogI18n.en.failedIds.length === 0,
  );
  check(
    "一覧が途中で止まったら成功件数を出さない",
    status.blogList.succeeded === null &&
      status.blogList.fatalError === "browser closed",
  );
  check(
    "まとめに警告の行を出す（最後の区切りより前）",
    text.includes("blogI18n.ko 24/25") &&
      text.includes("blogList の生成が途中で止まった") &&
      lines[lines.length - 1].startsWith("="),
  );
  const ev = evaluateSnapshotStatus(200, JSON.stringify(status));
  check(
    "照合の判定: ja が全件でも fail にし、失敗した組を出す",
    ev.level === "fail" &&
      ev.message.includes("blogI18n.ko") &&
      ev.message.includes("blogList"),
    ev.message,
  );
}
{
  // 足す前の版の status.json（blogI18n・blogList が無い）は従来どおり読める
  const { status } = summarizeSnapshotRun({
    total: 121,
    failed: [],
    generatedAt: at,
  });
  const ev = evaluateSnapshotStatus(200, JSON.stringify(status));
  check(
    "翻訳・一覧の無い status.json は従来どおりの ok",
    ev.level === "ok" && ev.message.startsWith("ブログ 121/121 件（"),
    ev.message,
  );
}

if (failures > 0) {
  console.error(`\n❌ ${failures}件の検証に失敗`);
  process.exit(1);
}
console.log("\n✅ 全ての検証に成功");
