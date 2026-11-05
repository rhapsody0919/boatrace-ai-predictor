/**
 * SNS の作り手の CI を走らせる差分の判定（sns-makers-scope.js、ADR-0105）を固定する。外部接続なし（tier=ci）。
 *
 * - #2236 の壊れの元 src/utils/raceSeriesText.js を変えた差分は run（作り手から届く経路つき）
 * - 全貌の文が new URL で読む src/locales/ja/common.json は run（JSON・new URL も葉として数える）
 * - remotion の下・root の lock・workflow・検査のスクリプトは run
 * - docs だけ・記事の JSON だけ・作り手から届かない画面のファイルだけは skip
 * - 空の差分・一覧が無いときは run（判定できないので走らせる）
 * - workflow と同じく、判定のスクリプトを別の場所に（scripts/maintenance と scripts/lib の配置のまま）取り出しても、--root で動く
 * - 辿り方が remotion の外（src/・scripts/）に届く（辿り方が壊れて何も拾わない状態を緑にしない）
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decide, entryFiles } from "./sns-makers-scope.js";
import { reach } from "../lib/relativeImportGraph.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const run = (files) => decide(files, ROOT).run;

assert.equal(
  run(["src/utils/raceSeriesText.js"]),
  true,
  "#2236 の元のファイル",
);
assert.match(
  decide(["src/utils/raceSeriesText.js"], ROOT).reason,
  /upsetWin\/model\.js → src\/utils\/raceSeriesText\.js/,
);
assert.equal(
  run(["src/locales/ja/common.json"]),
  true,
  "全貌の文が new URL で読む JSON",
);
assert.equal(run(["sns-video-studio/remotion/src/Root.jsx"]), true);
assert.equal(run(["sns-video-studio/remotion/remotion.config.js"]), true);
assert.equal(run(["sns-video-studio/remotion/package-lock.json"]), true);
assert.equal(run(["package-lock.json"]), true);
assert.equal(run([".github/workflows/sns-makers.yml"]), true);
assert.equal(run(["scripts/sns/push-upset-win-short.js"]), true);
assert.equal(run(["docs/adr/0105-sns-makers-ci.md"]), false, "docs だけ");
assert.equal(
  run(["docs/x.md", "src/pages/HomePage.jsx"]),
  false,
  "作り手から届かない画面",
);
assert.equal(
  run(["sns-video-studio/remotion/node_modules/x/index.js"]),
  false,
  "node_modules は数えない",
);
assert.equal(run([]), true, "空の差分は走らせる");
assert.equal(run(["", "  "]), true, "空行だけも走らせる");

// 見つからない参照の扱い（/code-review 2026-11-05）: コードの import は missing（安全側で run）、
// new URL の行き先（後で書く出力・ディレクトリ）とコードでない import（CSS・画像）は missing にしない
{
  const dir = mkdtempSync(join(tmpdir(), "sns-makers-graph-"));
  const entry = join(dir, "entry.mjs");
  writeFileSync(
    entry,
    [
      'import "./style.css";',
      'import logo from "./logo.png";',
      'const out = new URL("../out/", import.meta.url);',
      'const result = new URL("./result.json", import.meta.url);',
      'import data from "./data.json" with { type: "json" };',
    ].join("\n"),
  );
  writeFileSync(join(dir, "data.json"), "{}");
  const quiet = reach([entry]);
  assert.deepEqual(
    quiet.missing,
    [],
    "new URL の行き先・コードでない import の欠けは missing にしない",
  );
  assert.ok(
    quiet.via.has(join(dir, "data.json")),
    "あれば JSON は葉として届く",
  );
  writeFileSync(entry, 'import { x } from "./gone.js";\n');
  assert.deepEqual(
    reach([entry]).missing.map((m) => m.spec),
    ["./gone.js"],
    "コードの import の欠けは missing",
  );
}

// 辿り方の確かめ
const { via } = reach(entryFiles(ROOT));
const outside = [...via.keys()].filter(
  (f) =>
    !f.startsWith(join(ROOT, "sns-video-studio")) &&
    !f.startsWith(join(ROOT, "scripts/sns")),
);
assert.ok(
  outside.length >= 5,
  `作り手から remotion の外に届くファイルが少ない（${outside.length}）。辿り方が壊れていないか`,
);

// workflow の流儀: base の判定スクリプトを同じ配置で取り出し、--root に checkout を渡して動く
{
  const base = mkdtempSync(join(tmpdir(), "sns-makers-scope-"));
  mkdirSync(join(base, "scripts/maintenance"), { recursive: true });
  mkdirSync(join(base, "scripts/lib"), { recursive: true });
  copyFileSync(
    join(ROOT, "scripts/maintenance/sns-makers-scope.js"),
    join(base, "scripts/maintenance/sns-makers-scope.js"),
  );
  copyFileSync(
    join(ROOT, "scripts/lib/relativeImportGraph.js"),
    join(base, "scripts/lib/relativeImportGraph.js"),
  );
  const cli = (lines, extra = []) => {
    const list = join(base, "files.txt");
    writeFileSync(list, lines.join("\n"));
    const r = spawnSync(
      process.execPath,
      [
        join(base, "scripts/maintenance/sns-makers-scope.js"),
        "--files",
        list,
        "--root",
        ROOT,
        ...extra,
      ],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  assert.equal(cli(["src/utils/raceSeriesText.js"]), "run=true");
  assert.equal(cli(["docs/x.md"]), "run=false");
  // 一覧が読めないときは走らせる
  const r = spawnSync(
    process.execPath,
    [
      join(base, "scripts/maintenance/sns-makers-scope.js"),
      "--files",
      join(base, "missing.txt"),
      "--root",
      ROOT,
    ],
    { encoding: "utf8" },
  );
  assert.equal(r.stdout.trim(), "run=true");
}

console.log(
  `verify-sns-makers-scope: OK（作り手から ${via.size} ファイルに届く、うち remotion と送る口の外 ${outside.length}）`,
);
