/**
 * prSize.js - PR の大きさ（AGENTS.md の安全の6点の5「300行・5ファイル」）を数える（BOA-1718）。
 *
 * 作り手が自分で数えるのをやめ、機械で数える。数えない物は少なく決め、ほかは全部数える（知らない置き場は数える側）:
 *   1. 新しく足した e2e の spec（e2e 以下の *.spec.js）と、同じ PR で台帳に足した verify（scripts/maintenance/verify-*.js）。
 *      ただし試験でないほかの変更ファイル（文書・台帳を除く）の足した行に名が出るなら数える（試験のファイルに本体を置く抜け道）。
 *      数える側に移った試験の名を出す試験も数える。数えない試験の置き場から数える置き場への改名は、先の全部の行を数える
 *   2. verify-registry.json の項目の追加だけ（JSON で比べ、既存の項目を1字でも変えたら全部数える）
 *   3. ja 以外の locale（src/locales/<言語>/<名>.json）の行の追加だけで、足したキーの集合が同じ PR の ja の同じ名の
 *      ファイルで足したキーの集合と同じとき（ja は数える。訳の揃いは verify-i18n-consistency が CI で見る）
 *   4. 空行と、コードのファイル（.js・.jsx・.mjs・.cjs・.ts・.tsx・.css）の注釈だけの行（行頭が // ・* ・/* ・{/*）
 *   5. 消しただけの行（数えるのは足した行だけ。死んだコードを消す PR を罰さない。目安、根拠なし）
 * ファイルの数は、数える行が1つ以上あるファイルと、行の無い差分（バイナリ・改名だけ・mode だけ）の数。消したファイルは数えない。
 * 線の外（全部を数えない）の PR: 移すだけ（pr-lane の moveOnlyPaths が差分の全部のファイルを移すだけと判定）と、
 * 記事の PR（scripts/content/check-content-pr.js が通す）。判定は呼び手がその物を呼んで渡す。
 *
 * git に触れない純関数。git から読んで数える入口は prSizeGit.js の measureCommits（verify-pr-size.js と pr-lane.js が呼ぶ）。
 */

/** 線（数字の根拠は無いが動かさない。オーナー 2026-11-24、BOA-1718） */
export const SIZE_LIMIT = Object.freeze({ lines: 300, files: 5 });

const NEW_TEST = [
  /^e2e\/.*\.spec\.js$/,
  /^scripts\/maintenance\/verify-[^/]+\.(js|mjs|cjs|sh)$/,
];
const REGISTRY = /^scripts\/maintenance\/verify-registry\.json$/;
const LOCALE = /^src\/locales\/([^/]+)\/(.+\.json)$/;
const CODE = /\.(js|jsx|mjs|cjs|ts|tsx|css)$/;
// 注釈だけの行: // で始まる、/* で始まり行の末で閉じるか閉じない、{/* で始まり行の末の */} で閉じる、
// ブロックの注釈の中の行（* の後が空白か行の末）。/**/ の後ろにコードを置く行・CSS の * のセレクタは数える
const NOTE = [
  /^\s*\/\//,
  /^\s*\/\*(?!.*\*\/.*\S.*$)(.*\*\/\s*$|(?!.*\*\/).*$)/,
  /^\s*\{\/\*.*\*\/\}\s*$/,
];
const NOTE_INNER = /^\s*\*(\s|\/\s*$|$)/;

/** 数えない行（空行・コードのファイルの注釈だけの行） */
export function isNoteLine(path, line) {
  if (line.trim() === "") return true;
  if (!CODE.test(path)) return false;
  if (NOTE.some((re) => re.test(line))) return true;
  return !path.endsWith(".css") && NOTE_INNER.test(line);
}

/** 行の追加だけか（配列の末尾に足して前の行の "}" が "}," に変わった物は書き換えに数えない） */
function onlyAdded(patch) {
  return patch.removed.every((line) => patch.added.includes(`${line},`));
}

/** JSON の葉のキー（"a.b.c"）の集合。ファイルが無ければ空、読めなければ null */
function leafKeys(text) {
  if (text === null || text === undefined) return new Set();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null; // 読めない JSON は数える側に倒す（呼び手が null を見て数える）
  }
  const keys = new Set();
  const walk = (v, prefix) => {
    if (v && typeof v === "object" && !Array.isArray(v))
      for (const [k, child] of Object.entries(v))
        walk(child, prefix ? `${prefix}.${k}` : k);
    else keys.add(prefix);
  };
  walk(value, "");
  return keys;
}

/** base と head の JSON の間で足したキー（並べた配列。読めなければ null） */
function addedKeys(readText, path) {
  const before = leafKeys(readText("base", path));
  const after = leafKeys(readText("head", path));
  if (before === null || after === null) return null;
  return [...after].filter((k) => !before.has(k)).sort();
}

const sameList = (a, b) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** 数えない locale のファイル（ja 以外で、ja の同じ名と足したキーが同じ、行の追加だけ） */
function exemptLocales(changes, patches, readText) {
  const exempt = new Map();
  for (const { status, path } of changes) {
    const m = LOCALE.exec(path);
    if (!m || m[1] === "ja" || status === "D") continue;
    const jaPath = `src/locales/ja/${m[2]}`;
    const patch = patches.get(path);
    if (!patch || !onlyAdded(patch)) continue;
    if (!changes.some((c) => c.path === jaPath && c.status !== "D")) continue;
    const mine = addedKeys(readText, path);
    const ja = addedKeys(readText, jaPath);
    if (mine && ja && mine.length > 0 && sameList(mine, ja))
      exempt.set(path, `ja（${jaPath}）と同じキー ${mine.length} 件の追加`);
  }
  return exempt;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 足した行に、この試験のファイルの名が引用符か / の後に出るか（import・require・new URL・path.join・bash の起動。
 * 拡張子は省いてもよい）。語で絞らない（数えすぎは安全側）
 */
function namesFile(lines, testPath) {
  const name = escapeRe(
    testPath
      .split("/")
      .pop()
      .replace(/\.(js|mjs|cjs|sh)$/, ""),
  );
  const re = new RegExp(`[/"'\`]${name}(\\.(js|mjs|cjs|sh))?(?![\\w.-])`);
  return lines.some((line) => re.test(line));
}

/** 同じ PR で台帳に tier=ci で足した verify の名（台帳に無い verify-*.js は試験と見なさない。verify の名の道具を除く） */
function registeredTests(readText) {
  const names = (side) => {
    try {
      const reg = JSON.parse(
        readText(side, "scripts/maintenance/verify-registry.json") ?? "{}",
      );
      return new Set(
        (reg.entries ?? []).filter((v) => v.tier === "ci").map((v) => v.script),
      );
    } catch {
      return new Set(); // 読めない台帳は「足した verify なし」（verify を数える側）
    }
  };
  const before = names("base");
  return new Set([...names("head")].filter((n) => !before.has(n)));
}

/**
 * 数えない新しい試験のファイル。試験でないほかの変更ファイル（文書・台帳を除く）の足した行に名が出る物は数え、
 * 数える側に移った試験の名を出す試験も数える（不動点まで。試験を経由して本体を読む形）
 */
function exemptTests(changes, patches, readText) {
  const added = registeredTests(readText);
  const candidates = new Set(
    changes
      .filter((c) => c.status === "A")
      .map((c) => c.path)
      .filter((p) =>
        /^e2e\//.test(p)
          ? NEW_TEST[0].test(p)
          : NEW_TEST[1].test(p) && added.has(p.split("/").pop()),
      ),
  );
  const readers = changes
    .map((c) => c.path)
    .filter((p) => !candidates.has(p) && !REGISTRY.test(p) && !/\.md$/.test(p));
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of [...candidates]) {
      if (readers.some((r) => namesFile(patches.get(r)?.added ?? [], t))) {
        candidates.delete(t);
        readers.push(t);
        changed = true;
      }
    }
  }
  return new Map([...candidates].map((p) => [p, "新しい試験のファイル"]));
}

/** 台帳の変更が、既存の項目を変えずに新しい script の項目を足しただけか（JSON で比べる） */
function registryOnlyAdded(readText) {
  try {
    const items = (side) =>
      JSON.parse(
        readText(side, "scripts/maintenance/verify-registry.json") ?? "null",
      ).entries;
    const before = items("base");
    const after = items("head");
    const key = (v) => JSON.stringify(v);
    const kept = new Set(after.map(key));
    const known = new Set(before.map((v) => v.script));
    return (
      before.every((v) => kept.has(key(v))) &&
      after.every(
        (v) => before.some((b) => key(b) === key(v)) || !known.has(v.script),
      )
    );
  } catch {
    return false; // 読めない台帳は数える
  }
}

/** 数えないファイル → 理由（新しい試験・ja と同じキーの locale・台帳の行の追加だけ） */
function skipList(changes, live, patches, readText) {
  const skip = new Map([
    ...exemptTests(changes, patches, readText),
    ...exemptLocales(changes, patches, readText),
  ]);
  const reg = live.find((c) => REGISTRY.test(c.path));
  if (reg && registryOnlyAdded(readText))
    skip.set(reg.path, "台帳の項目の追加だけ");
  return skip;
}

/**
 * 数えない試験の置き場から数える置き場への改名は、先のファイルの全部の行を足した行として扱う
 * （-M で差分だけになると、試験として足した本体を次の PR の改名で洗える）
 */
function laundered(change, patches, readText) {
  if (change.status !== "R" || !change.from) return patches.get(change.path);
  const fromTest = NEW_TEST.some((re) => re.test(change.from));
  const toTest = NEW_TEST.some((re) => re.test(change.path));
  if (!fromTest || toTest) return patches.get(change.path);
  const text = readText("head", change.path);
  return { added: text === null ? [""] : text.split("\n"), removed: [] };
}

/** ファイルごとに数える（数えない物は skipped に理由つきで） */
function countFiles(live, patches, skip, readText) {
  const counted = [];
  const skipped = [];
  for (const change of live) {
    const { path } = change;
    const patch = laundered(change, patches, readText);
    if (skip.has(path)) skipped.push({ path, why: skip.get(path) });
    else if (!patch || patch.added.length + patch.removed.length === 0)
      counted.push({ path, lines: 0 }); // 行の無い差分（バイナリ・改名だけ・mode だけ）はファイルに数える
    else {
      const lines = patch.added.filter((l) => !isNoteLine(path, l)).length;
      if (lines > 0) counted.push({ path, lines });
      else skipped.push({ path, why: "注釈・空行・消した行だけ" });
    }
  }
  return { counted, skipped };
}

/**
 * PR の大きさを数える（git に触れない）
 * @param {{
 *   changes: { status: string, path: string, from?: string }[],
 *   patches: Map<string, { added: string[], removed: string[] }>,
 *   readText?: (side: "base"|"head", path: string) => string|null,
 *   moved?: Set<string>,
 *   contentPr?: boolean,
 * }} input
 * @returns {{ lines: number, files: number, over: boolean, exempt: string|null,
 *   counted: { path: string, lines: number }[], skipped: { path: string, why: string }[] }}
 */
export function measurePrSize({
  changes,
  patches,
  readText = () => null,
  moved = new Set(),
  contentPr = false,
}) {
  const live = changes.filter((c) => c.status !== "D");
  const whole = (why) => ({
    lines: 0,
    files: 0,
    over: false,
    exempt: why,
    counted: [],
    skipped: live.map((c) => ({ path: c.path, why })),
  });
  if (contentPr) return whole("記事の PR（check-content-pr.js が通す）");
  if (changes.length > 0 && changes.every((c) => moved.has(c.path)))
    return whole("移すだけ（pr-lane の moveOnly）");

  const { counted, skipped } = countFiles(
    live,
    patches,
    skipList(changes, live, patches, readText),
    readText,
  );
  const lines = counted.reduce((n, c) => n + c.lines, 0);
  return {
    lines,
    files: counted.length,
    over: lines > SIZE_LIMIT.lines || counted.length > SIZE_LIMIT.files,
    exempt: null,
    counted,
    skipped,
  };
}
