/**
 * verify-doc-placement.js - 全てのファイルの置き場の決まりを試験にする（ZB03 ②・BOA-1455、HR74 で表読みに広げた）。
 * ネットワークにも DB にも接続しない。一覧は git（ls-files と --others --exclude-standard）から取り、fs は歩かない
 * （手元の node_modules・dist・data/ml・.venv を数えない、HR74 ops 審査 P0-2）。中身を読むのは .gitignore・置き場の表・PR の本文だけ。
 *
 * 決まり（正本は置き場の表 scripts/maintenance/file-placement.json。AGENTS.md「構造と依存の向き」の表は人向けの要約）:
 *   (a) ルートディレクトリには置かない → 根の名前（一覧の最初の段。根の .gitignore の1段の型に当たる物は除く）が、
 *       表の git=track の行の glob の最初の段（旧 ROOT_FROZEN）に無ければ失敗
 *   (b) ファイル名は kebab-case（例外 README.md・TODO.md・AGENTS.md）→ docs/ の下（docs/db-migration/ を除く）の
 *       kebab-case でないファイルの件数を DOCS_FROZEN で凍結し、増えたら失敗
 *   (c) 表（HR74）: 全てのパスを上から最初に当たった行で判定。当たる行が無い・git=ignore の行に当たる・ext の外が行の frozen を越えた物は外れ。
 *       mode=shadow の間は placement-shadow: の行を出すだけで成功のまま、mode=red で失敗
 *   (d) 緩める差分（HR74 4節）: base（既定 origin/master、DOC_PLACEMENT_BASE で替える）の表と比べ、行の追加・frozen の増・ext を足す・
 *       track から ignore・red から shadow を見つけたら、PR 本文（GITHUB_EVENT_PATH、手元は環境変数 PLACEMENT_REASON）に
 *       「置き場の表: <理由>」の行を求める。有れば placement-loosen: の印を出して成功。無ければ、根の名前が増える差分は常に失敗
 *       （旧 ROOT_FROZEN を verify の中で直すのと同じ重さ）、それ以外は shadow の間は警告・red で失敗
 *   どれも減ったら成功のまま「凍結を下げる・行を消す」と出す。
 * 起動のたびに純関数の自己試験（文字列と共通の試験 file-placement.cases.json）を先に回し、落ちたら失敗にする。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "../..");
const TABLE_REL = "scripts/maintenance/file-placement.json";
const CASES_REL = "scripts/maintenance/file-placement.cases.json";
// origin/master 5559fbe8c で数えた docs/ の kebab-case でないファイルの数（2026-11-12）。減らしたら下げる
const DOCS_FROZEN = 188;
const ROOT_SKIP = [".git", "node_modules"];
const DOCS_SKIP = "docs/db-migration/";
const NAME_EXCEPTIONS = ["README.md", "TODO.md", "AGENTS.md"];
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REASON = /^置き場の表[:：]\s*\S/m;
const MODES = ["shadow", "red"];
const GITS = ["track", "ignore"];
const HOW_TO_FIX = {
  root: `根には置かない。置き場の表（${TABLE_REL}）から選んで移すか消す。手元だけの生成物なら .gitignore に足す。根に足すなら表に行を足し PR 本文に「置き場の表: <理由>」`,
  docs: "docs/ のファイル名は kebab-case にする（例外 README.md・TODO.md・AGENTS.md）",
  table: `置き場の表（${TABLE_REL}）の行に合う場所へ移すか消す。新しい種類なら同じ PR で表に行を足し、PR 本文に「置き場の表: <理由>」の行を書く`,
};

// 純関数: .gitignore の本文 → 根の名前に当てる正規表現の一覧（/ を中に含まない型だけ。否定 ! は扱わず、除く側に倒さない）
export const rootIgnoreRules = (text) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("!"))
    .map((l) => l.replace(/^\//, "").replace(/\/$/, ""))
    .filter((l) => l && !l.includes("/"))
    .map((l) => new RegExp(`^${l.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")}$`));

// 純関数: 名前 → kebab-case か（拡張子は最初の . から後を外す。. で始まる名前は名前全体）
export const isKebab = (name) =>
  NAME_EXCEPTIONS.includes(name) || KEBAB.test(name.startsWith(".") ? name : name.split(".")[0]);

// 純関数: パス → 拡張子（最後の . の後、小文字。. で始まる名前と点の無い名前は空文字）。hq の scripts/placement.py の ext_of と同じ
export const extOf = (p) => {
  const base = p.split("/").pop();
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i + 1).toLowerCase() : "";
};

// 純関数: glob → 正規表現（** は段をまたぐ、* と ? は1段の中）。hq の glob_re と同じ
export const globRe = (glob) => {
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      out += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
};

const firstSeg = (glob) => glob.split("/")[0];

// 純関数: 表 → 形の誤りの文の一覧
const extOk = (ext) => ext === "*" || (Array.isArray(ext) && ext.every((e) => typeof e === "string" && e === e.toLowerCase() && !e.includes(".")));

// 純関数: 1行 → 形の誤り（glob が在る行だけ。重複は tableErrors が見る）
const rowErrors = (r, at) => {
  const track = r.git === "track";
  return [
    ...(GITS.includes(r.git) ? [] : [`${at}の git ${r.git} は ${GITS.join("・")} のどれでもない`]),
    ...(extOk(r.ext) ? [] : [`${at}の ext は小文字・点なしの配列か "*"`]),
    ...(track && r.glob.includes("**") && r.ext === "*" ? [`${at}の ${r.glob} は ** で ext を絞らない（粗さの線）`] : []),
    ...(track && /[*?]/.test(firstSeg(r.glob)) ? [`${at}の ${r.glob} は最初の段に * ? を置けない（根の名前の一覧になるため）`] : []),
    ...(Number.isInteger(r.frozen) && r.frozen >= 0 ? [] : [`${at}の frozen は 0 以上の整数`]),
  ];
};

export const tableErrors = (table) => {
  if (!table || typeof table !== "object" || !Array.isArray(table.rows)) return ["表は {mode, rows: [...]} の object"];
  const errs = MODES.includes(table.mode) ? [] : [`mode ${table.mode} は ${MODES.join("・")} のどれでもない`];
  const seen = new Set();
  table.rows.forEach((r, i) => {
    const at = `${i + 1} 行目`;
    if (!r || typeof r.glob !== "string" || r.glob === "") {
      errs.push(`${at}の glob が空`);
      return;
    }
    if (seen.has(r.glob)) errs.push(`${at}の glob ${r.glob} が重複`);
    seen.add(r.glob);
    errs.push(...rowErrors(r, at));
  });
  return errs;
};

// 純関数: パスと表の行 → {row, problem}。problem は null・"none"・"ignore"・"ext"
export const classify = (p, rows) => {
  const row = rows.findIndex((r) => globRe(r.glob).test(p));
  if (row < 0) return { row: null, problem: "none" };
  const r = rows[row];
  if (r.git === "ignore") return { row, problem: "ignore" };
  if (r.ext !== "*" && !r.ext.includes(extOf(p))) return { row, problem: "ext" };
  return { row, problem: null };
};

// 純関数: 一覧と表 → {outside: [{path, row, problem}], hits, extCount: 行ごとの ext の外の数}（ext は frozen を越えた行の物だけ外れ）
export const evaluate = (paths, table) => {
  const hits = paths.map((p) => ({ path: p, ...classify(p, table.rows) }));
  const extCount = table.rows.map((_, i) => hits.filter((h) => h.row === i && h.problem === "ext").length);
  const outside = hits
    .filter((h) => h.problem === "none" || h.problem === "ignore" || (h.problem === "ext" && extCount[h.row] > table.rows[h.row].frozen))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { outside, hits, extCount };
};

// 純関数: 表 → 根に置ける名前（git=track の行の glob の最初の段）
export const rootAllowed = (table) => [...new Set(table.rows.filter((r) => r.git === "track").map((r) => firstSeg(r.glob)))];

// 純関数: base と head の表 → 緩める差分 [{what, root}]（root は根の名前が増える差分）
export const loosenings = (base, head) => {
  if (!base) return [];
  const out = [];
  if (base.mode === "red" && head.mode === "shadow") out.push({ what: "mode を red から shadow へ", root: false });
  const old = new Map(base.rows.map((r) => [r.glob, r]));
  head.rows.forEach((r) => {
    const b = old.get(r.glob);
    if (!b) {
      out.push({ what: `行の追加 ${r.glob}`, root: false });
      return;
    }
    if (r.frozen > b.frozen) out.push({ what: `${r.glob} の frozen ${b.frozen}→${r.frozen}`, root: false });
    if (b.git === "track" && r.git === "ignore") out.push({ what: `${r.glob} を track から ignore へ`, root: false });
    const wider = r.ext === "*" ? b.ext !== "*" : b.ext !== "*" && r.ext.some((e) => !b.ext.includes(e));
    if (wider) out.push({ what: `${r.glob} の ext を足した`, root: false });
  });
  const baseRoot = rootAllowed(base);
  rootAllowed(head)
    .filter((n) => !baseRoot.includes(n))
    .forEach((n) => out.push({ what: `根に置ける名前 ${n} を足した`, root: true }));
  return out;
};

// 純関数: 赤の理由の行
const ngLines = ({ added, bad, docsFrozen, red, outside, looseRed }) => [
  ...(added.length > 0 ? [`  - (a) 根に新しい物 ${added.length} 個: ${added.join("・")}`, `    直し方: ${HOW_TO_FIX.root}`] : []),
  ...(bad.length > docsFrozen
    ? [
        `  - (b) docs/ の kebab-case でないファイル ${bad.length} 件（凍結 ${docsFrozen} 件より ${bad.length - docsFrozen} 件増えた）。全件:`,
        ...bad.map((f) => `      ${f}`),
        `    直し方: ${HOW_TO_FIX.docs}`,
      ]
    : []),
  ...(red && outside.length > 0
    ? [`  - (c) 置き場の表の外 ${outside.length} 件:`, ...outside.map((o) => `      ${o.path}（${o.problem}）`), `    直し方: ${HOW_TO_FIX.table}`]
    : []),
  ...(looseRed.length > 0 ? [`  - (d) 置き場の表を緩める差分に PR 本文の「置き場の表: <理由>」の行が無い: ${looseRed.map((l) => l.what).join("・")}`] : []),
];

// 純関数: 成功のときの「下げる・消す」の知らせ
const noteLines = ({ gone, bad, docsFrozen, table, extCount, base }) => [
  ...(gone.length > 0 ? [`根から無くなった ${gone.join("・")} の行を表から消す`] : []),
  ...(bad.length < docsFrozen ? [`docs の件数が減ったので DOCS_FROZEN を ${bad.length} に下げる`] : []),
  ...table.rows.flatMap((r, i) => (extCount[i] < r.frozen ? [`${r.glob} の frozen を ${extCount[i]} に下げる`] : [])),
  ...(base === null ? ["base の表が無い・読めないので緩める差分は見ていない"] : []),
];

// 純関数: 一覧・表・凍結・base の表・PR 本文 → {ok, lines}
export const judge = ({ paths, ignoreRules }, { table, docsFrozen, base, body }) => {
  const shape = tableErrors(table);
  if (shape.length > 0) return { ok: false, lines: ["verify-doc-placement: NG", ...shape.map((e) => `  - 置き場の表: ${e}`)] };
  const rootNames = [...new Set(paths.map(firstSeg))].filter((n) => !ROOT_SKIP.includes(n) && !ignoreRules.some((r) => r.test(n)));
  const allowed = rootAllowed(table);
  const added = rootNames.filter((n) => !allowed.includes(n)).sort();
  const gone = allowed.filter((n) => !rootNames.includes(n));
  const bad = paths.filter((f) => f.startsWith("docs/") && !f.startsWith(DOCS_SKIP) && !isKebab(path.posix.basename(f))).sort();
  const { outside, hits, extCount } = evaluate(paths, table);
  const loose = loosenings(base, table);
  const reason = typeof body === "string" && REASON.test(body);
  const red = table.mode === "red";
  const looseRed = reason ? [] : loose.filter((l) => l.root || red);
  const ng = ngLines({ added, bad, docsFrozen, red, outside, looseRed });
  if (ng.length > 0) return { ok: false, lines: ["verify-doc-placement: NG", ...ng] };
  const rowName = (o) => (o.row === null ? null : table.rows[o.row].glob);
  const shadow = red ? [] : outside.map((o) => `placement-shadow: ${JSON.stringify({ path: o.path, row: rowName(o), reason: o.problem })}`);
  const marks = loose.map((l) => (reason ? `placement-loosen: ${l.what}（理由の行あり）` : `placement-loosen-warn: ${l.what}（理由の行なし、mode=shadow の間は警告）`));
  const notes = noteLines({ gone, bad, docsFrozen, table, extCount, base });
  const coarse = table.rows
    .map((r, i) => [r, hits.filter((h) => h.row === i).length])
    .filter(([r]) => r.git === "track" && r.glob.includes("**"))
    .map(([r, n]) => `${r.glob} ${n}`);
  const summary =
    `verify-doc-placement: OK（${paths.length} 件・根 ${rootNames.length} 個は全て表の内、docs の kebab-case でない ${bad.length}/${docsFrozen} 件、` +
    `表の外 ${outside.length} 件（mode=${table.mode}${red ? "" : "、赤にしない"}）。** の行の当たり: ${coarse.join("・")}${notes.length ? `。${notes.join("・")}` : ""}）`;
  return { ok: true, lines: [...shadow, ...marks, summary] };
};

const selfTest = (cases) => {
  const rules = rootIgnoreRules("# c\ndist\n/test-results/\n*.log\n!keep.log\ndata/ml/\n");
  const ignored = (n) => rules.some((r) => r.test(n));
  const row = (glob, ext = ["md"], frozen = 0) => ({ glob, kind: "k", owner: "o", ext, git: "track", frozen });
  const table = { mode: "shadow", rows: [row("src/**", ["js"]), row("docs/**")] };
  const ctx = { table, docsFrozen: 1, base: table, body: "" };
  const base = { paths: ["src/a.js", "docs/a/good-name.md", "docs/a/Bad_Name.md", "docs/README.md"], ignoreRules: rules };
  const withRow = (glob) => ({ ...table, rows: [...table.rows, row(glob)] });
  const plus = (p) => ({ ...base, paths: [...base.paths, p] });
  const checks = [
    [".gitignore の1段の型（dist・/test-results/・*.log）だけを除き、data/ml/ は根に当てない",
      ignored("dist") && ignored("test-results") && ignored("x.log") && !ignored("data") && !ignored("ml")],
    ["kebab-case の判定（拡張子は外す・例外の名前は通す）",
      isKebab("good-name.dc.html") && !isKebab("Main.dc.html") && !isKebab("a_b.md") && isKebab("AGENTS.md")],
    ["凍結と同じなら成功", judge(base, ctx).ok === true],
    ["根に新しい物があると失敗", judge(plus("plan.md"), ctx).ok === false],
    ["根の .gitignore に当たる名前は根に数えない", judge(plus("x.log"), ctx).ok === true],
    ["docs の kebab でない物が増えると失敗", judge(plus("docs/x/New_File.md"), ctx).ok === false],
    ["根から消えた・docs が減ったら成功で消す・下げるよう出す",
      judge({ paths: ["src/a.js", "docs/a/good-name.md"], ignoreRules: rules }, ctx).lines.at(-1).includes("下げる")],
    ["表の形の誤りは失敗", judge(base, { ...ctx, table: { ...table, mode: "loud" } }).ok === false],
    ["shadow は表の外を placement-shadow の行で出して成功",
      ((r) => r.ok && r.lines.some((l) => l.startsWith("placement-shadow:") && l.includes("src/a.py")))(judge(plus("src/a.py"), ctx))],
    ["red は表の外で失敗", judge(plus("src/a.py"), { ...ctx, table: { ...table, mode: "red" }, base: null }).ok === false],
    ["根の名前が増える表の差分は shadow でも理由の行が無ければ失敗、有れば印つきで成功",
      judge(plus("plan.md"), { ...ctx, table: withRow("plan.md") }).ok === false &&
      judge(plus("plan.md"), { ...ctx, table: withRow("plan.md"), body: "本文\n置き場の表: 入口を足す\n" }).lines.some((l) => l.startsWith("placement-loosen:"))],
    ["根の外の行の追加は shadow の間は警告で成功、red なら理由の行が無いと失敗",
      ((r) => r.ok && r.lines.some((l) => l.startsWith("placement-loosen-warn:")))(judge(base, { ...ctx, table: withRow("src/x/**") })) &&
      judge(base, { ...ctx, base: { ...table, mode: "red" }, table: { ...withRow("src/x/**"), mode: "red" } }).ok === false],
    ["緩める差分の種類（frozen の増・ext を足す・ignore へ・shadow へ）を拾う",
      loosenings({ ...table, mode: "red" }, { ...table, rows: [row("src/**", ["js", "py"], 2), { ...row("docs/**"), git: "ignore" }] }).length === 4],
    ["締める差分（行を消す・frozen を下げる・ext を絞る）は印を出さない",
      loosenings({ ...table, rows: [row("src/**", ["js", "ts"], 3), row("docs/**"), row("e2e/**")] }, table).length === 0],
  ];
  const fails = checks.filter(([, pass]) => !pass).map(([name]) => name);
  // 共通の試験（hq の tests/test_placement.py と同じ入力）
  cases.classify.forEach((c) => {
    const got = classify(c.path, cases.table.rows);
    if (got.row !== c.row || got.problem !== c.problem) fails.push(`共通の試験 classify ${c.path}: ${JSON.stringify(got)}`);
  });
  cases.evaluate.forEach((c) => {
    const got = evaluate(c.paths, cases.table).outside.map((o) => o.path);
    if (JSON.stringify(got) !== JSON.stringify(c.outside)) fails.push(`共通の試験 evaluate ${c.paths.join(",")}: ${got.join(",")}`);
  });
  cases.table_errors.forEach((c, i) => {
    const n = tableErrors(c.table).length;
    if (n !== c.errors) fails.push(`共通の試験 table_errors ${i + 1}: ${n} 件`);
  });
  return fails;
};

const git = (args) =>
  execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
const zlist = (args) => git([...args, "-z"]).split("\0").filter(Boolean);

const readBase = (ref) => {
  try {
    return JSON.parse(git(["show", `${ref}:${TABLE_REL}`]));
  } catch {
    return null;
  }
};

const prBody = () => {
  const ev = process.env.GITHUB_EVENT_PATH;
  if (ev && fs.existsSync(ev)) {
    const body = JSON.parse(fs.readFileSync(ev, "utf8"))?.pull_request?.body;
    if (typeof body === "string") return body;
  }
  return process.env.PLACEMENT_REASON ? `置き場の表: ${process.env.PLACEMENT_REASON}` : "";
};

const main = () => {
  const cases = JSON.parse(fs.readFileSync(path.join(ROOT, CASES_REL), "utf8"));
  const broken = selfTest(cases);
  if (broken.length > 0) {
    console.error(`verify-doc-placement: 自己試験が落ちた（${broken.join("・")}）`);
    process.exit(1);
  }
  const ignorePath = path.join(ROOT, ".gitignore");
  const ignoreRules = fs.existsSync(ignorePath) ? rootIgnoreRules(fs.readFileSync(ignorePath, "utf8")) : [];
  // 追跡は作業ツリーで消した物を除く。未追跡は ignore の外だけ
  const deleted = new Set(zlist(["ls-files", "--deleted"]));
  const paths = [...new Set([...zlist(["ls-files"]).filter((p) => !deleted.has(p)), ...zlist(["ls-files", "--others", "--exclude-standard"])])].sort();
  const table = JSON.parse(fs.readFileSync(path.join(ROOT, TABLE_REL), "utf8"));
  const base = readBase(process.env.DOC_PLACEMENT_BASE || "origin/master");
  const { ok, lines } = judge({ paths, ignoreRules }, { table, docsFrozen: DOCS_FROZEN, base, body: prBody() });
  (ok ? console.log : console.error)(lines.join("\n"));
  if (!ok) process.exit(1);
};

// /tmp 等の symlink の下から起動しても main が走るよう、両方を realpath で比べる（走らないと無出力の偽の緑）
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) main();
