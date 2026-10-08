/**
 * index.html の <body> に google-anno-skip クラスが付いていることを確かめる（BOA-786）。
 *
 * AdSense の自動広告は、本文の語句をリンクにする「広告インテント」（ad intent links・アンカー・チップ）を
 * 差し込む。本文に「競艇AI予想」等の語句リンクが出ていた。画面内に「競艇」を出さない規則
 * （.claude/rules/code-style.md）と、AI予想と誤解させない方針に反する。管理画面では設定を外せなかった。
 * Google のヘルプ（https://support.google.com/adsense/answer/13844047）では、body に
 * google-anno-skip を付けるとそのページ全体で広告インテントを出さない。
 *
 * SPA なので全ルートが index.html の <body> を共有する。src/ で body の class を書き換える処理は無い
 * （追加するなら google-anno-skip を消さないこと）。
 *
 * 引数でファイルを渡すと、そのファイルを検査する（例: dist/index.html）。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const target =
  process.argv[2] ?? fileURLToPath(new URL("../../index.html", import.meta.url));
const html = readFileSync(target, "utf-8");

const bodyTags = [...html.matchAll(/<body\b([^>]*)>/gi)];
const classAttr = bodyTags[0]?.[1].match(/\bclass\s*=\s*(["'])(.*?)\1/i);
const classes = classAttr ? classAttr[2].split(/\s+/).filter(Boolean) : [];

const failures = [];
const check = (label, ok) => {
  console.log(`  ${ok ? "OK" : "NG"}  ${label}`);
  if (!ok) failures.push(label);
};

console.log(`検査対象: ${target}`);
check("<body> タグが1つだけある", bodyTags.length === 1);
check("<body> に class=\"google-anno-skip\" が付いている", classes.includes("google-anno-skip"));

if (failures.length > 0) {
  console.error(
    `\nNG ${failures.length}件。AdSense の広告インテント（本文の語句リンク等）が出る状態です（BOA-786）。`,
  );
  process.exit(1);
}
console.log("\nOK");
