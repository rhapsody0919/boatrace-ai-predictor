/**
 * verify-codex-no-preview.js - codex/ のブランチで Vercel が Preview を作らない設定（vercel.json の
 * git.deploymentEnabled）を固定する。ファイルを読むだけで、ネットワークにも DB にも接続しない。
 *
 * 守るもの: Preview 環境には本番 DB の管理者キーが載る。Codex が書いたコードがそのキーを持って
 * Preview で動かないよう、codex/ のブランチは自動デプロイしない。
 *
 * 確認すること:
 *   (a) git.deploymentEnabled.["codex/**"] が false（"codex/*" だと codex/a/b を取りこぼすため ** を使う）
 *   (b) deploymentEnabled が真偽値の false ではない（全ブランチ・本番デプロイまで止めない）
 *   (c) codex/ に当たりうる true の規則が無い（Vercel はどれか1つでも true ならデプロイする）。true の規則は glob の記号を含まない名前だけ許す
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
const enabled = config.git?.deploymentEnabled;

// codex/ のブランチ名に当たりうる glob か。glob の記号を1つでも含むか、codex で始まるものは当たりうると見る
// （"c*/**" のように途中の記号でも当たるため、記号の位置では絞らない。true の規則は記号なしの名前だけ許す）
const mayMatchCodex = (pattern) => /^codex/.test(pattern) || /[*?[\]{}!+@()]/.test(pattern);

const failures = [
  typeof enabled === "object" && enabled !== null
    ? null
    : `git.deploymentEnabled がオブジェクトではない（${JSON.stringify(enabled)}）。false だと master の本番デプロイまで止まる`,
  enabled?.["codex/**"] === false
    ? null
    : `git.deploymentEnabled["codex/**"] が false ではない（${JSON.stringify(enabled?.["codex/**"])}）`,
  ...Object.entries(enabled ?? {})
    .filter(([pattern, value]) => value === true && mayMatchCodex(pattern))
    .map(([pattern]) => `"${pattern}": true が codex/ のブランチにも当たりうる（true の規則が1つでも当たるとデプロイされる）`),
].filter(Boolean);

if (failures.length > 0) {
  console.error("verify-codex-no-preview: 失敗");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log("verify-codex-no-preview: OK（codex/** の自動デプロイは無効、他のブランチと本番は既定のまま）");
