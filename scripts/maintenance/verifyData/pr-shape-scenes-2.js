/**
 * verify-pr-shape.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-pr-shape.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { isAllowedMedia, withoutAllowedNoBody } from "../../lib/prShape.js";

let ROOT, check, git, base;

function scene1() {
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（ROOT・check・git） */
export function runPrShapeScenes2(env) {
  ({ ROOT, check, git } = env);
  scene1();
}

function scene2() {
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（ROOT・check・git・base） */
export function runPrShapeScenes3(env) {
  ({ ROOT, check, git, base } = env);
  scene2();
}
