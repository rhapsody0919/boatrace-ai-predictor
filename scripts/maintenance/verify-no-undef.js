#!/usr/bin/env node
/**
 * verify-no-undef.js - ESLint の1回の実行で、指定した関門の規則の違反を数え、
 * 許可リストを超える違反があれば失敗する。
 *
 * 引数が無いときは no-undef だけを見る（最初の版と同じ。.github/workflows/post-merge-checks.yml は
 * 引数なしで呼ぶので、マージ後の検査・Slack 通知の範囲は no-undef のまま。ADR-0079 の
 * 「マージ後の通知は本番に出ると壊れるものに絞る」と合わせる）。verify:ci（PR の Quality Gates）は
 * verify-registry.json の args で --rules=... を渡し、規則を足す（開発効率の計画 段1a、2026-10-24）。
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
 *   規則を絞って足していく（段1a: no-empty・no-irregular-whitespace・src の rules-of-hooks）。
 *
 * やること:
 *   - src / api / middleware.js / scripts / e2e / ルートの *.config.js・*.mjs を ESLint で1回検査し、
 *     指定した規則だけを数える（他の規則の既存違反では落とさない）。範囲を明示するのは、
 *     eslint.config.js の globalIgnores が dist だけで、public・sns-video-studio・data まで読むと
 *     手元で400秒を超えるため
 *   - 規則の重さは eslint.config.js に頼らず、ここで error に固定する（設定の変更で黙って外れないため）。
 *     react-hooks/rules-of-hooks は src だけ（e2e/fixtures.js の Playwright の use(...) が誤検出になる）
 *   - Node 用のグローバル（process 等）は eslint.config.js の区分で付ける。ここでは上書きしない
 *   - ファイル内の設定コメント（eslint-disable・global 等）は、この検査では効かせない（noInlineConfig）。
 *     さらに、検査中の規則に触れる設定コメント（規則名を書かない eslint-disable、検査中の規則を名指す
 *     eslint-disable、global・globals・eslint・eslint-env）があれば失敗にする。
 *     触れない既存のもの（2026-10-24 時点で react-hooks/exhaustive-deps 28件・no-unused-vars 2件）は通す。
 *     「今の数を一覧に固定する」案は採らない。関門の外の規則の disable を足すたびに一覧の更新が要り、
 *     しかも一覧の数が合っていれば関門の規則の disable を紛れ込ませられるため
 *   - 構文エラーで検査できなかったファイル、どの設定にも当たらず検査されなかったファイルも失敗にする
 *     （検査されずに「0件」で通るのを防ぐ）
 *   - 理由があって残す違反は verify-no-undef-allowlist.json に載せる。no-undef は名前で
 *     （ファイル: names）、他の規則は件数で（ファイル: count）。許可を超えたら失敗（新しい違反）、
 *     許可に満たなくなっても失敗（解消済みの行が残っている）
 *   - 毎回、自己テストで次を確かめる
 *     - #1020 の直前の master（壊れていた版）の supabaseDataService.js を検出できる
 *     - 規則ごとの検出と、設定コメントで規則を消せないこと
 *     - 実在のファイルへ違反を1つ足した版が、実際の許可リストと突き合わせて失敗になる（変異の検証）
 *
 * 使い方:
 *   node scripts/maintenance/verify-no-undef.js                       # no-undef だけ
 *   node scripts/maintenance/verify-no-undef.js --rules=no-undef,no-empty,no-irregular-whitespace,react-hooks/rules-of-hooks
 *
 * master への push 後にも .github/workflows/post-merge-checks.yml が引数なしで実行する
 * （PR 単位の CI では、2つの PR の組み合わせで壊れる型を捕まえられないため）。
 */
import { ESLint } from "eslint";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareWithAllowlist,
  validateAllowlist,
} from "./verifyData/no-undef-allowlist.js";
import {
  compareCases,
  EMPTY_CATCH,
  IDEOGRAPHIC_SPACE,
  unitCases,
} from "./verifyData/no-undef-unit-cases.js";

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

// --rules= で選べる規則。足すときは、既存違反を直すか許可リストに載せ、下の自己テスト・変異にも足す
const KNOWN_RULES = [
  "no-undef",
  "no-empty",
  "no-irregular-whitespace",
  "react-hooks/rules-of-hooks",
];
const DEFAULT_RULES = ["no-undef"];

function parseRules(argv) {
  const arg = argv.find((a) => a.startsWith("--rules="));
  const unknownArgs = argv.filter((a) => !a.startsWith("--rules="));
  if (unknownArgs.length > 0) {
    throw new Error(
      `知らない引数です: ${unknownArgs.join(" ")}（使えるのは --rules=規則,規則）`,
    );
  }
  if (!arg) return DEFAULT_RULES;
  const rules = arg
    .slice("--rules=".length)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = rules.filter((r) => !KNOWN_RULES.includes(r));
  if (rules.length === 0 || unknown.length > 0) {
    throw new Error(
      `--rules の規則が不正です: ${JSON.stringify(unknown.length > 0 ? unknown : rules)}（使えるのは ${KNOWN_RULES.join(",")}）`,
    );
  }
  return [...new Set(rules)];
}

const RULES = parseRules(process.argv.slice(2));
const ACTIVE = new Set(RULES);
const JS_FILES = ["**/*.{js,jsx,mjs,cjs}"];

// #1020（今節Fの import 抜けの修正）の直前の master。この版の supabaseDataService.js は
// groupIntoCurrentMeet を import せずに呼んでいる
const BROKEN_REV = "3c0894ba9a09594270f2f99d47858c31668091f6";
const BROKEN_FILE = "src/services/supabaseDataService.js";
// 変異検査で違反を足す src の実在のファイル（殻 supabaseDataService.js は RA40 で消えた。rules-of-hooks が src だけなので src にする）
const MUTANT_FILE = "src/services/scheduleQueries.js";

const eslint = new ESLint({
  cwd: ROOT,
  overrideConfig: [
    { linterOptions: { noInlineConfig: true } },
    // 変異検査（他の verify-*.js の withMutant）が作っては消す一時ファイル。走査の後・読む前に消えて
    // ENOENT になる揺れ（BOA-1583）を、走査の対象から外して防ぐ。本物のファイルは外れない
    { ignores: ["**/*.__mutant-*.js"] },
    {
      files: JS_FILES,
      rules: Object.fromEntries(RULES.map((r) => [r, "error"])),
    },
    ...(ACTIVE.has("react-hooks/rules-of-hooks")
      ? [
          {
            files: JS_FILES,
            ignores: ["src/**"],
            rules: { "react-hooks/rules-of-hooks": "off" },
          },
        ]
      : []),
  ],
  ruleFilter: ({ ruleId }) => ACTIVE.has(ruleId),
});

// noInlineConfig のとき、設定コメントごとに ESLint が出す警告。文言が変わると自己テストが落ちる
const NO_EFFECT_RE =
  /^'(.+)' has no effect because you have 'noInlineConfig' setting in your config/s;

/**
 * 設定コメントの本文（例: "// eslint-disable-next-line no-empty -- 理由"）が、検査中の規則に触れるか。
 * 触れる: 規則名の無い disable/enable、検査中の規則を名指す disable/enable、global・globals・
 * eslint（規則の設定）・eslint-env。触れない: それ以外の規則だけを名指す disable、exported
 */
function directiveTouchesGate(text) {
  const body = text
    .replace(/^\s*(\/\/|\/\*)\s*/, "")
    .replace(/\*\/\s*$/, "")
    // ESLint の説明の区切りは「空白 + 2つ以上の - + 空白」
    .replace(/\s-{2,}\s[\s\S]*$/, "")
    .trim();
  const m = body.match(
    /^(eslint-disable-next-line|eslint-disable-line|eslint-disable|eslint-enable)(?:\s+([\s\S]*))?$/,
  );
  if (m) {
    const rules = (m[2] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return rules.length === 0 || rules.some((r) => ACTIVE.has(r));
  }
  // 規則の設定（/* eslint 規則: 重さ */）は、検査中の規則を名指すものだけ
  const config = body.match(/^eslint\s+([\s\S]*)$/);
  if (config) {
    const names = [...config[1].matchAll(/"?([@\w/-]+)"?\s*:/g)].map(
      (x) => x[1],
    );
    return names.length === 0 || names.some((r) => ACTIVE.has(r));
  }
  return /^(global|globals|eslint-env)(\s|$)/.test(body);
}

/**
 * ESLint の結果を、検査中の規則の違反・規則に触れる設定コメント・「検査できなかった」問題に分ける。
 * no-undef の違反は名前を持つ
 */
function classify(results) {
  const violations = [];
  const directives = [];
  const unchecked = [];
  for (const r of results) {
    const file = path.relative(ROOT, r.filePath);
    for (const m of r.messages) {
      if (ACTIVE.has(m.ruleId)) {
        let name = null;
        if (m.ruleId === "no-undef") {
          name = m.message.match(/^'(.+)' is not defined\.$/)?.[1];
          if (!name) {
            throw new Error(
              `no-undef のメッセージ形式が想定と違います: ${m.message}`,
            );
          }
        }
        violations.push({
          rule: m.ruleId,
          file,
          name,
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
      } else if (m.fatal || m.ruleId === null) {
        // 構文エラー、または「どの設定にも当たらない」等で検査されなかった
        unchecked.push(`${file}: ${m.message}`);
      }
    }
  }
  return { violations, directives, unchecked };
}

/** 判定の全体。ok=false なら失敗 */
function judge(results, allowRules) {
  const { violations, directives, unchecked } = classify(results);
  const { added, stale } = compareWithAllowlist(violations, allowRules, RULES);
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
  try {
    return validateAllowlist(
      JSON.parse(await fs.readFile(ALLOWLIST_PATH, "utf8")),
      KNOWN_RULES,
    );
  } catch (e) {
    throw new Error(
      `許可リストを読めません: ${ALLOWLIST_PATH}（${e.message}）`,
    );
  }
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

/** 1つのコードを検査し、見つかったもの（no-undef は「no-undef:名前」）と、規則に触れる設定コメントの数を返す */
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
    v.rule === "no-undef" ? `no-undef:${v.name}` : v.rule,
  );
  return { found: [...new Set(found)].sort(), directives: directives.length };
}

/**
 * 変異の検証: 実在のファイルに違反を1つ足した版で、実際の結果の当該ファイルを差し替え、
 * 実際の許可リストと突き合わせて失敗になることを確かめる。許可リストに載っているファイルにも
 * 1件足して（no-undef は新しい名前で）落ちること、1件消すと stale で落ちることを見る。
 * ディスクには書かない（verify:ci は並行で走り、一時ファイルを他の verify に拾われるため）
 */
function mutationCases(results, allowRules) {
  const replaceFile = async (file, add) => {
    const abs = path.join(ROOT, file);
    let code;
    try {
      code = await fs.readFile(abs, "utf8");
    } catch (e) {
      throw new Error(
        `変異の検証の入力 ${file} を読めません（改名・削除なら本スクリプトの対象を直す）: ${e.message}`,
      );
    }
    const [mutated] = await lintOne(code + add, file);
    return results.map((r) => (r.filePath === abs ? mutated : r));
  };
  const failsWith = (res, rule, file) => {
    const j = judge(res, allowRules);
    return !j.ok && j.added.some((a) => a.rule === rule && a.file === file);
  };
  const ADD = {
    "no-undef": "\nexport const lintGateMutant = lintGateMissingName;\n",
    "no-empty": `\n${EMPTY_CATCH.replace("function a(", "function lintGateMutant(")}`,
    "no-irregular-whitespace": `\n// lint-gate-mutant${IDEOGRAPHIC_SPACE}\n`,
    "react-hooks/rules-of-hooks":
      "\nexport function useLintGateMutant(a) {\n  if (a) {\n    useEffect(() => {});\n  }\n}\n",
  };
  const cases = [];
  for (const rule of RULES) {
    cases.push({
      name: `変異: ${MUTANT_FILE} に ${rule} の違反を1つ足すと失敗する`,
      run: async () =>
        failsWith(await replaceFile(MUTANT_FILE, ADD[rule]), rule, MUTANT_FILE),
      want: true,
    });
    const firstFile = Object.keys(allowRules[rule] ?? {})[0];
    if (!firstFile) continue;
    cases.push({
      name: `変異: 許可リストに載っている ${firstFile} に ${rule} の違反を1つ足すと失敗する`,
      run: async () =>
        failsWith(await replaceFile(firstFile, ADD[rule]), rule, firstFile),
      want: true,
    });
    cases.push({
      name: `変異: 許可リストの ${rule} ${firstFile} の違反が1件減ると（解消済みの行が残ると）失敗する`,
      run: async () => {
        const abs = path.join(ROOT, firstFile);
        let dropped = false;
        const res = results.map((r) =>
          r.filePath !== abs
            ? r
            : {
                ...r,
                messages: r.messages.filter((m) => {
                  if (!dropped && m.ruleId === rule) {
                    dropped = true;
                    return false;
                  }
                  return true;
                }),
              },
        );
        const j = judge(res, allowRules);
        return (
          !j.ok && j.stale.some((s) => s.rule === rule && s.file === firstFile)
        );
      },
      want: true,
    });
  }
  return cases;
}

async function runCases(cases) {
  const got = await Promise.all(cases.map((c) => c.run()));
  let ok = true;
  cases.forEach((c, i) => {
    if (JSON.stringify(got[i]) === JSON.stringify(c.want)) return;
    ok = false;
    console.error(
      `NG 自己テスト: ${c.name}\n   期待: ${JSON.stringify(c.want)}\n   実際: ${JSON.stringify(got[i])}`,
    );
  });
  return ok;
}

async function main() {
  const selfCases = [
    ...unitCases({
      eslint,
      ROOT,
      findingsIn,
      gitShow,
      BROKEN_REV,
      BROKEN_FILE,
    }),
    ...compareCases(RULES),
  ].filter((c) => c.rule === null || ACTIVE.has(c.rule));
  if (!(await runCases(selfCases))) {
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
      `NG: 検査中の規則（${RULES.join("・")}）に触れる設定コメントが ${directives.length} 件あります。この検査では効かないので、違反を直すか、許可リストに理由付きで載せる`,
    );
    for (const d of directives)
      console.error(`   ${d.file}:${d.line} ${d.text}`);
  }
  if (added.length > 0) {
    console.error("NG: 許可リストを超える違反があります");
    for (const a of added) {
      console.error(`   ${a.rule} ${a.file}: ${a.detail}`);
      for (const v of a.items)
        console.error(`      ${v.line}:${v.column} ${v.message}`);
    }
    console.error(
      "   直す。no-undef で Node で動くファイルの process 等なら eslint.config.js の Node 区分に入れる。",
    );
    console.error(
      "   どうしても残す場合だけ verify-no-undef-allowlist.json に理由付きで載せる（no-undef は names、他は count）",
    );
  }
  if (stale.length > 0) {
    console.error(
      `NG: 許可リストにあるのに出なくなった（解消済みの行が残っている）項目が ${stale.length} 件あります。許可リストを直す`,
    );
    for (const s of stale) console.error(`   ${s.rule} ${s.file}: ${s.detail}`);
  }
  if (!ok) process.exit(1);

  // 本検査が通ってから変異の検証をする（本検査が落ちていると変異の結果も崩れ、原因が読みにくいため）
  if (!(await runCases(mutationCases(results, allowRules)))) {
    console.error(
      "変異の検証が失敗したため検査結果を信用できません。本スクリプトと許可リストを確認してください",
    );
    process.exit(1);
  }

  console.log(
    `OK: ${results.length} ファイルを検査し、${RULES.join("・")} の許可リストを超える違反は 0 件（検出 ${violations.length} 件はすべて許可リストの内）`,
  );
}

main().catch((e) => {
  console.error(`NG: ${e.message}`);
  process.exit(1);
});
