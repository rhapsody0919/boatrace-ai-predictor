/**
 * verify-pr-shape.js の後半の場面（1/2）。verify ではない。
 * 判定と期待値は分ける前の verify-pr-shape.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  mechanicalRejections,
  LIMITS,
  parseRawDiff,
  isHarmlessNoBody,
  patchOf,
} from "../../lib/prShape.js";

let check;

/** 元の verify の1つの塊 { } を割った 1/3 */
function scene1() {
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
  return { file, modes };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
function scene2({ file, modes }) {
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
  return { file, modes, lfsUrl };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
function scene3({ file, modes, lfsUrl }) {
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

/** 元の verify の1つの塊 { } を割った 1/2 */
function scene4() {
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
  return { sha, e };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene5({ sha, e }) {
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

function scene6() {
  {
    const s1 = scene1();
    const s2 = scene2(s1);
    scene3(s2);
  }
  {
    const s1 = scene4();
    scene5(s1);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check） */
export function runPrShapeScenes1(env) {
  ({ check } = env);
  scene6();
}
