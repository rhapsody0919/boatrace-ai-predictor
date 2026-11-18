/**
 * verify-e2e-no-unroute.js の自己テスト。大きさの関所のため、本文を字のまま移した。verify ではない。
 */

export function selfTest({ findViolations, compareWithAllowlist }) {
  const count = (src) => findViolations(src).length;
  const cases = selfTestCases();
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
  const allowCases = selfTestAllowCases(found, ok);
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

function selfTestCases() {
  return [
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
}

function selfTestAllowCases(found, ok) {
  return [
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
}
