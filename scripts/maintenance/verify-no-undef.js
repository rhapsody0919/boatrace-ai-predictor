#!/usr/bin/env node
/**
 * verify-no-undef.js - ESLint の1回の実行で、関門の規則（GATED_RULES）の違反を数え、
 * 許可リストを超える違反があれば失敗する。
 *
 * 名前は最初の no-undef だけの版のまま。.github/workflows/post-merge-checks.yml がこの名前で
 * 呼ぶため（.github は変えない方針）。中身は「lint の関門」（開発効率の計画 段1a、2026-10-24）。
 *
 * 背景（2026-10-01 本番障害、ADR-0079）:
 *   #1002 が import を groupIntoCurrentMeet → groupIntoMeetBeforeRace に置き換え、
 *   その後に入った #999 はまだ groupIntoCurrentMeet を呼んでいた。どちらの PR も単体では
 *   CI が緑で、テキストの衝突も無かった。しかし master では
 *   src/services/supabaseDataService.js が未定義の名前を呼ぶ形になり、本番で
 *   「groupIntoCurrentMeet is not defined」が出て今節 F の印が全レースで消えた（#1020 で修正）。
 *   vite build は「is not exported by」（名前付き import の不一致）は落とすが、
 *   import 自体が無い名前の参照は通してしまう。
 *   `npm run lint`（eslint .）は CI で走っていない。全規則を必須にすると既存違反で落ちるため、
 *   規則を絞って1つずつ足す（段1a: no-empty・no-irregular-whitespace・src の rules-of-hooks）。
 *
 * やること:
 *   - src / api / middleware.js / scripts / e2e / ルートの *.config.js・*.mjs を ESLint で1回検査し、
 *     GATED_RULES だけを数える（他の規則の既存違反では落とさない）。範囲を明示するのは、
 *     eslint.config.js の globalIgnores が dist だけで、public・sns-video-studio・data まで読むと
 *     手元で400秒を超えるため
 *   - 規則の重さは eslint.config.js に頼らず、ここで error に固定する（設定の変更で黙って外れないため）。
 *     react-hooks/rules-of-hooks は src だけ（e2e/fixtures.js の Playwright の use(...) が誤検出になる）
 *   - Node 用のグローバル（process 等）は eslint.config.js の区分で付ける。ここでは上書きしない
 *   - ファイル内の設定コメント（eslint-disable・global 等）は、この検査では効かせない（noInlineConfig）。
 *     さらに、関門の規則に触れる設定コメント（規則名を書かない eslint-disable、関門の規則を名指す
 *     eslint-disable、global・globals・eslint・eslint-env）があれば失敗にする。
 *     関門の規則に触れない既存のもの（react-hooks/exhaustive-deps 等、2026-10-24 時点で30件）は通す。
 *     「今の数を一覧に固定する」案は採らない。関門の外の規則の disable を足すたびに一覧の更新が要り、
 *     しかも一覧の数が合っていれば関門の規則の disable を紛れ込ませられるため
 *   - 構文エラーで検査できなかったファイル、どの設定にも当たらず検査されなかったファイルも失敗にする
 *     （検査されずに「0件」で通るのを防ぐ）
 *   - 理由があって残す違反は verify-no-undef-allowlist.json に、規則ごと・ファイルごとの件数で載せる。
 *     件数を超えたら失敗（新しい違反）、件数に満たなくなっても失敗（解消済みの行が残っている）
 *   - 毎回、自己テストで次を確かめる
 *     - #1020 の直前の master（壊れていた版）の supabaseDataService.js を検出できる
 *     - 規則ごとに、実在のファイルへ違反を1つ足した版で、許可リストと突き合わせて失敗になる（変異の検証）
 *     - 設定コメントで関門の規則を消せない
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
// ルートの *.mjs は、あるときだけ対象に入れる。無いのに渡すと ESLint が「対象なし」で失敗する。
// 他の対象は必ずあるので、消えたら（改名・ignore への追加）その失敗で気づけるよう既定のままにする
const ROOT_HAS_MJS = (await fs.readdir(ROOT)).some((f) => f.endsWith(".mjs"));
const TARGETS = [
  "src",
  "api",
  "middleware.js",
  "scripts",
  "e2e",
  "*.config.js",
  ...(ROOT_HAS_MJS ? ["*.mjs"] : []),
];

// 関門の規則。足すときは、既存違反を直すか許可リストに載せ、下の変異の検証にも1件足す
export const GATED_RULES = [
  "no-undef",
  "no-empty",
  "no-irregular-whitespace",
  "react-hooks/rules-of-hooks",
];
const GATED = new Set(GATED_RULES);
const JS_FILES = ["**/*.{js,jsx,mjs,cjs}"];

// #1020（今節Fの import 抜けの修正）の直前の master。この版の supabaseDataService.js は
// groupIntoCurrentMeet を import せずに呼んでいる
const BROKEN_REV = "3c0894ba9a09594270f2f99d47858c31668091f6";
const BROKEN_FILE = "src/services/supabaseDataService.js";

const eslint = new ESLint({
  cwd: ROOT,
  overrideConfig: [
    { linterOptions: { noInlineConfig: true } },
    {
      files: JS_FILES,
      rules: Object.fromEntries(GATED_RULES.map((r) => [r, "error"])),
    },
    {
      files: JS_FILES,
      ignores: ["src/**"],
      rules: { "react-hooks/rules-of-hooks": "off" },
    },
  ],
  ruleFilter: ({ ruleId }) => GATED.has(ruleId),
});

const NO_EFFECT_RE =
  /^'(.+)' has no effect because you have 'noInlineConfig' setting in your config\.$/s;

/**
 * 設定コメントの本文（例: "// eslint-disable-next-line no-empty -- 理由"）が、関門の規則に触れるか。
 * 触れる: 規則名の無い disable/enable、関門の規則を名指す disable/enable、global・globals・
 * eslint（規則の設定）・eslint-env。触れない: 関門の外の規則だけを名指す disable、exported
 */
export function directiveTouchesGate(text) {
  const body = text
    .replace(/^\s*(\/\/|\/\*)\s*/, "")
    .replace(/\*\/\s*$/, "")
    .replace(/\s--\s[\s\S]*$/, "")
    .trim();
  const m = body.match(
    /^(eslint-disable-next-line|eslint-disable-line|eslint-disable|eslint-enable)(?:\s+([\s\S]*))?$/,
  );
  if (m) {
    const rules = (m[2] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return rules.length === 0 || rules.some((r) => GATED.has(r));
  }
  return /^(global|globals|eslint|eslint-env)(\s|$)/.test(body);
}

/**
 * ESLint の結果を、関門の規則の違反・関門に触れる設定コメント・「検査できなかった」問題に分ける。
 * 戻り値: { violations: [{rule, file, line, column, message}], directives: [{file, line, text}], unchecked: [string] }
 */
export function classify(results) {
  const violations = [];
  const directives = [];
  const unchecked = [];
  for (const r of results) {
    const file = path.relative(ROOT, r.filePath);
    for (const m of r.messages) {
      if (GATED.has(m.ruleId)) {
        violations.push({
          rule: m.ruleId,
          file,
          line: m.line,
          column: m.column,
          message: m.message,
        });
        continue;
      }
      const noEffect =
        m.ruleId === null && !m.fatal && m.message.match(NO_EFFECT_RE);
      if (noEffect) {
        if (directiveTouchesGate(noEffect[1]))
          directives.push({ file, line: m.line, text: noEffect[1] });
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
  return { violations, directives, unchecked };
}

/**
 * 違反と許可リスト（{ 規則: { ファイル: { count, reason } } }）を件数で突き合わせる。
 * added: 許可の件数を超えた (規則, ファイル)。stale: 許可の件数に満たない (規則, ファイル)
 */
export function compareWithAllowlist(violations, allowRules) {
  const actual = new Map();
  for (const v of violations) {
    const k = `${v.rule}\t${v.file}`;
    actual.set(k, (actual.get(k) ?? 0) + 1);
  }
  const added = [];
  for (const [k, n] of actual) {
    const [rule, file] = k.split("\t");
    const allowed = allowRules[rule]?.[file]?.count ?? 0;
    if (n > allowed)
      added.push({
        rule,
        file,
        actual: n,
        allowed,
        items: violations.filter((v) => v.rule === rule && v.file === file),
      });
  }
  const stale = [];
  for (const [rule, files] of Object.entries(allowRules)) {
    for (const [file, { count }] of Object.entries(files)) {
      const n = actual.get(`${rule}\t${file}`) ?? 0;
      if (n < count) stale.push({ rule, file, actual: n, allowed: count });
    }
  }
  return { added, stale };
}

/** 判定の全体。ok=false なら失敗 */
export function judge(results, allowRules) {
  const { violations, directives, unchecked } = classify(results);
  const { added, stale } = compareWithAllowlist(violations, allowRules);
  return {
    ok:
      unchecked.length === 0 &&
      directives.length === 0 &&
      added.length === 0 &&
      stale.length === 0,
    violations,
    directives,
    unchecked,
    added,
    stale,
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
  const rules = json.rules;
  if (rules === null || typeof rules !== "object" || Array.isArray(rules)) {
    throw new Error(
      `許可リストに rules オブジェクトがありません: ${ALLOWLIST_PATH}`,
    );
  }
  const keys = Object.keys(rules).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...GATED_RULES].sort())) {
    throw new Error(
      `許可リストの rules の規則が GATED_RULES と一致しません: ${JSON.stringify(keys)}（期待 ${JSON.stringify(GATED_RULES)}）`,
    );
  }
  for (const [rule, files] of Object.entries(rules)) {
    for (const [file, e] of Object.entries(files)) {
      if (
        !Number.isInteger(e?.count) ||
        e.count < 1 ||
        typeof e.reason !== "string" ||
        e.reason.trim() === ""
      ) {
        throw new Error(
          `許可リストの形式が不正です（count は1以上の整数、reason が必要）: ${rule} ${file} ${JSON.stringify(e)}`,
        );
      }
    }
  }
  return rules;
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

async function lintOne(code, filePath) {
  return eslint.lintText(code, { filePath: path.join(ROOT, filePath) });
}

/** 1つのコードを検査し、「規則:名前」（no-undef）か「規則」の一覧と、関門に触れる設定コメントの数を返す */
async function findingsIn(code, filePath) {
  const { violations, directives, unchecked } = classify(
    await lintOne(code, filePath),
  );
  if (unchecked.length > 0) {
    throw new Error(
      `自己テストの入力が検査されませんでした: ${unchecked.join(" / ")}`,
    );
  }
  const found = violations.map((v) =>
    v.rule === "no-undef"
      ? `no-undef:${v.message.match(/^'(.+)' is not defined\.$/)?.[1] ?? v.message}`
      : v.rule,
  );
  return { found: [...new Set(found)].sort(), directives: directives.length };
}

// 全角空白（U+3000）。このファイル自体が no-irregular-whitespace に当たらないよう、文字で書かない
const IDEOGRAPHIC_SPACE = String.fromCodePoint(0x3000);
const HOOK_IN_CONDITION =
  'import { useState } from "react";\nexport function Selftest({ a }) {\n  if (a) {\n    useState(0);\n  }\n  return null;\n}\n';

async function unitSelfTests() {
  const f = (code, file) => findingsIn(code, file);
  return [
    {
      name: "#1020 直前の master の supabaseDataService.js → groupIntoCurrentMeet を検出する",
      got: (
        await f(gitShow(`${BROKEN_REV}:${BROKEN_FILE}`), BROKEN_FILE)
      ).found.filter((x) => x.startsWith("no-undef:")),
      want: ["no-undef:groupIntoCurrentMeet"],
    },
    {
      name: "src/ はブラウザ用 → process を検出する（Node のグローバルを付けていない）",
      got: (
        await f("export const a = process.env.X;\n", "src/undef-selftest.js")
      ).found,
      want: ["no-undef:process"],
    },
    {
      name: "src/ の window・document は通す",
      got: (
        await f(
          "export const a = window.innerWidth + document.title;\n",
          "src/undef-selftest.js",
        )
      ).found,
      want: [],
    },
    {
      name: "e2e/ は Node と page.evaluate 内のブラウザの両方 → process・Buffer・document を通す",
      got: (
        await f(
          "export const a = [process.env.X, Buffer.from('x'), () => document.title];\n",
          "e2e/undef-selftest.spec.js",
        )
      ).found,
      want: [],
    },
    {
      name: "scripts/ の .mjs も検査対象 → 未定義を検出し、process は通す",
      got: (
        await f(
          "console.log(process.argv, notDefinedAnywhere);\n",
          "scripts/undef-selftest.mjs",
        )
      ).found,
      want: ["no-undef:notDefinedAnywhere"],
    },
    {
      name: "api/ は Node → process を通し、未定義は検出する",
      got: (
        await f(
          "export default () => [process.env.X, missingHelper()];\n",
          "api/undef-selftest.js",
        )
      ).found,
      want: ["no-undef:missingHelper"],
    },
    {
      name: "no-empty: 空の catch を検出する",
      got: (
        await f(
          "export function a() {\n  try {\n    JSON.parse('1');\n  } catch (e) {}\n}\n",
          "src/lint-gate-selftest.js",
        )
      ).found,
      want: ["no-empty"],
    },
    {
      name: "no-irregular-whitespace: コメント中の全角空白を検出する",
      got: (
        await f(
          `// a${IDEOGRAPHIC_SPACE}b\nexport const a = 1;\n`,
          "scripts/lint-gate-selftest.js",
        )
      ).found,
      want: ["no-irregular-whitespace"],
    },
    {
      name: "rules-of-hooks: src/ の条件の中の useState を検出する",
      got: (await f(HOOK_IN_CONDITION, "src/lint-gate-selftest.jsx")).found,
      want: ["react-hooks/rules-of-hooks"],
    },
    {
      name: "rules-of-hooks: e2e/ は対象外（Playwright の use(...) の誤検出を避ける）",
      got: (await f(HOOK_IN_CONDITION, "e2e/lint-gate-selftest.spec.js")).found,
      want: [],
    },
    {
      name: "eslint-disable-next-line no-empty は効かず、違反と設定コメントの両方を検出する",
      got: await f(
        "export function a() {\n  try {\n    JSON.parse('1');\n    // eslint-disable-next-line no-empty\n  } catch (e) {}\n}\n",
        "src/lint-gate-selftest.js",
      ),
      want: { found: ["no-empty"], directives: 1 },
    },
    {
      name: "ファイル全体の /* eslint-disable */ と /* global */ は効かず、設定コメントとして検出する",
      got: await f(
        "/* eslint-disable */\n/* global someGlobal */\nexport const a = someGlobal;\n",
        "src/lint-gate-selftest.js",
      ),
      want: { found: ["no-undef:someGlobal"], directives: 2 },
    },
    {
      name: "関門の外の規則（exhaustive-deps）の disable は通す",
      got: await f(
        "// eslint-disable-next-line react-hooks/exhaustive-deps -- 理由\nexport const a = 1;\n",
        "src/lint-gate-selftest.js",
      ),
      want: { found: [], directives: 0 },
    },
  ];
}

/**
 * 変異の検証: 実在のファイルに違反を1つ足した版で、実際の結果の当該ファイルを差し替え、
 * 実際の許可リストと突き合わせて失敗になることを確かめる。許可リストに載っているファイル
 * （件数で固定）にも1件足して、件数の超過で落ちることを見る。
 */
async function mutationSelfTests(results, allowRules) {
  const replaceFile = async (file, mutate) => {
    const abs = path.join(ROOT, file);
    const code = mutate(await fs.readFile(abs, "utf8"));
    const [mutated] = await lintOne(code, file);
    return results.map((r) => (r.filePath === abs ? mutated : r));
  };
  const failsWith = (res, rule, file) => {
    const j = judge(res, allowRules);
    return !j.ok && j.added.some((a) => a.rule === rule && a.file === file);
  };
  const cases = [
    {
      rule: "no-undef",
      file: "src/services/supabaseDataService.js",
      add: "\nexport const lintGateMutant = lintGateMissingName;\n",
    },
    {
      rule: "no-empty",
      file: "src/services/supabaseDataService.js",
      add: "\nexport function lintGateMutant() {\n  try {\n    JSON.parse('1');\n  } catch (e) {}\n}\n",
    },
    {
      rule: "no-irregular-whitespace",
      file: "scripts/maintenance/run-verify-registry.js",
      add: `\n// lint-gate-mutant${IDEOGRAPHIC_SPACE}\n`,
    },
    {
      // 許可リストで件数を固定しているファイル。1件増えたら落ちる
      rule: "no-irregular-whitespace",
      file: "e2e/acceptance/meet-page.spec.js",
      add: `\n// lint-gate-mutant${IDEOGRAPHIC_SPACE}\n`,
    },
    {
      rule: "react-hooks/rules-of-hooks",
      file: "src/hooks/useAnalogyV16.js",
      add: "\nexport function useLintGateMutant(a) {\n  if (a) {\n    useEffect(() => {});\n  }\n}\n",
    },
  ];
  const out = [];
  for (const c of cases) {
    out.push({
      name: `変異: ${c.file} に ${c.rule} の違反を1つ足すと失敗する`,
      got: failsWith(
        await replaceFile(c.file, (s) => s + c.add),
        c.rule,
        c.file,
      ),
      want: true,
    });
  }
  // 解消済みの行が残っているときも落ちる: 許可リストの最初の行のファイルから違反を1件消した版
  const firstAllowed = Object.entries(allowRules).flatMap(([rule, files]) =>
    Object.keys(files).map((file) => ({ rule, file })),
  )[0];
  if (firstAllowed) {
    const abs = path.join(ROOT, firstAllowed.file);
    let dropped = false;
    const res = results.map((r) => {
      if (r.filePath !== abs) return r;
      return {
        ...r,
        messages: r.messages.filter((m) => {
          if (!dropped && m.ruleId === firstAllowed.rule) {
            dropped = true;
            return false;
          }
          return true;
        }),
      };
    });
    const j = judge(res, allowRules);
    out.push({
      name: `変異: 許可リストの ${firstAllowed.rule} ${firstAllowed.file} の違反が1件減ると（解消済みの行が残ると）失敗する`,
      got:
        !j.ok &&
        j.stale.some(
          (s) => s.rule === firstAllowed.rule && s.file === firstAllowed.file,
        ),
      want: true,
    });
  }
  return out;
}

function reportFailedCases(cases) {
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
  if (!reportFailedCases(await unitSelfTests())) {
    console.error(
      "自己テストが失敗したため検査結果を信用できません。eslint.config.js と本スクリプトを確認してください",
    );
    process.exit(1);
  }

  const allowRules = await loadAllowlist();
  const results = await eslint.lintFiles(TARGETS);

  const { ok, violations, directives, unchecked, added, stale } = judge(
    results,
    allowRules,
  );

  if (unchecked.length > 0) {
    console.error(
      `NG: 検査できなかったファイルが ${unchecked.length} 件あります（構文エラー、または eslint.config.js のどの区分にも当たらない）`,
    );
    for (const u of unchecked) console.error(`   ${u}`);
  }
  if (directives.length > 0) {
    console.error(
      `NG: 関門の規則（${GATED_RULES.join("・")}）に触れる設定コメントが ${directives.length} 件あります。この検査では効かないので、違反を直すか、許可リストに理由付きで載せる`,
    );
    for (const d of directives)
      console.error(`   ${d.file}:${d.line} ${d.text}`);
  }
  if (added.length > 0) {
    console.error(`NG: 許可リストを超える違反があります`);
    for (const a of added) {
      console.error(
        `   ${a.rule} ${a.file}: ${a.actual} 件（許可 ${a.allowed} 件）`,
      );
      for (const v of a.items)
        console.error(`      ${v.line}:${v.column} ${v.message}`);
    }
    console.error(
      "   直す。no-undef で Node で動くファイルの process 等なら eslint.config.js の Node 区分に入れる。",
    );
    console.error(
      "   どうしても残す場合だけ verify-no-undef-allowlist.json に規則・ファイル・件数・理由を載せる",
    );
  }
  if (stale.length > 0) {
    console.error(
      `NG: 許可リストの件数に満たない（解消済みの行が残っている）項目が ${stale.length} 件あります。許可リストの件数を減らすか行を消す`,
    );
    for (const s of stale)
      console.error(
        `   ${s.rule} ${s.file}: 実際 ${s.actual} 件（許可 ${s.allowed} 件）`,
      );
  }
  if (!ok) process.exit(1);

  // 本検査が通ってから変異の検証をする（本検査が落ちていると変異の結果も崩れ、原因が読みにくいため）
  if (!reportFailedCases(await mutationSelfTests(results, allowRules))) {
    console.error(
      "変異の検証が失敗したため検査結果を信用できません。本スクリプトと許可リストを確認してください",
    );
    process.exit(1);
  }

  const allowedTotal = Object.values(allowRules)
    .flatMap((files) => Object.values(files))
    .reduce((sum, e) => sum + e.count, 0);
  console.log(
    `OK: ${results.length} ファイルを検査し、${GATED_RULES.join("・")} の許可リストを超える違反は 0 件（許可リストの違反 ${allowedTotal} 件、検出 ${violations.length} 件）`,
  );
}

main().catch((e) => {
  console.error(`NG: ${e.message}`);
  process.exit(1);
});
