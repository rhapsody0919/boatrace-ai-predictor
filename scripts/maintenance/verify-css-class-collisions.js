#!/usr/bin/env node
/**
 * verify-css-class-collisions.js - 別の CSS ファイルが同じクラス名を
 * スコープせずに定義している（＝詳細度が同じで、勝敗がバンドル順で決まる）ものを検出する。
 *
 * 背景: このアプリは素の CSS（グローバルなクラス名）で、Vite が全ページの CSS を
 * 1つのバンドルに結合する。別ページの CSS が同じクラス名を定義すると、バンドル順で
 * 後に来た方が他ページにも効き、見た目が壊れる。同じ型が3回起きた。
 *   - BOA-206・207: .venue-name / .race-card / .page-header h1 / .step-content 等
 *   - BOA-539（#961）: ContentHub.css の .venue-grid がホームの VenueGrid.css を上書きし、
 *     PC 幅で 8〜16 列になった（意図は4列）。.venue-name も的中ページに漏れていた
 * BOA-207 で check-css-class-collisions.js（手動実行）を作ったが、CI に載っておらず、
 * かつ「セレクタ文字列の完全一致」しか見ないため、#961 は誰にも検知されなかった。
 * 本スクリプトはそれを置き換える（旧スクリプトは削除済み）。
 *
 * 検出の基準（詳細度の完全な計算はしない。「順序依存になりうるか」の実用的な近似）:
 *   - 対象: src/ 以下の *.css。@media / @supports / @container / @layer の中も対象。
 *     @keyframes・@font-face 等の中と、コメント・文字列は対象外（postcss でパースする）
 *   - セレクタをカンマで分け、各セレクタの「先頭の複合セレクタ」に現れるクラスを
 *     「スコープされていない定義」とみなす。
 *       .venue-grid {}                 → venue-grid が対象
 *       .venue-grid .venue-card {}     → venue-grid が対象（venue-card は venue-grid でスコープ済み）
 *       .guide-page .venue-grid {}     → guide-page が対象、venue-grid は対象外
 *   - ただし、クラスも ID も持たない複合（html / body / :root / [data-theme="dark"] / * 等）は
 *     ページを絞り込まないので読み飛ばし、その次の複合を先頭とみなす。
 *       [data-theme="dark"] .venue-grid {}  → venue-grid が対象
 *   - :not() / :is() / :where() / :has() の括弧内と、属性セレクタの値は見ない
 *   - 同じクラスが2つ以上の別ファイルで「スコープされていない定義」を持てば衝突。
 *     同じファイル内の重複は順序が明確なので対象外
 *
 * 既存の衝突は css-class-collisions-allowlist.json に（クラス名, ファイル群）で登録し、
 * 新しく増えた衝突だけで失敗させる。許可リストにあるのに衝突していない（解消済み）
 * エントリも失敗させる（許可リストを腐らせないため）。
 *
 * 使い方:
 *   node scripts/maintenance/verify-css-class-collisions.js                  # 自己テスト + 検査
 *   node scripts/maintenance/verify-css-class-collisions.js --report         # 衝突ごとの内訳（宣言の食い違い）を出す
 *   node scripts/maintenance/verify-css-class-collisions.js --print-allowlist # 現状の衝突を許可リスト形式で標準出力に出す（書き込みはしない）
 */
import postcss from "postcss";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SRC_DIR = path.join(ROOT, "src");
const ALLOWLIST_PATH = path.join(HERE, "css-class-collisions-allowlist.json");

// 中のルールがクラスを「定義」するとみなす at-rule。これ以外（keyframes 等）の中は見ない
const TRANSPARENT_AT_RULES = new Set([
  "media",
  "supports",
  "container",
  "layer",
  "document",
]);

/** 括弧の中身（:not(.x) 等）と属性セレクタの中身を取り除く */
function stripNested(selector) {
  let s = selector.replace(/\[[^\]]*\]/g, "[]");
  let prev;
  do {
    prev = s;
    s = s.replace(/\([^()]*\)/g, "()");
  } while (s !== prev);
  return s;
}

/** セレクタを複合セレクタ（子孫・子・兄弟の結合子で区切った単位）に分ける */
function compoundsOf(selector) {
  return stripNested(selector)
    .trim()
    .split(/\s*[>+~]\s*|\s+/)
    .filter(Boolean);
}

/**
 * 1つのセレクタ（カンマ分割後）について、スコープされていないクラス名を返す（無ければ null）。
 * 先頭の複合セレクタの「最初のクラス」だけを取る。.tab-btn.active の .active は
 * .tab-btn に絞られた修飾子なので、単独の定義とはみなさない。
 * 基準の全体はファイル冒頭のコメントを参照。
 */
export function leadingClass(selector) {
  for (const compound of compoundsOf(selector)) {
    if (!/[.#]/.test(compound)) continue; // html / body / :root / [data-theme] 等はページを絞らない
    if (compound.includes("#")) return null; // ID で絞られている
    return compound.match(/\.(-?[_a-zA-Z][\w-]*)/)[1];
  }
  return null;
}

/** ルールを囲む at-rule の連なり（--report で同じ条件のルール同士を比べるため） */
function contextOf(rule) {
  const parts = [];
  for (let p = rule.parent; p && p.type !== "root"; p = p.parent) {
    parts.unshift(`@${p.name} ${p.params}`.replace(/\s+/g, " ").trim());
  }
  return parts.join(" ");
}

/** ルールの祖先がすべて「透過」な at-rule か（=トップレベル相当か） */
function isTopLevelRule(rule) {
  for (let p = rule.parent; p && p.type !== "root"; p = p.parent) {
    if (p.type !== "atrule") return false; // CSS ネスト（親がルール）は親でスコープ済み
    if (!TRANSPARENT_AT_RULES.has(p.name.toLowerCase())) return false;
  }
  return true;
}

/**
 * CSS 文字列から「スコープされていないクラスの定義」を集める。
 * 戻り値: Map<className, Array<{ selector, context, decls: Map<prop, value> }>>
 *   context: 囲んでいる at-rule（例: "@media (max-width: 480px)"）。トップレベルは ""
 */
export function collectUnscopedClasses(cssText, from = "input.css") {
  const root = postcss.parse(cssText, { from });
  const byClass = new Map();
  root.walkRules((rule) => {
    if (!isTopLevelRule(rule)) return;
    const decls = new Map();
    rule.each((node) => {
      if (node.type === "decl") decls.set(node.prop, node.value);
    });
    for (const selector of rule.selectors) {
      const cls = leadingClass(selector);
      if (!cls) continue;
      if (!byClass.has(cls)) byClass.set(cls, []);
      byClass.get(cls).push({
        selector: selector.trim(),
        context: contextOf(rule),
        decls,
      });
    }
  });
  return byClass;
}

/**
 * files: Array<{ file, css }> を受け取り、衝突を返す。
 * 戻り値: Array<{ className, files: string[] }>（className 順・files はソート済み）
 */
export function findCollisions(files) {
  const filesByClass = new Map();
  for (const { file, css } of files) {
    for (const cls of collectUnscopedClasses(css, file).keys()) {
      if (!filesByClass.has(cls)) filesByClass.set(cls, new Set());
      filesByClass.get(cls).add(file);
    }
  }
  return [...filesByClass]
    .filter(([, set]) => set.size >= 2)
    .map(([className, set]) => ({ className, files: [...set].sort() }))
    .sort((a, b) => a.className.localeCompare(b.className));
}

/**
 * 衝突と許可リストを突き合わせる。
 * 戻り値: { added: [{className, files, newFiles}], stale: [{className, staleFiles, resolved}] }
 */
export function compareWithAllowlist(collisions, allowEntries) {
  const allow = new Map(allowEntries.map((e) => [e.class, new Set(e.files)]));
  const current = new Map(
    collisions.map((c) => [c.className, new Set(c.files)]),
  );

  const added = [];
  for (const { className, files } of collisions) {
    const allowed = allow.get(className);
    const newFiles = allowed ? files.filter((f) => !allowed.has(f)) : files;
    if (newFiles.length > 0) added.push({ className, files, newFiles });
  }

  const stale = [];
  for (const [className, allowedFiles] of allow) {
    const now = current.get(className);
    const staleFiles = [...allowedFiles].filter((f) => !now?.has(f));
    if (staleFiles.length > 0) {
      stale.push({ className, staleFiles, resolved: !now });
    }
  }
  return { added, stale };
}

async function listCssFiles(dir) {
  const entries = await fs.readdir(dir, {
    withFileTypes: true,
    recursive: true,
  });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".css"))
    .map((e) => path.relative(ROOT, path.join(e.parentPath ?? e.path, e.name)))
    .sort();
}

async function loadSources() {
  const files = await listCssFiles(SRC_DIR);
  return Promise.all(
    files.map(async (file) => ({
      file,
      css: await fs.readFile(path.join(ROOT, file), "utf8"),
    })),
  );
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
  const seen = new Set();
  for (const e of json.entries) {
    if (typeof e.class !== "string" || !Array.isArray(e.files)) {
      throw new Error(
        `許可リストの形式が不正です（class と files が必要）: ${JSON.stringify(e)}`,
      );
    }
    if (seen.has(e.class)) {
      throw new Error(`許可リストに同じクラスが2回あります: ${e.class}`);
    }
    seen.add(e.class);
  }
  return json.entries;
}

// ---------------------------------------------------------------------------
// 自己テスト（毎回実行する。検出ロジックが壊れたまま「0件」で通るのを防ぐ）
// ---------------------------------------------------------------------------

function gitShow(rev) {
  try {
    return execFileSync("git", ["show", rev], { cwd: ROOT, encoding: "utf8" });
  } catch (e) {
    throw new Error(
      `自己テストの入力 ${rev} を git から読めません（CI は fetch-depth: 0 が前提）: ${e.message}`,
    );
  }
}

function selfTests() {
  const names = (files) => findCollisions(files).map((c) => c.className);
  const cases = [
    {
      name: "スコープされていない同名 → 検出する",
      got: names([
        { file: "a.css", css: ".card { color: red; }" },
        { file: "b.css", css: ".card:hover { color: blue; }" },
      ]),
      want: ["card"],
    },
    {
      name: "親でスコープされている → 検出しない",
      got: names([
        { file: "a.css", css: ".page-a .card { color: red; }" },
        { file: "b.css", css: ".page-b > .card { color: blue; }" },
      ]),
      want: [],
    },
    {
      name: "子孫セレクタの先頭クラスは対象（.grid .item と .grid）",
      got: names([
        { file: "a.css", css: ".grid .item { color: red; }" },
        { file: "b.css", css: ".grid { display: grid; }" },
      ]),
      want: ["grid"],
    },
    {
      name: "@media の中 → 検出する",
      got: names([
        { file: "a.css", css: ".card { color: red; }" },
        {
          file: "b.css",
          css: "@media (max-width: 480px) { .card { color: blue; } }",
        },
      ]),
      want: ["card"],
    },
    {
      name: "[data-theme] や body はスコープにならない → 検出する",
      got: names([
        { file: "a.css", css: '[data-theme="dark"] .card { color: red; }' },
        { file: "b.css", css: "body .card { color: blue; }" },
      ]),
      want: ["card"],
    },
    {
      name: "同じファイル内 → 検出しない",
      got: names([
        { file: "a.css", css: ".card { color: red; } .card { color: blue; }" },
      ]),
      want: [],
    },
    {
      name: "コメント・文字列・:not() の中 → 検出しない",
      got: names([
        {
          file: "a.css",
          css: "/* .card { color: red; } */ .x { content: '.card'; }",
        },
        {
          file: "b.css",
          css: ".y:not(.card) { color: blue; } .card { color: blue; }",
        },
      ]),
      want: [],
    },
    {
      name: "@keyframes の中 → 検出しない",
      got: names([
        { file: "a.css", css: "@keyframes a { from { opacity: 0; } }" },
        { file: "b.css", css: "@keyframes b { from { opacity: 1; } }" },
      ]),
      want: [],
    },
    {
      // .venue-grid はホーム（race/VenueGrid.css）と同じ詳細度で衝突していた。
      // .venue-name は HitRaces.css 側が .venue-stats-table でスコープ済み（詳細度で勝つ）なので
      // 順序依存ではなく、この verify の対象外（ContentHub 側の他プロパティが漏れるのは見逃す。既知の限界）
      name: "#961 の修正前（ContentHub.css の .venue-grid）を検出し、スコープ済みの .venue-name は検出しない",
      got: names(
        [
          "src/pages/ContentHub.css",
          "src/components/race/VenueGrid.css",
          "src/components/HitRaces.css",
        ].map((f) => ({ file: f, css: gitShow(`2e01fe64^:${f}`) })),
      )
        .filter((n) => n === "venue-grid" || n === "venue-name")
        .sort(),
      want: ["venue-grid"],
    },
    {
      name: "#961 の修正後は .venue-grid を検出しない",
      got: names(
        [
          "src/pages/ContentHub.css",
          "src/components/race/VenueGrid.css",
          "src/components/HitRaces.css",
        ].map((f) => ({ file: f, css: gitShow(`2e01fe64:${f}`) })),
      ).filter((n) => n === "venue-grid" || n === "venue-name"),
      want: [],
    },
  ];

  const collisions = [{ className: "card", files: ["a.css", "b.css"] }];
  const allowCases = [
    {
      name: "許可リストの腐敗（解消済みのクラス）→ 検出する",
      got: compareWithAllowlist(collisions, [
        { class: "card", files: ["a.css", "b.css"] },
        { class: "gone", files: ["a.css", "b.css"] },
      ]).stale.map((s) => s.className),
      want: ["gone"],
    },
    {
      name: "許可リストの腐敗（ファイルが外れた）→ 検出する",
      got: compareWithAllowlist(collisions, [
        { class: "card", files: ["a.css", "b.css", "c.css"] },
      ]).stale.flatMap((s) => s.staleFiles),
      want: ["c.css"],
    },
    {
      name: "許可済みのクラスに新しいファイルが加わる → 検出する",
      got: compareWithAllowlist(
        [{ className: "card", files: ["a.css", "b.css", "c.css"] }],
        [{ class: "card", files: ["a.css", "b.css"] }],
      ).added.flatMap((a) => a.newFiles),
      want: ["c.css"],
    },
    {
      name: "許可リストどおり → 何も出さない",
      got: Object.values(
        compareWithAllowlist(collisions, [
          { class: "card", files: ["a.css", "b.css"] },
        ]),
      ).flat(),
      want: [],
    },
  ];

  const failures = [...cases, ...allowCases].filter(
    (c) => JSON.stringify(c.got) !== JSON.stringify(c.want),
  );
  for (const f of failures) {
    console.error(
      `NG(自己テスト): ${f.name}\n  期待: ${JSON.stringify(f.want)}\n  実際: ${JSON.stringify(f.got)}`,
    );
  }
  return { total: cases.length + allowCases.length, failed: failures.length };
}

// ---------------------------------------------------------------------------
// 内訳（--report）: 衝突ごとに、要素自体を装飾するルール同士の宣言を比べる
// ---------------------------------------------------------------------------

function classify(className, files, sources) {
  // 同じセレクタ・同じプロパティを、ファイルをまたいで比べる。
  // @media の中と外は同じ詳細度なので、条件が違っても重なる幅では順序依存になる。
  // そのため比較の単位は「セレクタ|プロパティ」、値は「条件=値」の集合にする
  const perFile = files.map((file) => {
    const values = new Map();
    const defs =
      collectUnscopedClasses(sources.get(file), file).get(className) ?? [];
    for (const d of defs) {
      const sel = d.selector.replace(/\s+/g, " ");
      for (const [prop, v] of d.decls) {
        const key = `${sel}|${prop}`;
        if (!values.has(key)) values.set(key, new Set());
        values.get(key).add(`${d.context}=${v}`);
      }
    }
    return values;
  });
  const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
  const allKeys = new Set(perFile.flatMap((m) => [...m.keys()]));
  const conflicts = [...allKeys].filter((k) => {
    const sets = perFile.filter((m) => m.has(k)).map((m) => m.get(k));
    return sets.some((set) => !same(set, sets[0]));
  });
  const identical =
    conflicts.length === 0 && perFile.every((m) => m.size === allKeys.size);
  const kind =
    conflicts.length > 0
      ? "conflict" // 同じセレクタ・同じプロパティに別の値 → バンドル順で勝ち負けが決まる
      : identical
        ? "identical" // 同じ宣言の重複。今は無害だが、片方だけ直すと conflict になる
        : "leak"; // 直接の食い違いは無いが、互いの宣言が相手のページの同名要素にも効く
  return {
    className,
    files,
    kind,
    conflicts: conflicts.map((k) => k.replace("|", " ")),
  };
}

// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  const { total, failed } = selfTests();
  if (failed > 0) {
    console.error(
      `\nNG: 自己テスト ${failed}/${total} 件が失敗しました。検出ロジックを直してください。`,
    );
    process.exit(1);
  }

  const sourceList = await loadSources();
  const collisions = findCollisions(sourceList);

  if (args.includes("--print-allowlist")) {
    const entries = collisions.map((c) => ({
      class: c.className,
      files: c.files,
    }));
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  if (args.includes("--report")) {
    const sources = new Map(sourceList.map((s) => [s.file, s.css]));
    const rows = collisions.map((c) => classify(c.className, c.files, sources));
    const order = { conflict: 0, leak: 1, identical: 2 };
    rows.sort(
      (a, b) =>
        order[a.kind] - order[b.kind] ||
        b.conflicts.length - a.conflicts.length ||
        a.className.localeCompare(b.className),
    );
    const count = (k) => rows.filter((r) => r.kind === k).length;
    console.log(
      `衝突 ${rows.length} 件（conflict ${count("conflict")} / leak ${count("leak")} / identical ${count("identical")}）\n`,
    );
    for (const r of rows) {
      console.log(
        `[${r.kind}] .${r.className}  ${r.files.join(" , ")}` +
          (r.conflicts.length
            ? `\n    食い違い: ${r.conflicts.join(" / ")}`
            : ""),
      );
    }
    return;
  }

  const allowEntries = await loadAllowlist();
  const { added, stale } = compareWithAllowlist(collisions, allowEntries);

  if (added.length === 0 && stale.length === 0) {
    console.log(
      `OK: CSS クラス名の衝突に新規なし（自己テスト ${total} 件成功、CSS ${sourceList.length} ファイル、既知の衝突 ${collisions.length} 件は許可リスト登録済み）`,
    );
    return;
  }

  if (added.length > 0) {
    console.error(
      `NG: 別の CSS ファイルと同じクラス名をスコープせずに定義しています（${added.length} 件）。\n`,
    );
    for (const a of added) {
      console.error(`  .${a.className}`);
      for (const f of a.files) {
        console.error(`    - ${f}${a.newFiles.includes(f) ? "  ← 新規" : ""}`);
      }
    }
    console.error(
      [
        "",
        "Vite は全ページの CSS を1つに結合するため、同じ詳細度の同名クラスはバンドル順で勝ち負けが決まり、",
        "別ページの見た目が壊れます（BOA-206・207・539）。次のどちらかで直してください:",
        "  1. ページ・部品に固有の名前にする（例: .venue-grid → .guide-venue-grid）",
        "  2. ページのルート要素のクラスでスコープする（例: .guide-page .venue-grid）。@media の中の上書きも同様に",
        "意図的に共有するクラスなら、共有用の CSS（src/index.css 等）1か所だけで定義してください。",
        "詳細: docs/reference/css-scoping.md",
      ].join("\n"),
    );
  }

  if (stale.length > 0) {
    console.error(
      `\nNG: 許可リストに解消済みのエントリがあります（${stale.length} 件）。${path.relative(ROOT, ALLOWLIST_PATH)} から消してください。\n`,
    );
    for (const s of stale) {
      console.error(
        s.resolved
          ? `  .${s.className}: 衝突が解消済み → エントリごと削除`
          : `  .${s.className}: 次のファイルはもう衝突していない → files から削除: ${s.staleFiles.join(", ")}`,
      );
    }
  }
  process.exit(1);
}

main().catch((e) => {
  console.error(`NG: ${e.message}`);
  process.exit(1);
});
