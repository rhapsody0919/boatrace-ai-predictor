/**
 * 動画（sns-video-studio/remotion）の字はネットから読まない（2026-11-04、Noto Sans JP を同梱）の検査。
 *
 * 1. remotion の src・scripts・package.json・package-lock.json に @remotion/google-fonts と
 *    fonts.googleapis.com・fonts.gstatic.com の URL が無い（1頁ごとに 484 回の読み取りに戻さない）
 * 2. fonts.js は同梱の woff2 を import し @remotion/fonts で読む。staticFile では読まない（f01・人気薄の1着は --public-dir が別のフォルダ）
 * 3. 同梱の woff2・OFL.txt があり、字の範囲（coverage.js）がその woff2 から作ったもの（sha256 が一致）
 * 4. 豆腐の検査（glyphCoverage.js）: 同梱に無い字（ハングル・絵文字）を拾い、ある字（漢字・かな・英数・記号）と空白は拾わない
 * 5. 全貌（FullPicture）・f01（F01Landscape・F01Thumb）・節の機力・人気薄の1着の型が useGlyphGuard を呼ぶ
 * 6. f01 の撮影用の頁（龍神のサイトの src/snsCapture/、index.html、src の CSS）も Google Fonts を読まない
 *
 * 描いたときにネットを読まないこと自体（Chromium の通信の数）は、この検査では見ない（描くのに数分かかり、CI に Chromium の描画の環境が無い）。
 * PR の本文に前後の実測（読み取り 3,388 → 0）を残した。外部接続なし・同じコミットなら同じ結果（tier=ci）。
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REMOTION = join(ROOT, "sns-video-studio/remotion");
const FONT_DIR = join(REMOTION, "src/fonts/noto-sans-jp");
const GOOGLE_URL = /https?:\/\/fonts\.(googleapis|gstatic)\.com/;
const read = (p) => readFileSync(p, "utf8");
/** コメントを除いた本文（コメントの説明の語で落とさない） */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");

/** dir の下のファイル（node_modules・out は見ない） */
function files(dir, test) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === "out") return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p, test) : test(p) ? [p] : [];
  });
}

const failures = [];
const check = (name, fn) => {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(
      `not ok - ${name}\n  ${String(e.message).split("\n").join("\n  ")}`,
    );
  }
};

check(
  "1. remotion に @remotion/google-fonts と Google Fonts の URL が無い",
  () => {
    const code = [
      ...files(join(REMOTION, "src"), (p) =>
        /\.(jsx?|mjs|cjs|css|html)$/.test(p),
      ),
      ...files(join(REMOTION, "scripts"), (p) => /\.(jsx?|mjs|cjs)$/.test(p)),
      join(REMOTION, "package.json"),
      join(REMOTION, "package-lock.json"),
      join(REMOTION, "remotion.config.js"),
    ];
    const bad = code.filter((p) => {
      const s = read(p);
      return (
        /@remotion\/google-fonts/.test(stripComments(s)) || GOOGLE_URL.test(s)
      );
    });
    assert.deepEqual(
      bad.map((p) => relative(ROOT, p)),
      [],
      "Google Fonts を読む所がある",
    );
  },
);

check(
  "2. fonts.js は同梱の woff2 を import して @remotion/fonts の loadFont で読む",
  () => {
    const s = read(join(REMOTION, "src/fonts.js"));
    assert.match(s, /import \{ loadFont \} from "@remotion\/fonts";/);
    // remotion/no-react を loadFont より先に評価させる（後だと delayRender の印の表が作り直され、動画の描画が 28 秒で止まる。fonts.js の注記）
    const noReact = s.indexOf('import "remotion/no-react";');
    assert.ok(
      noReact >= 0 && noReact < s.indexOf('from "@remotion/fonts"'),
      'fonts.js は @remotion/fonts より前に import "remotion/no-react"; を置く',
    );
    assert.match(
      s,
      /import \w+ from "\.\/fonts\/noto-sans-jp\/NotoSansJP-wght\.woff2";/,
    );
    assert.doesNotMatch(
      stripComments(s),
      /staticFile/,
      "staticFile では --public-dir を替える描画でフォントが見つからない",
    );
    const pkg = JSON.parse(read(join(REMOTION, "package.json")));
    assert.ok(
      pkg.dependencies["@remotion/fonts"],
      "package.json に @remotion/fonts が無い",
    );
  },
);

const coverage = (
  await import("../../sns-video-studio/remotion/src/fonts/noto-sans-jp/coverage.js")
).default;
check(
  "3. 同梱の woff2・OFL.txt があり、coverage.js がその woff2 から作ったもの",
  () => {
    const woff2 = readFileSync(join(FONT_DIR, coverage.font));
    assert.equal(
      woff2.subarray(0, 4).toString("latin1"),
      "wOF2",
      "woff2 でない",
    );
    assert.equal(
      createHash("sha256").update(woff2).digest("hex"),
      coverage.sha256,
      "coverage.js が今の woff2 と合わない（build.py で作り直す）",
    );
    assert.match(
      read(join(FONT_DIR, "OFL.txt")),
      /SIL Open Font License, Version 1\.1/,
    );
    const n = coverage.ranges.reduce((s, [a, b]) => s + (b - a + 1), 0);
    assert.equal(n, coverage.count, "範囲の字の数が count と合わない");
  },
);

{
  const { missingGlyphs, isCovered } =
    await import("../../sns-video-studio/remotion/src/fonts/glyphCoverage.js");
  check("4. 豆腐の検査: 同梱に無い字だけを拾う", () => {
    assert.deepEqual(
      missingGlyphs(
        "龍神レーダー 1号艇の1着率 59.9%（4,159件）・ＳＧ\n髙﨑 ①②",
      ),
      [],
    );
    assert.deepEqual(missingGlyphs("한국어 🐉"), ["한", "국", "어", "🐉"]);
    assert.deepEqual(
      missingGlyphs(" 　​️"),
      [],
      "空白・ゼロ幅・異体字の印は数えない",
    );
    assert.equal(isCovered("龍".codePointAt(0)), true);
    assert.equal(isCovered("한".codePointAt(0)), false);
  });
}

check("5. 全貌・f01・節の機力・人気薄の1着の型が useGlyphGuard を呼ぶ", () => {
  const want = {
    "src/fullPicture/FullPicture.jsx": ["FullPicture"],
    "src/fullPicture/F01.jsx": ["F01Landscape", "F01Thumb"],
    "src/setsuKiryoku/SetsuKiryoku.jsx": ["SetsuKiryokuShort"],
    "src/upsetWin/UpsetWin.jsx": ["UpsetWinShort"],
  };
  for (const [file, names] of Object.entries(want)) {
    const s = stripComments(read(join(REMOTION, file)));
    assert.match(
      s,
      /import \{ useGlyphGuard \} from "\.\.\/fonts\/useGlyphGuard\.js";/,
      `${file} が useGlyphGuard を import しない`,
    );
    for (const name of names) {
      const at = s.indexOf(`export function ${name}(`);
      assert.ok(at >= 0, `${file} に ${name} が無い`);
      // 関数の頭（次の export まで）で呼ぶ
      const next = s.indexOf("\nexport ", at + 1);
      assert.match(
        s.slice(at, next < 0 ? undefined : next),
        /\n {2}useGlyphGuard\(\);/,
        `${file} の ${name} が useGlyphGuard() を呼ばない`,
      );
    }
  }
});

check("6. f01 の撮影用の頁（龍神のサイト）も Google Fonts を読まない", () => {
  const site = [
    join(ROOT, "index.html"),
    ...files(join(ROOT, "src/snsCapture"), () => true),
    ...files(join(ROOT, "src"), (p) => p.endsWith(".css")),
  ];
  const bad = site.filter((p) => GOOGLE_URL.test(read(p)));
  assert.deepEqual(
    bad.map((p) => relative(ROOT, p)),
    [],
  );
});

if (failures.length) {
  console.error(`\n${failures.length} 件の検査に落ちた`);
  process.exit(1);
}
console.log("\nすべて通った");
