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

// 1. 判定（固定の入力）
{
  const file = (filename, extra = {}) => ({
    filename,
    status: "modified",
    patch: "@@ -1 +1 @@\n-a\n+b",
    changes: 2,
    ...extra,
  });
  const modes = (...names) => new Map(names.map((n) => [n, "100644"]));
  check(
    "普通の差分は通る",
    mechanicalRejections([file("src/a.js")], modes("src/a.js"), false)
      .length === 0,
  );
  const cases = {
    差分が無い: [[], modes(), false],
    件数の上限: [
      Array.from({ length: LIMITS.maxFiles + 1 }, (_, i) => file(`f${i}.js`)),
      modes(
        ...Array.from({ length: LIMITS.maxFiles + 1 }, (_, i) => `f${i}.js`),
      ),
      false,
    ],
    差分の大きさの上限: [
      [file("a.js", { patch: "x".repeat(LIMITS.maxPatchChars + 1) })],
      modes("a.js"),
      false,
    ],
    木が切られた: [[file("a.js")], modes("a.js"), true],
    ".gitattributes": [
      [file("docs/.gitattributes")],
      modes("docs/.gitattributes"),
      false,
    ],
    ".gitattributes への改名": [
      [file("x", { status: "renamed", previous_filename: ".gitattributes" })],
      modes("x"),
      false,
    ],
    ".gitmodules": [[file(".gitmodules")], modes(".gitmodules"), false],
    "バイナリ（patch が無い）": [
      [file("img.png", { patch: undefined })],
      modes("img.png"),
      false,
    ],
    "LFS のポインタ": [
      [
        file("big.bin", {
          patch: "+version https://git-lfs.github.com/spec/v1",
        }),
      ],
      modes("big.bin"),
      false,
    ],
    シンボリックリンク: [[file("link")], new Map([["link", "120000"]]), false],
    submodule: [[file("vendor/x")], new Map([["vendor/x", "160000"]]), false],
    "head の木に無い": [[file("ghost.js")], modes(), false],
  };
  for (const [name, args] of Object.entries(cases)) {
    check(
      `落とす: ${name}`,
      mechanicalRejections(...args).length > 0,
      JSON.stringify(mechanicalRejections(...args)),
    );
  }
  check(
    "消したファイルは木に無くてよい",
    mechanicalRejections(
      [file("old.js", { status: "removed" })],
      modes(),
      false,
    ).length === 0,
  );
  check(
    "上限ちょうど（299件・20万字）は通る",
    mechanicalRejections(
      Array.from({ length: LIMITS.maxFiles }, (_, i) =>
        file(`f${i}.js`, {
          patch: i === 0 ? "x".repeat(LIMITS.maxPatchChars) : "",
        }),
      ),
      modes(...Array.from({ length: LIMITS.maxFiles }, (_, i) => `f${i}.js`)),
      false,
    ).length === 0,
  );

  // 本文の無い差分は、消したファイル以外は全部落とす（gate の独立レビューの P0-1・P1-3）
  const nul = {
    filename: "src/evil.js",
    status: "modified",
    patch: undefined,
    changes: 0,
  };
  check(
    "落とす: NUL を含みバイナリ扱いの JS（changes 0・patch なし）",
    mechanicalRejections([nul], modes("src/evil.js"), false).length > 0,
  );
  const mv = {
    filename: ".github/workflows/x.yml",
    status: "renamed",
    previous_filename: "docs/samples/ci.yml",
    patch: undefined,
    changes: 0,
  };
  check(
    "落とす: 中身を変えない改名（中身を危険な場所へ移す）",
    mechanicalRejections([mv], modes(".github/workflows/x.yml"), false).length >
      0,
  );
  const cp = {
    filename: "api/x.js",
    status: "copied",
    previous_filename: "docs/x.js",
    patch: undefined,
    changes: 0,
  };
  check(
    "落とす: 中身を変えない複製",
    mechanicalRejections([cp], modes("api/x.js"), false).length > 0,
  );
  const rm = {
    filename: "img/old.png",
    status: "removed",
    patch: undefined,
    changes: 0,
  };
  check(
    "消したバイナリは通る",
    mechanicalRejections([rm], modes(), false).length === 0,
  );

  // LFS は足した行の頭のポインタだけ（verify で絞った線。gate は本文のどこかに URL があれば落とした）
  const lfsUrl = ["https://git-lfs", "github.com/spec/v1"].join(".");
  check(
    "通す: 試験の文字列の中の LFS の URL",
    mechanicalRejections(
      [
        file("t.js", {
          patch: `@@ -0,0 +1 @@\n+  const p = "version ${lfsUrl}";`,
        }),
      ],
      modes("t.js"),
      false,
    ).length === 0,
  );
  check(
    "通す: 消したファイルの LFS のポインタ",
    mechanicalRejections(
      [
        file("old.dat", {
          status: "removed",
          patch: `@@ -1 +0,0 @@\n-version ${lfsUrl}`,
        }),
      ],
      modes(),
      false,
    ).length === 0,
  );
  check(
    "落とす: 変更で足した行の頭の LFS のポインタ",
    mechanicalRejections(
      [file("a.dat", { patch: `@@ -1 +1 @@\n-x\n+version ${lfsUrl}` })],
      modes("a.dat"),
      false,
    ).length > 0,
  );
}

// 2. git の出力の読み取り
{
  const sha = "a".repeat(40);
  const zero = "0".repeat(40);
  const raw = [
    `:100644 100644 ${sha} ${sha} M`,
    "src/a b.js",
    `:000000 120000 ${zero} ${sha} A`,
    "link",
    `:100644 100644 ${sha} ${sha} R100`,
    "old.js",
    "new.js",
    `:100644 000000 ${sha} ${zero} D`,
    "gone.png",
    "",
  ].join("\0");
  const parsed = parseRawDiff(raw);
  check(
    "--raw -z を読む（空白を含む名前・改名の2つのパス・削除）",
    JSON.stringify(
      parsed.map(({ filename, previous_filename, status, dstMode }) => ({
        filename,
        ...(previous_filename ? { previous_filename } : {}),
        status,
        dstMode,
      })),
    ) ===
      JSON.stringify([
        { filename: "src/a b.js", status: "modified", dstMode: "100644" },
        { filename: "link", status: "added", dstMode: "120000" },
        {
          filename: "new.js",
          previous_filename: "old.js",
          status: "renamed",
          dstMode: "100644",
        },
        { filename: "gone.png", status: "removed", dstMode: "000000" },
      ]),
    JSON.stringify(parsed),
  );
  check(
    "--raw -z の元のモードと SHA を読む",
    parsed[1].srcMode === "000000" &&
      parsed[1].srcSha === zero &&
      parsed[1].dstSha === sha,
  );

  // 本文が無くても中身を隠さない差分（verify で足した線）
  const EMPTY = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";
  const e = (status, srcMode, dstMode, srcSha, dstSha) => ({
    status,
    srcMode,
    dstMode,
    srcSha,
    dstSha,
  });
  check(
    "通す: 空のファイルの追加（.gitkeep）",
    isHarmlessNoBody(e("added", "000000", "100644", zero, EMPTY)),
  );
  check(
    "通す: 中身を変えない実行権の変更",
    isHarmlessNoBody(e("modified", "100644", "100755", sha, sha)),
  );
  check(
    "通さない: 中身も変わったバイナリ（モードが変わっても）",
    !isHarmlessNoBody(e("modified", "100644", "100755", sha, "c".repeat(40))),
  );
  check(
    "通さない: 空でない本文の無い追加",
    !isHarmlessNoBody(e("added", "000000", "100644", zero, sha)),
  );
  check(
    "通さない: 空の symlink・submodule",
    !isHarmlessNoBody(e("added", "000000", "120000", zero, EMPTY)) &&
      !isHarmlessNoBody(e("added", "000000", "160000", zero, EMPTY)),
  );
  check(
    "通さない: 普通のファイルから symlink への変更",
    !isHarmlessNoBody(e("modified", "100644", "120000", sha, sha)),
  );
  check(
    "通さない: 中身を変えない改名",
    !isHarmlessNoBody(e("renamed", "100644", "100644", sha, sha)),
  );
  let threw = false;
  try {
    parseRawDiff(":garbage\0x\0");
  } catch {
    threw = true;
  }
  check("読めない --raw の行は止める（黙って通さない）", threw);
  check(
    "patch は最初の @@ から（diff --git・index・---・+++ の頭を除く。compare の patch と同じ）",
    patchOf(
      "diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n",
    ) === "@@ -1 +1 @@\n-a\n+b",
  );
  check(
    "バイナリは patch なし",
    patchOf(
      "diff --git a/x b/x\nindex 1..2\nBinary files a/x and b/x differ\n",
    ) === undefined,
  );
  check(
    "中身を変えない改名は patch なし",
    patchOf(
      "diff --git a/a b/b\nsimilarity index 100%\nrename from a\nrename to b\n",
    ) === undefined,
  );
}

// 2b. 通してよい画像等（verify で足した線）
{
  const png = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...Array(12).fill(0)]);
  const webp = Uint8Array.from([
    0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0,
  ]);
  const mp4 = Uint8Array.from([
    0,
    0,
    0,
    0x20,
    0x66,
    0x74,
    0x79,
    0x70,
    ...Array(8).fill(0),
  ]);
  const add = (filename) => ({ filename, status: "added", patch: undefined });
  check("通す: PNG の印の .png", isAllowedMedia(add("a.png"), png));
  check(
    "通す: JPEG の印の .JPG（大文字の拡張子）",
    isAllowedMedia(add("a.JPG"), jpg),
  );
  check("通す: WebP の印の .webp", isAllowedMedia(add("a.webp"), webp));
  check("通す: ftyp の .mp4", isAllowedMedia(add("v.mp4"), mp4));
  check(
    "通す: 変更（modified）",
    isAllowedMedia({ ...add("a.png"), status: "modified" }, png),
  );
  check("通さない: 印の違う .png", !isAllowedMedia(add("a.png"), jpg));
  check("通さない: PNG の印の .js", !isAllowedMedia(add("a.js"), png));
  check("通さない: 拡張子なし", !isAllowedMedia(add("png"), png));
  check(
    "通さない: 一覧に無い拡張子（.lzh）",
    !isAllowedMedia(add("a.lzh"), png),
  );
  check(
    "通す: gzip の印の .json.gz（試験の固定データ）",
    isAllowedMedia(
      add("f.json.gz"),
      Uint8Array.from([0x1f, 0x8b, 0x08, ...Array(13).fill(0)]),
    ),
  );
  check(
    "通さない: 中身を変えない改名",
    !isAllowedMedia({ ...add("a.png"), status: "renamed" }, png),
  );
  check("通さない: 読めない", !isAllowedMedia(add("a.png"), null));
  check(
    "通さない: 本文のある差分（patch がある）",
    !isAllowedMedia({ ...add("a.png"), patch: "@@" }, png),
  );
  check(
    "外すのは通すファイルの「差分の本文が無い」だけ（同じ名で始まる別のファイル・別の理由は残す）",
    JSON.stringify(
      withoutAllowedNoBody(
        [
          "a.png: 差分の本文が無い（…）",
          "a.png.js: 差分の本文が無い（…）",
          "a.png: シンボリックリンク",
        ],
        new Set(["a.png"]),
      ),
    ) ===
      JSON.stringify([
        "a.png.js: 差分の本文が無い（…）",
        "a.png: シンボリックリンク",
      ]),
  );
}

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

// base を解決できないときだけ手元で飛ばす。差分の読み取りの失敗（読めない raw・大きすぎる blob 等）は手元でも落とす
try {
  git(ROOT, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
} catch (err) {
  const message = `base（${base}）を解決できませんでした: ${String(err.message).split("\n")[0]}`;
  if (process.env.CI) {
    console.error(`NG: ${message}`);
    process.exit(1);
  }
  console.log(`スキップ: ${message}（手元のため。CIでは失敗扱い）`);
  process.exit(0);
}
let shape;
try {
  shape = collectPrShape(ROOT, base, "HEAD");
} catch (err) {
  console.error(
    `NG: ${base}...HEAD の差分を読めない（読めない差分は通さない）: ${String(err.message).split("\n")[0]}`,
  );
  process.exit(1);
}

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
