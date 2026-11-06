/**
 * verify-codex-no-preview.js - AI の枝（codex/・claude/）で Vercel が Preview を作らない設定（vercel.json の
 * git.deploymentEnabled）を固定する。ファイルを読むだけで、ネットワークにも DB にも接続しない。
 *
 * 守るもの: Preview 環境には本番 DB の管理者キーが載る。AI が書いたコードがレビュー・マージの前にそのキーを持って
 * Preview で動かないよう、AI の枝は自動デプロイしない。codex/ は Codex（2026-10）、claude/ は Claude
 * （2026-11-06 オーナー決定。画面の確認は手元の dev サーバーと Playwright で行う）。
 *
 * 確認すること（接頭辞ごと）:
 *   (a) git.deploymentEnabled.["<接頭辞>/**"] が false（"<接頭辞>/*" だと <接頭辞>/a/b を取りこぼすため ** を使う）
 *   (b) deploymentEnabled が真偽値の false ではない（全ブランチ・本番デプロイまで止めない）
 *   (c) AI の枝に当たりうる true の規則が無い（Vercel はどれか1つでも true ならデプロイする）。true の規則は glob の記号を含まない名前だけ許す
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PREFIXES = ["codex", "claude"];

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const config = JSON.parse(
  fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"),
);
const enabled = config.git?.deploymentEnabled;

// AI の枝の名前に当たりうる glob か。glob の記号を1つでも含むか、接頭辞で始まるものは当たりうると見る
// （"c*/**" のように途中の記号でも当たるため、記号の位置では絞らない。true の規則は記号なしの名前だけ許す）
const mayMatchAiBranch = (pattern) =>
  PREFIXES.some((prefix) => pattern.startsWith(prefix)) ||
  /[*?[\]{}!+@()]/.test(pattern);

const failures = [
  typeof enabled === "object" && enabled !== null
    ? null
    : `git.deploymentEnabled がオブジェクトではない（${JSON.stringify(enabled)}）。false だと master の本番デプロイまで止まる`,
  ...PREFIXES.map((prefix) =>
    enabled?.[`${prefix}/**`] === false
      ? null
      : `git.deploymentEnabled["${prefix}/**"] が false ではない（${JSON.stringify(enabled?.[`${prefix}/**`])}）`,
  ),
  ...Object.entries(enabled ?? {})
    .filter(([pattern, value]) => value === true && mayMatchAiBranch(pattern))
    .map(
      ([pattern]) =>
        `"${pattern}": true が ${PREFIXES.map((p) => `${p}/`).join("・")} のブランチにも当たりうる（true の規則が1つでも当たるとデプロイされる）`,
    ),
].filter(Boolean);

if (failures.length > 0) {
  console.error("verify-codex-no-preview: 失敗");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(
  "verify-codex-no-preview: OK（codex/**・claude/** の自動デプロイは無効、他のブランチと本番は既定のまま）",
);
