/**
 * verify-kyotei-wording.js - src/ に「競艇」の新しい行が入っていないかを見る（ボートレースで統一）。
 * 決まりの正本は .claude/rules/code-style.md「用語・表記」（理由と例外1・2）。文書で言うだけだった禁止を機械にする。
 * ファイルを読むだけで、ネットワークにも DB にも接続しない。
 *
 * 範囲: src/ の全ての文字のファイル（画面の本文・見出し・UI 文言・locales・meta を作るコード）。
 *   src/data/blog-posts/ は除く（記事は scripts/content/content-pr-gate.json の kyoteiExceptions・kyoteiMetaAllowedKeys が見る。
 *   ここでも見ると、記事の meta の「競艇」＝オーナー決定 2026-10-20 で通す物を落とすため）。
 *   SNS の本文は sns-video-studio/remotion/risk-rules.json と送信の受け取りの検査が見るので、ここでは見ない。
 *
 * 判定: 「競艇」を含む行を（ファイル, 行の中身の trim）で数え、kyotei-wording-allowlist.json の行と突き合わせる。
 *   - 一覧に無い行があれば失敗（新しい「競艇」）。meta（<title>・description・keywords・OGP）は例外1で使ってよいが、
 *     暫定の措置で後で一括で外すため、一覧に足して PR 本文に書く（code-style.md 例外1）
 *   - 一覧にあるが src/ に無い行も失敗（外した・直した後の一覧の残骸。一覧から消す）
 *   画面の文か meta かを機械では分けられないので、今ある行を一覧で固定し、新しい行は人が一覧に足して通す形にした。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ALLOWLIST = path.join(
  ROOT,
  "scripts/maintenance/kyotei-wording-allowlist.json",
);
const WORD = "競艇";
const SCAN_DIR = "src";
const EXCLUDE_DIRS = ["src/data/blog-posts"];
const TEXT_EXT = /\.(js|jsx|mjs|cjs|ts|tsx|json|css|html|md|txt|svg)$/;

const walk = (rel) =>
  fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true }).flatMap((d) => {
    const child = `${rel}/${d.name}`;
    if (d.isDirectory()) return EXCLUDE_DIRS.includes(child) ? [] : walk(child);
    return TEXT_EXT.test(d.name) ? [child] : [];
  });

const keyOf = ({ file, line }) => `${file}\n${line}`;

const found = walk(SCAN_DIR).flatMap((file) =>
  fs
    .readFileSync(path.join(ROOT, file), "utf8")
    .split("\n")
    .map((text, i) => ({ file, line: text.trim(), lineNo: i + 1 }))
    .filter(({ line }) => line.includes(WORD)),
);

const allowed = JSON.parse(fs.readFileSync(ALLOWLIST, "utf8")).entries;
const allowedKeys = new Set(allowed.map(keyOf));
const foundKeys = new Set(found.map(keyOf));

const fresh = found.filter((f) => !allowedKeys.has(keyOf(f)));
const stale = allowed.filter((a) => !foundKeys.has(keyOf(a)));

if (fresh.length > 0 || stale.length > 0) {
  console.error("verify-kyotei-wording: NG");
  fresh.forEach(({ file, lineNo, line }) =>
    console.error(
      `  - 新しい「競艇」: ${file}:${lineNo}  ${line.slice(0, 120)}\n` +
        "    画面の本文・見出し・UI なら「ボートレース」に直す。meta（例外1）なら kyotei-wording-allowlist.json に足し、PR 本文に書く",
    ),
  );
  stale.forEach(({ file, line }) =>
    console.error(
      `  - 一覧の残骸（src に無い）: ${file}  ${line.slice(0, 120)}\n` +
        "    kyotei-wording-allowlist.json から消す",
    ),
  );
  process.exit(1);
}
console.log(
  `verify-kyotei-wording: OK（src の「競艇」${found.length} 行は全て一覧の既存の行。blog-posts は content-pr-gate が見る）`,
);
