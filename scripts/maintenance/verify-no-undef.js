#!/usr/bin/env node
/**
 * verify-no-undef.js - 未定義の名前の参照（ESLint の no-undef）だけを数え、1件でもあれば失敗する。
 *
 * 背景（2026-10-01 本番障害、ADR-0079）:
 *   #1002 が import を groupIntoCurrentMeet → groupIntoMeetBeforeRace に置き換え、
 *   その後に入った #999 はまだ groupIntoCurrentMeet を呼んでいた。どちらの PR も単体では
 *   CI が緑で、テキストの衝突も無かった。しかし master では
 *   src/services/supabaseDataService.js が未定義の名前を呼ぶ形になり、本番で
 *   「groupIntoCurrentMeet is not defined」が出て今節 F の印が全レースで消えた（#1020 で修正）。
 *   vite build は「is not exported by」（名前付き import の不一致）は落とすが、
 *   import 自体が無い名前の参照は通してしまう。
 *
 * やること:
 *   - src / api / middleware.js / scripts / e2e / ルートの *.config.js・*.mjs を ESLint で検査し、
 *     no-undef だけを数える（他のルールの既存違反では落とさない）
 *   - Node 用のグローバル（process 等）は eslint.config.js の区分で付ける。ここでは上書きしない
 *   - 構文エラーで検査できなかったファイル、どの設定にも当たらず検査されなかったファイルも失敗にする
 *     （検査されずに「0件」で通るのを防ぐ）
 *   - 理由があって残す違反は verify-no-undef-allowlist.json に（file, name, reason）で載せる。
 *     許可リストにあるのに出なくなった項目（解消済み）も失敗にする（許可リストを腐らせないため）
 *   - 毎回、自己テストで「#1020 の直前の master（壊れていた版）の supabaseDataService.js を
 *     検出できること」等を確かめる
 *
 * 使い方:
 *   node scripts/maintenance/verify-no-undef.js
 *
 * master への push 後にも .github/workflows/post-merge-checks.yml が実行する
 * （PR 単位の CI では、2つの PR の組み合わせで壊れる型を捕まえられないため）。
 */
import { ESLint } from "eslint";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const ALLOWLIST_PATH = path.join(HERE, "verify-no-undef-allowlist.json");
const TARGETS = [
  "src",
  "api",
  "middleware.js",
  "scripts",
  "e2e",
  "*.config.js",
  "*.mjs",
];

// #1020（今節Fの import 抜けの修正）の直前の master。この版の supabaseDataService.js は
// groupIntoCurrentMeet を import せずに呼んでいる
const BROKEN_REV = "3c0894ba9a09594270f2f99d47858c31668091f6";
const BROKEN_FILE = "src/services/supabaseDataService.js";

const eslint = new ESLint({
  cwd: ROOT,
  ruleFilter: ({ ruleId }) => ruleId === "no-undef",
});

/**
 * ESLint の結果を、no-undef の違反と「検査できなかった」問題に分ける。
 * 戻り値: { violations: [{file, line, column, name}], unchecked: [string] }
 */
export function classify(results) {
  const violations = [];
  const unchecked = [];
  for (const r of results) {
    const file = path.relative(ROOT, r.filePath);
    for (const m of r.messages) {
      if (m.ruleId === "no-undef") {
        const name = m.message.match(/^'(.+)' is not defined\.$/)?.[1];
        if (!name) {
          throw new Error(
            `no-undef のメッセージ形式が想定と違います: ${m.message}`,
          );
        }
        violations.push({ file, line: m.line, column: m.column, name });
      } else if (
        m.ruleId === null &&
        !m.fatal &&
        m.message.startsWith("Unused eslint-disable directive")
      ) {
        // 不要になった eslint-disable コメント。検査はできているので、本検査の対象外
        continue;
      } else if (m.fatal || m.ruleId === null) {
        // 構文エラー、または「どの設定にも当たらない」等で検査されなかった
        unchecked.push(`${file}: ${m.message}`);
      }
    }
  }
  return { violations, unchecked };
}

/** 違反と許可リストを突き合わせる。キーは (file, name) */
export function compareWithAllowlist(violations, allowEntries) {
  const key = (file, name) => `${file}\t${name}`;
  const allowed = new Set(allowEntries.map((e) => key(e.file, e.name)));
  const present = new Set(violations.map((v) => key(v.file, v.name)));
  return {
    added: violations.filter((v) => !allowed.has(key(v.file, v.name))),
    stale: allowEntries.filter((e) => !present.has(key(e.file, e.name))),
  };
}

async function loadAllowlist() {
  let raw;
  try {
    raw = await fs.readFile(ALLOWLIST_PATH, "utf8");
  } catch (e) {
    throw new Error(
      `許可リストを読めません: ${ALLOWLIST_PATH}（${e.message}）`,
    );
  }
  const json = JSON.parse(raw);
  if (!Array.isArray(json.entries)) {
    throw new Error(`許可リストに entries 配列がありません: ${ALLOWLIST_PATH}`);
  }
  for (const e of json.entries) {
    if (
      typeof e.file !== "string" ||
      typeof e.name !== "string" ||
      typeof e.reason !== "string" ||
      e.reason.trim() === ""
    ) {
      throw new Error(
        `許可リストの形式が不正です（file・name・reason が必要）: ${JSON.stringify(e)}`,
      );
    }
  }
  return json.entries;
}

// ---------------------------------------------------------------------------
// 自己テスト（毎回実行する。設定や検出が壊れたまま「0件」で通るのを防ぐ）
// ---------------------------------------------------------------------------

function gitShow(spec) {
  try {
    return execFileSync("git", ["show", spec], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    throw new Error(
      `自己テストの入力 ${spec} を git から読めません（CI は fetch-depth: 0 が前提）: ${e.message}`,
    );
  }
}

async function namesIn(code, filePath) {
  const results = await eslint.lintText(code, {
    filePath: path.join(ROOT, filePath),
  });
  const { violations, unchecked } = classify(results);
  if (unchecked.length > 0) {
    throw new Error(
      `自己テストの入力が検査されませんでした: ${unchecked.join(" / ")}`,
    );
  }
  return [...new Set(violations.map((v) => v.name))].sort();
}

async function selfTests() {
  const cases = [
    {
      name: "#1020 直前の master の supabaseDataService.js → groupIntoCurrentMeet を検出する",
      got: await namesIn(gitShow(`${BROKEN_REV}:${BROKEN_FILE}`), BROKEN_FILE),
      want: ["groupIntoCurrentMeet"],
    },
    {
      name: "src/ はブラウザ用 → process を検出する（Node のグローバルを付けていない）",
      got: await namesIn(
        "export const a = process.env.X;\n",
        "src/undef-selftest.js",
      ),
      want: ["process"],
    },
    {
      name: "src/ の window・document は通す",
      got: await namesIn(
        "export const a = window.innerWidth + document.title;\n",
        "src/undef-selftest.js",
      ),
      want: [],
    },
    {
      name: "e2e/ は Node と page.evaluate 内のブラウザの両方 → process・Buffer・document を通す",
      got: await namesIn(
        "export const a = [process.env.X, Buffer.from('x'), () => document.title];\n",
        "e2e/undef-selftest.spec.js",
      ),
      want: [],
    },
    {
      name: "scripts/ の .mjs も検査対象 → 未定義を検出し、process は通す",
      got: await namesIn(
        "console.log(process.argv, notDefinedAnywhere);\n",
        "scripts/undef-selftest.mjs",
      ),
      want: ["notDefinedAnywhere"],
    },
    {
      name: "api/ は Node → process を通し、未定義は検出する",
      got: await namesIn(
        "export default () => [process.env.X, missingHelper()];\n",
        "api/undef-selftest.js",
      ),
      want: ["missingHelper"],
    },
    {
      name: "不要になった eslint-disable no-undef は「検査できなかった」扱いにしない",
      got: await namesIn(
        "// eslint-disable-next-line no-undef\nexport const a = 1;\n",
        "src/undef-selftest.js",
      ),
      want: [],
    },
  ];

  const allowCases = compareWithAllowlist(
    [{ file: "a.js", line: 1, column: 1, name: "x" }],
    [
      { file: "a.js", name: "x", reason: "r" },
      { file: "b.js", name: "y", reason: "r" },
    ],
  );
  cases.push({
    name: "許可リスト: 載っている違反は通し、出なくなった項目は stale にする",
    got: [allowCases.added.length, allowCases.stale.map((e) => e.file)],
    want: [0, ["b.js"]],
  });

  const failed = cases.filter(
    (c) => JSON.stringify(c.got) !== JSON.stringify(c.want),
  );
  for (const c of failed) {
    console.error(
      `NG 自己テスト: ${c.name}\n   期待: ${JSON.stringify(c.want)}\n   実際: ${JSON.stringify(c.got)}`,
    );
  }
  return failed.length === 0;
}

async function main() {
  if (!(await selfTests())) {
    console.error(
      "自己テストが失敗したため検査結果を信用できません。eslint.config.js と本スクリプトを確認してください",
    );
    process.exit(1);
  }

  const allowEntries = await loadAllowlist();
  const results = await eslint.lintFiles(TARGETS);
  const { violations, unchecked } = classify(results);
  const { added, stale } = compareWithAllowlist(violations, allowEntries);

  let ok = true;
  if (unchecked.length > 0) {
    ok = false;
    console.error(
      `NG: 検査できなかったファイルが ${unchecked.length} 件あります（構文エラー、または eslint.config.js のどの区分にも当たらない）`,
    );
    for (const u of unchecked) console.error(`   ${u}`);
  }
  if (added.length > 0) {
    ok = false;
    console.error(`NG: 未定義の名前の参照が ${added.length} 件あります`);
    for (const v of added)
      console.error(
        `   ${v.file}:${v.line}:${v.column} '${v.name}' is not defined`,
      );
    console.error(
      "   import の抜け・名前の打ち間違いなら直す。Node で動くファイルで process 等が出る場合は eslint.config.js の Node 区分に入れる。",
    );
    console.error(
      "   どうしても残す場合だけ verify-no-undef-allowlist.json に理由付きで載せる",
    );
  }
  if (stale.length > 0) {
    ok = false;
    console.error(
      `NG: 許可リストにあるのに出なくなった項目が ${stale.length} 件あります（解消済みなら許可リストから消す）`,
    );
    for (const e of stale) console.error(`   ${e.file} '${e.name}'`);
  }
  if (!ok) process.exit(1);

  console.log(
    `OK: ${results.length} ファイルを検査し、未定義の名前の参照は 0 件（許可リスト ${allowEntries.length} 件）`,
  );
}

main().catch((e) => {
  console.error(`NG: ${e.message}`);
  process.exit(1);
});
