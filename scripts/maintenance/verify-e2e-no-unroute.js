#!/usr/bin/env node
/**
 * verify-e2e-no-unroute.js - E2E で page のルートを途中で0件にする書き方を検出する（BOA-662、ADR-0077）。
 *
 * 背景: Playwright 1.59 は、page のルートが0件になった瞬間に処理中の要求があると、
 * それを context 側のルート（e2e/fixtures.js の録画の再生 routeFromHAR）へ送り直す。
 * 同じ要求がクライアント側の page→context の経路でも処理され、
 * 「Route is already handled!」で落ちる。同じ仕組みで2回落ちた。
 *   - BOA-466（#913）: smoke.spec.js の afterEach の page.unrouteAll（展示前の体重テスト5件）
 *   - BOA-661（#1084）: smoke.spec.js のオリジナル展示の再訪テストと ga-pageview.spec.js の
 *     /admin のスタブが、テストの途中で page.unroute していた
 *
 * 検出するもの（コメント・文字列・正規表現リテラルの中は除く）:
 *   - `.unroute(` / `.unrouteAll(`
 *   - `.route(` の第3引数に `times` がある呼び出し（指定回数で自動的に外れ、0件になりうる）
 *     第3引数がオブジェクトリテラルでない（変数等で times の有無を読めない）呼び出しも検出する
 * 代わりの書き方: 上に page.route を重ねる（後から登録したものが先に評価される）か、
 * フラグを倒して route.fallback() に回す。
 *
 * 正当な例外は e2e-no-unroute-allowlist.json に { file, code（行の内容）, reason } で載せる。
 * reason が無い・短いエントリ、どの違反にも当たらない（解消済みの）エントリは失敗にする
 * （verify-css-class-collisions.js と同じく、許可リストを腐らせないため）。
 * 1エントリは1箇所に対応する（同じ内容の行が2箇所あれば2エントリ要る）。
 *
 * 使い方:
 *   node scripts/maintenance/verify-e2e-no-unroute.js             # 自己テスト + e2e/ の検査
 *   node scripts/maintenance/verify-e2e-no-unroute.js a.js b.js   # 指定ファイルだけ検査（解消済みの判定はしない）
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const E2E_DIR = path.join(ROOT, "e2e");
const ALLOWLIST_PATH = path.join(HERE, "e2e-no-unroute-allowlist.json");
const MIN_REASON_LENGTH = 10;

// この文字の直後の `/` は割り算ではなく正規表現リテラルの始まり
const REGEX_PRECEDERS = new Set("(,=:[!&|?{};+-*%<>~^".split(""));

/**
 * コメント・文字列・テンプレート・正規表現リテラルの中身を空白に置き換える（純関数）。
 * 改行は残すので、行番号と位置は元のソースと一致する
 */
export function stripNonCode(source) {
  const out = source.split("");
  const blank = (from, to) => {
    for (let k = from; k < to; k += 1) {
      if (out[k] !== "\n") out[k] = " ";
    }
  };
  // i の位置の `/` が正規表現リテラルの始まりか（割り算ではないか）
  const startsRegex = (i) => {
    let k = i - 1;
    while (k >= 0 && /\s/.test(out[k])) k -= 1;
    if (k < 0) return true;
    // return / typeof 等のキーワードの後も正規表現
    const word = source.slice(0, k + 1).match(/[A-Za-z_$]+$/);
    if (word) {
      return ["return", "typeof", "case", "in", "of"].includes(word[0]);
    }
    // a++ / 2・a-- / 2 は割り算
    if ((out[k] === "+" || out[k] === "-") && out[k - 1] === out[k]) {
      return false;
    }
    return REGEX_PRECEDERS.has(out[k]);
  };
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      let k = i + 1;
      while (k < source.length && source[k] !== c) {
        if (source[k] === "\\") k += 1;
        // 通常の文字列は行をまたがない（閉じ忘れで以降を全部消さないため）
        else if (source[k] === "\n" && c !== "`") break;
        k += 1;
      }
      blank(i + 1, k);
      i = k + 1;
    } else if (c === "/" && startsRegex(i)) {
      let k = i + 1;
      let inClass = false;
      while (k < source.length && source[k] !== "\n") {
        if (source[k] === "\\") k += 1;
        else if (source[k] === "[") inClass = true;
        else if (source[k] === "]") inClass = false;
        else if (source[k] === "/" && !inClass) break;
        k += 1;
      }
      blank(i + 1, k);
      i = k + 1;
    } else {
      i += 1;
    }
  }
  return out.join("");
}

/** code[open] が "(" のとき、対応する ")" までの引数を最上位のカンマで分ける */
function splitArgs(code, open) {
  const args = [];
  let depth = 0;
  let start = open + 1;
  for (let k = open; k < code.length; k += 1) {
    const ch = code[k];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) {
        args.push(code.slice(start, k));
        return args.filter(
          (a, idx) => idx < args.length - 1 || a.trim() !== "",
        );
      }
    } else if (ch === "," && depth === 1) {
      args.push(code.slice(start, k));
      start = k + 1;
    }
  }
  return args;
}

const lineOf = (code, index) => code.slice(0, index).split("\n").length;

/** 違反を { line, kind } で返す（純関数） */
export function findViolations(source) {
  const code = stripNonCode(source);
  const violations = [];
  for (const m of code.matchAll(/\.(unrouteAll|unroute)\s*\(/g)) {
    violations.push({ line: lineOf(code, m.index), kind: m[1] });
  }
  for (const m of code.matchAll(/\.route\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const third = splitArgs(code, open)[2];
    if (third === undefined) continue;
    if (/\btimes\b/.test(third)) {
      violations.push({ line: lineOf(code, m.index), kind: "route-times" });
    } else if (!/^\s*\{/.test(third)) {
      // 変数等でオプションを渡すと times の有無を読めないので、オブジェクトリテラルで書かせる
      violations.push({ line: lineOf(code, m.index), kind: "route-opts" });
    }
  }
  return violations.sort((a, b) => a.line - b.line);
}

const MESSAGES = {
  unroute: "page.unroute で page のルートが0件になりうる",
  unrouteAll: "unrouteAll で page のルートが0件になる",
  "route-opts":
    "route の第3引数はオブジェクトリテラルで書く（変数だと times の有無を検査できない）",
  "route-times":
    "times 付きの route は回数に達すると外れ、page のルートが0件になりうる",
};

/**
 * 違反（{ file, line, code }）と許可リストを突き合わせる（純関数）。
 * 戻り値: { unallowed, stale, invalid }
 */
export function compareWithAllowlist(found, entries) {
  const invalid = entries.filter(
    (e) =>
      typeof e.file !== "string" ||
      typeof e.code !== "string" ||
      typeof e.reason !== "string" ||
      e.reason.trim().length < MIN_REASON_LENGTH,
  );
  const valid = entries.filter((e) => !invalid.includes(e));
  const used = new Set();
  const unallowed = found.filter((v) => {
    const idx = valid.findIndex(
      (e, k) =>
        !used.has(k) && e.file === v.file && e.code.trim() === v.code.trim(),
    );
    if (idx === -1) return true;
    used.add(idx);
    return false;
  });
  const stale = valid.filter((_, k) => !used.has(k));
  return { unallowed, stale, invalid };
}

/** ファイルの内容から { file, line, kind, code } の一覧を作る */
function scan(file, source) {
  const lines = source.split("\n");
  return findViolations(source).map((v) => ({
    ...v,
    file,
    code: lines[v.line - 1].trim(),
  }));
}

function selfTest() {
  const count = (src) => findViolations(src).length;
  const cases = [
    ["unroute を検出する", 'await page.unroute("**/a", h);', 1],
    [
      "unrouteAll を検出する",
      'await page.unrouteAll({ behavior: "ignoreErrors" });',
      1,
    ],
    ["context.unroute も検出する", "await context.unroute(URL);", 1],
    [
      "times 付きの page.route を検出する",
      'await page.route("**/a", h, { times: 1 });',
      1,
    ],
    [
      "複数行の times 付き route を検出する",
      'await context.route(\n  "**/a",\n  async (route) => route.fulfill({ status: 200 }),\n  { times: 2 },\n);',
      1,
    ],
    [
      "times の省略記法も検出する",
      'await page.route("**/a", h, { times });',
      1,
    ],
    [
      "第3引数が無い route は検出しない",
      'await page.route("**/a", (r) => r.fulfill({ times: 1 }));',
      0,
    ],
    [
      "ハンドラ内の times は第3引数ではない",
      "await page.route(re, async (route) => { const times = 1; await route.fallback(); });",
      0,
    ],
    ["行コメントは検出しない", "// page.unroute しない\nroute.fallback();", 0],
    [
      "ブロックコメントは検出しない",
      "/* await page.unrouteAll() */ route.fallback();",
      0,
    ],
    [
      "JSDoc 内は検出しない",
      "/**\n * page.unroute(x)\n * page.route(a, b, { times: 1 })\n */",
      0,
    ],
    ["文字列は検出しない", 'const s = "page.unroute(x)";', 0],
    ["テンプレートは検出しない", "const s = `${a}.unrouteAll(`;", 0],
    [
      "URL の // をコメントと誤らない",
      'const u = "https://x"; await page.unroute(u);',
      1,
    ],
    [
      "正規表現の中の引用符で崩れない",
      "const re = /[\"']/; await page.unroute(re);",
      1,
    ],
    [
      "割り算は正規表現と誤らない",
      "const a = b / 2; await page.unroute(x); const c = d / 3;",
      1,
    ],
    [
      "後置インクリメントの後の割り算で後ろを消さない",
      "x = a++ / 2; await page.unroute(y);",
      1,
    ],
    [
      "第3引数が変数の route は検出する（times の有無を読めない）",
      'await page.route("**/a", h, opts);',
      1,
    ],
    [
      "第3引数が times の無いオブジェクトなら検出しない",
      'await page.route("**/a", h, {});',
      0,
    ],
    // 修正前の #1084（6e71b77c^）の書き方
    [
      "#1084 修正前の smoke（unroute 2行）",
      '    await page.unroute("**/rest/v1/race_original_exhibition?*");\n    await page.unroute("**/rest/v1/race_original_exhibition_values*");',
      2,
    ],
    [
      "#1084 修正前の ga-pageview（unroute 2行）",
      "    await page.unroute(PERFORMANCE_API, emptyPerformance);\n    await page.unroute(PREDICTIONS, emptyPredictions);",
      2,
    ],
    // 修正後の書き方は検出しない
    [
      "#1084 修正後の ga-pageview（フラグで fallback）",
      "const h = (route) => !stubbing ? route.fallback() : route.fulfill({ status: 200 });\nawait page.route(RE, h);\nstubbing = false;",
      0,
    ],
  ];
  const failures = cases
    .map(([name, src, expected]) => ({ name, expected, got: count(src) }))
    .filter((c) => c.got !== c.expected)
    .map((c) => `${c.name}: 期待 ${c.expected} / 実際 ${c.got}`);

  const lineCheck = findViolations("a();\n\nawait page.unroute(x);")[0]?.line;
  if (lineCheck !== 3) failures.push(`行番号: 期待 3 / 実際 ${lineCheck}`);

  const found = [
    { file: "e2e/a.spec.js", line: 3, code: "await page.unrouteAll();" },
    { file: "e2e/a.spec.js", line: 9, code: "await page.unrouteAll();" },
  ];
  const ok = {
    file: "e2e/a.spec.js",
    code: "await page.unrouteAll();",
    reason: "live でだけ呼ぶため0件化が起きない",
  };
  const allowCases = [
    [
      "許可リストに載っていれば通す",
      [found[0]],
      [ok],
      { unallowed: 0, stale: 0, invalid: 0 },
    ],
    [
      "1エントリは1箇所だけ許す",
      found,
      [ok],
      { unallowed: 1, stale: 0, invalid: 0 },
    ],
    [
      "解消済みのエントリを検出する",
      [],
      [ok],
      { unallowed: 0, stale: 1, invalid: 0 },
    ],
    [
      "理由の無いエントリは無効",
      [found[0]],
      [{ ...ok, reason: "" }],
      { unallowed: 1, stale: 0, invalid: 1 },
    ],
    [
      "理由が短すぎるエントリは無効",
      [found[0]],
      [{ ...ok, reason: "例外" }],
      { unallowed: 1, stale: 0, invalid: 1 },
    ],
    [
      "別ファイルのエントリでは通さない",
      [found[0]],
      [{ ...ok, file: "e2e/b.spec.js" }],
      { unallowed: 1, stale: 1, invalid: 0 },
    ],
  ];
  for (const [name, f, entries, expected] of allowCases) {
    const r = compareWithAllowlist(f, entries);
    const got = {
      unallowed: r.unallowed.length,
      stale: r.stale.length,
      invalid: r.invalid.length,
    };
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
      failures.push(
        `${name}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(got)}`,
      );
    }
  }
  return { failures, total: cases.length + 1 + allowCases.length };
}

function e2eFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === "recordings" ? [] : e2eFiles(full);
    return d.name.endsWith(".js") ? [full] : [];
  });
}

function main() {
  const { failures, total } = selfTest();
  if (failures.length > 0) {
    console.error("NG: 検出ロジック自体が壊れています:");
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }

  const explicit = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const targets =
    explicit.length > 0
      ? explicit.map((p) => path.resolve(p))
      : e2eFiles(E2E_DIR);
  // e2e/ の外（修正前の版を書き出したもの等）は e2e/<名前> とみなす
  const label = (p) => {
    const rel = path.relative(ROOT, p).split(path.sep).join("/");
    return rel.startsWith("e2e/") ? rel : `e2e/${path.basename(p)}`;
  };
  const found = targets.flatMap((p) => scan(label(p), readFileSync(p, "utf8")));

  const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  const { unallowed, stale, invalid } = compareWithAllowlist(
    found,
    allowlist.entries ?? [],
  );
  const rel = path.relative(ROOT, ALLOWLIST_PATH);
  let ng = false;

  if (invalid.length > 0) {
    ng = true;
    console.error(
      `\nNG: ${rel} に理由（reason、${MIN_REASON_LENGTH}文字以上）の無いエントリがあります:`,
    );
    for (const e of invalid) console.error(`  ${e.file}: ${e.code}`);
  }
  if (unallowed.length > 0) {
    ng = true;
    console.error(
      "\nNG: page のルートを途中で0件にする書き方があります（BOA-466・BOA-661、ADR-0077 決定4）。" +
        "\n  0件になった瞬間の処理中の要求が context 側（録画の再生）へ送り直され、「Route is already handled!」で落ちる。" +
        "\n  上に page.route を重ねるか、フラグを倒して route.fallback() に回す。正当な例外なら理由つきで許可リストに載せる。",
    );
    for (const v of unallowed)
      console.error(
        `  ${v.file}:${v.line}  ${MESSAGES[v.kind]}\n      ${v.code}`,
      );
  }
  if (explicit.length === 0 && stale.length > 0) {
    ng = true;
    console.error(
      `\nNG: ${rel} に解消済みのエントリがあります（${stale.length} 件）。消してください:`,
    );
    for (const e of stale) console.error(`  ${e.file}: ${e.code}`);
  }
  if (ng) process.exit(1);
  console.log(
    `OK: 自己テスト ${total} 件、${targets.length} ファイルを検査（許可リストで通した箇所 ${found.length} 件）`,
  );
}

main();
