#!/usr/bin/env node
/**
 * verify-pr-shape.js - PR の差分の形を機械で落とす（symlink・submodule・LFS・バイナリ・.gitattributes・上限超え）。
 *
 * もとは AI 審査（.github/workflows/review.yml の gate）の検査。ゼロベース再設計 v3.3（2026-11-06 オーナー決定 D2、
 * 別ベンダーの LLM 審査をやめる）で review.yml を外し、この検査だけを verify に移した。判定の関数は
 * scripts/lib/prShape.js の mechanicalRejections（gate と同じもの）。gate は GitHub の compare API の files を
 * 入力にしたので、ここは git の差分から同じ形を作って渡す。
 *
 * 確かめること:
 *   1. 判定（固定の入力。gate の試験 verify-review-workflow.js の 2・2b をそのまま移した）
 *   2. git の出力の読み取り（--raw -z・patch の取り出し）
 *   3. 一時の git の木で、git から作った入力の判定が、同じ差分を compare の形で書いた入力の判定と同じになる
 *   4. この PR の差分（merge-base から HEAD）。master の上（push の CI）では差分が空なので通る
 *
 * 使い方: node scripts/maintenance/verify-pr-shape.js --base=origin/master
 *   base を解決できない場合、CI（環境変数 CI が立っている）では失敗、手元ではスキップする。
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LIMITS,
  mechanicalRejections,
  isAllowedMedia,
  isHarmlessNoBody,
  parseRawDiff,
  patchOf,
  withoutAllowedNoBody,
} from "../lib/prShape.js";
import { shape, runPrShapeScenes2, runPrShapeScenes3 } from "./verifyData/pr-shape-scenes-2.js";
import { runPrShapeScenes1 } from "./verifyData/pr-shape-scenes-1.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures += 1;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

// 手元の git の設定（署名・フック・外部の diff）に左右されないようにする
const GIT_FLAGS = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.quotePath=false",
  "-c",
  "diff.renames=true",
];

function git(cwd, args) {
  return execFileSync("git", [...GIT_FLAGS, ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}

/**
 * base と head の merge-base から head までの差分を、compare の files と head の木のモードの形にする
 * @returns {{ files: { filename: string, status: string, patch?: string, previous_filename?: string }[], headModes: Map<string, string> }}
 */
function collectPrShape(cwd, base, head) {
  const mergeBase = git(cwd, ["merge-base", base, head]).trim();
  const entries = parseRawDiff(
    git(cwd, ["diff", "--raw", "-z", "-M", "--no-abbrev", mergeBase, head]),
  );
  const files = entries.map((e) => {
    const paths = e.previous_filename
      ? [e.previous_filename, e.filename]
      : [e.filename];
    const text = git(cwd, [
      "--literal-pathspecs",
      "diff",
      "-M",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      mergeBase,
      head,
      "--",
      ...paths,
    ]);
    return {
      filename: e.filename,
      status: e.status,
      // 消したファイルの本文は数えない（消すことは中身を持ち込まない。compare も大きいファイルは本文を返さず、
      // gate は大きいファイルの削除を上限に数えていなかった）
      patch: e.status === "removed" ? undefined : patchOf(text),
      ...(e.previous_filename
        ? { previous_filename: e.previous_filename }
        : {}),
    };
  });
  const headModes = new Map(
    entries
      .filter((e) => e.status !== "removed")
      .map((e) => [e.filename, e.dstMode]),
  );
  // 本文の無い差分のうち通してよい物: 空のファイル・実行権だけの変更（raw の SHA とモードで決まる）と、
  // 普通のファイル（symlink・submodule を除く）で先頭の16バイトが拡張子の印と合う画像等
  const byName = new Map(entries.map((e) => [e.filename, e]));
  const allowed = new Set(
    files
      .filter(
        (f) =>
          f.patch === undefined &&
          /^100(644|755)$/.test(headModes.get(f.filename) ?? ""),
      )
      .filter(
        (f) =>
          isHarmlessNoBody(byName.get(f.filename)) ||
          isAllowedMedia(
            f,
            execFileSync(
              "git",
              [...GIT_FLAGS, "cat-file", "blob", `${head}:${f.filename}`],
              { cwd, maxBuffer: 256 * 1024 * 1024 },
            ).subarray(0, 16),
          ),
      )
      .map((f) => f.filename),
  );
  return { files, headModes, allowed };
}

// ---- 後半の場面（verifyData/pr-shape-scenes-1.js・pr-shape-scenes-2.js） ----
runPrShapeScenes1({ check });
runPrShapeScenes2({ ROOT, check, git, collectPrShape });

// 3. 一時の git の木で、git から作った入力と compare の形で書いた入力の判定が同じ
{
  const dir = mkdtempSync(path.join(os.tmpdir(), "verify-pr-shape-"));
  try {
    const g = (...args) => git(dir, args);
    g("init", "-q", "-b", "main");
    g("config", "user.name", "verify");
    g("config", "user.email", "verify@example.invalid");
    const write = (p, body) => {
      mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
      writeFileSync(path.join(dir, p), body);
    };
    write("src/a.js", "export const a = 1;\n");
    write("moved-from.js", "export const moved = 1;\n".repeat(5));
    write("old.bin", Buffer.from([0, 1, 2, 3]));
    write("run.sh", "echo ok\n");
    const lfsPointer = (oid) =>
      `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize 10\n`;
    write("ptr.dat", lfsPointer("aaa"));
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "base");

    // 普通の変更・symlink・バイナリ・.gitattributes・.gitmodules・LFS のポインタ・中身を変えない改名・submodule・バイナリの削除
    write("src/a.js", "export const a = 2;\n");
    symlinkSync("src/a.js", path.join(dir, "link"));
    write("img.bin", Buffer.from([0x50, 0x00, 0x4e, 0x47]));
    write("docs/.gitattributes", "*.bin binary\n");
    write(".gitmodules", '[submodule "vendor/x"]\n\tpath = vendor/x\n');
    write(
      "big.dat",
      "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 10\n",
    );
    g("mv", "moved-from.js", "moved-to.js");
    g("rm", "-q", "old.bin");
    // 画像: 本物の PNG の印（通す）と、拡張子だけ .png で中身が違う物（落とす）
    const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d];
    write("docs/design/x/mock/a-375.png", Buffer.from(PNG));
    write(
      "public/fake.png",
      Buffer.from([0x63, 0x00, 0x6e, 0x73, 0x6f, 0x6c, 0x65]),
    );
    // 空のファイル（通す）・実行権だけの変更（通す）・既にある LFS のポインタの oid の変更（落とす）
    write("data/.gitkeep", "");
    chmodSync(path.join(dir, "run.sh"), 0o755);
    write("ptr.dat", lfsPointer("bbb"));
    g("add", "-A");
    g(
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${"b".repeat(40)},vendor/x`,
    );
    g("commit", "-q", "-m", "head");

    const fromGit = collectPrShape(dir, "base", "HEAD");
    const gitReasons = mechanicalRejections(
      fromGit.files,
      fromGit.headModes,
      false,
    ).sort();

    // 同じ差分を GitHub の compare の形で書いたもの（gate.js が受け取っていた入力）
    const f = (filename, status, patch, extra = {}) => ({
      filename,
      status,
      patch,
      ...extra,
    });
    const expectedFiles = [
      f(
        ".gitmodules",
        "added",
        '@@ -0,0 +1,2 @@\n+[submodule "vendor/x"]\n+\tpath = vendor/x',
      ),
      f(
        "big.dat",
        "added",
        "@@ -0,0 +1,3 @@\n+version https://git-lfs.github.com/spec/v1\n+oid sha256:abc\n+size 10",
      ),
      f("data/.gitkeep", "added", undefined),
      f("docs/.gitattributes", "added", "@@ -0,0 +1 @@\n+*.bin binary"),
      f("docs/design/x/mock/a-375.png", "added", undefined),
      f(
        "ptr.dat",
        "modified",
        "@@ -1,3 +1,3 @@\n version https://git-lfs.github.com/spec/v1\n-oid sha256:aaa\n+oid sha256:bbb\n size 10",
      ),
      f("run.sh", "modified", undefined),
      f("img.bin", "added", undefined),
      f(
        "link",
        "added",
        "@@ -0,0 +1 @@\n+src/a.js\n\\ No newline at end of file",
      ),
      f("moved-to.js", "renamed", undefined, {
        previous_filename: "moved-from.js",
      }),
      f("old.bin", "removed", undefined),
      f("public/fake.png", "added", undefined),
      f(
        "src/a.js",
        "modified",
        "@@ -1 +1 @@\n-export const a = 1;\n+export const a = 2;",
      ),
      f(
        "vendor/x",
        "added",
        `@@ -0,0 +1 @@\n+Subproject commit ${"b".repeat(40)}`,
      ),
    ];
    const expectedModes = new Map([
      [".gitmodules", "100644"],
      ["big.dat", "100644"],
      ["data/.gitkeep", "100644"],
      ["ptr.dat", "100644"],
      ["run.sh", "100755"],
      ["docs/.gitattributes", "100644"],
      ["docs/design/x/mock/a-375.png", "100644"],
      ["img.bin", "100644"],
      ["public/fake.png", "100644"],
      ["link", "120000"],
      ["moved-to.js", "100644"],
      ["src/a.js", "100644"],
      ["vendor/x", "160000"],
    ]);
    const expectedReasons = mechanicalRejections(
      expectedFiles,
      expectedModes,
      false,
    ).sort();

    check(
      "一時の木: ファイルの一覧・状態・改名元が compare の形と同じ",
      JSON.stringify(
        fromGit.files
          .map((x) => [x.filename, x.status, x.previous_filename ?? null])
          .sort(),
      ) ===
        JSON.stringify(
          expectedFiles
            .map((x) => [x.filename, x.status, x.previous_filename ?? null])
            .sort(),
        ),
      JSON.stringify(fromGit.files.map((x) => [x.filename, x.status])),
    );
    check(
      "一時の木: head のモードが compare の形と同じ",
      JSON.stringify([...fromGit.headModes].sort()) ===
        JSON.stringify([...expectedModes].sort()),
      JSON.stringify([...fromGit.headModes]),
    );
    check(
      "一時の木: 判定が gate（compare の形の入力）と同じ",
      JSON.stringify(gitReasons) === JSON.stringify(expectedReasons),
      `git: ${JSON.stringify(gitReasons)} / compare: ${JSON.stringify(expectedReasons)}`,
    );
    for (const kind of [
      "シンボリックリンク",
      "submodule",
      "submodule の設定の変更",
      "Git LFS のポインタ",
      ".gitattributes の変更",
      "img.bin: 差分の本文が無い",
      "moved-to.js: 差分の本文が無い",
      "ptr.dat: Git LFS のポインタ",
    ]) {
      check(
        `一時の木: 落とす理由に「${kind}」がある`,
        gitReasons.some((r) => r.includes(kind)),
      );
    }
    check(
      "一時の木: 普通の変更とバイナリの削除は落とさない",
      !gitReasons.some(
        (r) => r.startsWith("src/a.js") || r.startsWith("old.bin"),
      ),
    );

    // verify で足した線: 印の合う画像・空のファイル・実行権だけの変更を gate の判定から外す（他の理由は gate のまま）
    const allowedNames = [
      "data/.gitkeep",
      "docs/design/x/mock/a-375.png",
      "run.sh",
    ];
    check(
      "一時の木: 通すのは印の合う PNG・空のファイル・実行権だけ（拡張子だけの .png・バイナリ・symlink は通さない）",
      JSON.stringify([...fromGit.allowed].sort()) ===
        JSON.stringify(allowedNames),
      JSON.stringify([...fromGit.allowed]),
    );
    const finalReasons = withoutAllowedNoBody(gitReasons, fromGit.allowed);
    check(
      "一時の木: 外すのは通すファイルの「差分の本文が無い」3件だけ",
      JSON.stringify(finalReasons) ===
        JSON.stringify(
          gitReasons.filter(
            (r) => !allowedNames.some((n) => r.startsWith(`${n}: `)),
          ),
        ) && finalReasons.length === gitReasons.length - 3,
      JSON.stringify(finalReasons),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (failures > 0) {
  console.error(`NG: 差分の形の検査の試験が ${failures} 件失敗`);
  process.exit(1);
}

// 4. この PR の差分
const base =
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--base="))
    .map((a) => a.slice("--base=".length))
    .pop() || "origin/master";

// ---- 後半の場面（verifyData/pr-shape-scenes-2.js） ----
runPrShapeScenes3({ ROOT, check, git, collectPrShape, base });

if (shape.files.length === 0) {
  console.log(`OK: ${base}...HEAD に差分が無い（master の上）`);
  process.exit(0);
}
const reasons = withoutAllowedNoBody(
  mechanicalRejections(shape.files, shape.headModes, false),
  shape.allowed,
);
if (reasons.length > 0) {
  console.error(`NG: PR（${base}...HEAD）の差分の形を機械の検査で落とした`);
  for (const r of reasons) console.error(`  - ${r}`);
  console.error(
    "\nsymlink・submodule・LFS・バイナリ（先頭の印が合う png・jpg・gif・webp・wav・mp4・woff2・ttf・gz の追加と変更は除く）・" +
      ".gitattributes・中身を変えない改名は PR に入れない。" +
      `ファイルは ${LIMITS.maxFiles} 件・差分は ${LIMITS.maxPatchChars} 字まで（大きい PR は分ける）。`,
  );
  process.exit(1);
}
console.log(
  `OK: PR（${base}...HEAD、${shape.files.length}ファイル）の差分の形に問題なし`,
);
