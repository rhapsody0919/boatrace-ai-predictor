/**
 * ブログの図の契約（docs/design/blog-charts/contract.md）の CI 検査。
 *
 * 1. 記事（public/blog/*.md、翻訳を含む）の <ryujin-chart> の書き方: 小文字・閉じタグ・1行・前後が空行・
 *    src は /blog-charts/{名前}.json で実在・rows は JSON の行の数と同じ
 * 2. JSON（public/blog-charts/*.json）: 契約の形（src/utils/blogChartContract.js）、id はファイル名・article は参照元の記事、
 *    記事が src/data/blog-posts にある、参照元が翻訳記事ならその言語の文字がそろう、答え（description）の割合が本文にもある、
 *    文字に「競艇」・廃止語（docs/reference/deprecated-terms.json）・risk-rules.json の語が無い、どの記事からも参照されない JSON が無い
 * 3. 契約の例（docs/design/blog-charts/example-venue-course-win.json）が契約を満たす
 * 4. 検査関数そのものの再現テスト（綴り違いのキー・件数と値の食い違い・二重の丸め・予約の種類 など）
 *
 * エラーは全件を `{ファイル}: {JSONのパス}: {期待} / 実際: {値}` で出す（作り手の LLM が1回で直せるように）。
 * 使い方: node scripts/maintenance/verify-blog-charts.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  validateBlogChart,
  localize,
} from "../../src/utils/blogChartContract.js";
import { checkRiskRules } from "../lib/riskRules.js";
import { parseBlogChartLine } from "../../src/utils/blogChartTag.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BLOG_DIR = path.join(ROOT, "public/blog");
const CHART_DIR = path.join(ROOT, "public/blog-charts");
const POSTS_DIR = path.join(ROOT, "src/data/blog-posts");
const EXAMPLE = path.join(
  ROOT,
  "docs/design/blog-charts/example-venue-course-win.json",
);

const LANG_SUFFIX = { "-en": "en", "-zh-tw": "zh-TW", "-ko": "ko" };
const deprecatedPatterns = JSON.parse(
  readFileSync(path.join(ROOT, "docs/reference/deprecated-terms.json"), "utf8"),
).terms.flatMap((t) => t.patterns.map((p) => ({ id: t.id, pattern: p })));

/** 記事のファイル名から記事 id と言語を出す（10000-races-analysis-en.md → 10000-races-analysis・en） */
function articleOf(file) {
  const base = file.replace(/\.md$/, "");
  for (const [suffix, lang] of Object.entries(LANG_SUFFIX)) {
    if (base.endsWith(suffix))
      return { id: base.slice(0, -suffix.length), lang };
  }
  return { id: base, lang: "ja" };
}

/** Markdown の中のタグを集める。コードブロックの中は数えない */
export function scanArticle(file, markdown) {
  const errors = [];
  const refs = [];
  const lines = markdown.split("\n");
  let inFence = false;
  let inFaq = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    // よくある質問の節（src/utils/blogFaqSchema.js が FAQPage の構造化データにする）
    if (!inFence && /^##\s/.test(line))
      inFaq = /^##\s*(よくある質問|FAQ|常見問題|자주 묻는 질문)\s*$/.test(line);
    if (inFence || !/ryujin-?chart/i.test(line)) return;
    // 4字下げのコードブロックと、インラインのコード（`<ryujin-chart>` と説明に書いたもの）は数えない
    if (/^( {4}|\t)/.test(line) || /`[^`]*ryujin-?chart[^`]*`/i.test(line))
      return;
    const at = `${file}:${i + 1}`;
    if (inFaq) {
      errors.push(
        `${file}:${i + 1}: よくある質問の節には図を置かない（構造化データの答えに生のタグが入る）`,
      );
      return;
    }
    // 形の正本は src/utils/blogChartTag.js（記事の PR の関門・描画の許可リストと同じ判定）
    const tag = parseBlogChartLine(line);
    if (!tag) {
      errors.push(
        `${at}: 1行で <ryujin-chart src="/blog-charts/{名前}.json" rows="{行の数}"></ryujin-chart>（小文字・閉じタグ・行頭から） / 実際: ${line.trim()}`,
      );
      return;
    }
    if (
      (lines[i - 1] ?? "").trim() !== "" ||
      (lines[i + 1] ?? "").trim() !== ""
    ) {
      errors.push(
        `${at}: タグの前後は空行にする（段落・リスト・表の中に置かない）`,
      );
    }
    refs.push({
      name: tag.src.replace(/^\/blog-charts\//, "").replace(/\.json$/, ""),
      rows: tag.rows,
      at,
    });
  });
  return { errors, refs };
}

/** 文字の項目を全部集める（禁止語の検査用） */
function texts(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => texts(v, out));
  else if (value && typeof value === "object")
    Object.values(value).forEach((v) => texts(v, out));
  return out;
}

/** JSON 1本を、参照元の記事と突き合わせて検査する */
export function checkChart(name, chart, referrers, { postExists, markdownOf }) {
  const file = `public/blog-charts/${name}.json`;
  const errors = validateBlogChart(chart, {
    langs: [...new Set(referrers.map((r) => r.lang))],
  }).map((e) => `${file}: ${e.path || "(全体)"}: ${e.message}`);
  if (chart?.id !== name)
    errors.push(
      `${file}: id: ファイル名と同じ "${name}" / 実際: ${JSON.stringify(chart?.id)}`,
    );
  const ids = [...new Set(referrers.map((r) => r.article))];
  if (ids.length > 0 && !ids.includes(chart?.article)) {
    errors.push(
      `${file}: article: 参照元の記事 ${ids.join("・")} / 実際: ${JSON.stringify(chart?.article)}`,
    );
  }
  if (typeof chart?.article === "string" && !postExists(chart.article)) {
    errors.push(
      `${file}: article: src/data/blog-posts/${chart.article}.json が無い`,
    );
  }
  const rowCount = Array.isArray(chart?.rows) ? chart.rows.length : null;
  for (const r of referrers) {
    if (rowCount !== null && r.rows !== rowCount)
      errors.push(
        `${r.at}: rows="${rowCount}"（JSON の rows の数） / 実際: rows="${r.rows}"`,
      );
    // 答えの割合は本文にも書く（検索・AI の根拠は本文）
    const md = markdownOf(r.file);
    for (const m of localize(chart?.description, r.lang).matchAll(
      /(\d+(?:\.\d+)?)%/g,
    )) {
      if (!md.includes(`${m[1]}%`))
        errors.push(
          `${r.at}: description の「${m[1]}%」が記事の本文に無い（本文の1行と表にも書く）`,
        );
    }
  }
  for (const t of texts(chart)) {
    for (const v of checkRiskRules(t, "blog"))
      errors.push(
        `${file}: 書かない言い方「${v.matchedPattern}」（${v.id}）: ${t}`,
      );
    for (const d of deprecatedPatterns)
      if (t.includes(d.pattern))
        errors.push(`${file}: 廃止語「${d.pattern}」（${d.id}）: ${t}`);
  }
  return errors;
}

/** リポジトリの記事と JSON を全部検査する */
function checkRepository() {
  const errors = [];
  const referrers = new Map();
  for (const file of readdirSync(BLOG_DIR).filter((f) => f.endsWith(".md"))) {
    const { errors: tagErrors, refs } = scanArticle(
      `public/blog/${file}`,
      readFileSync(path.join(BLOG_DIR, file), "utf8"),
    );
    errors.push(...tagErrors);
    const { id, lang } = articleOf(file);
    for (const ref of refs) {
      if (!referrers.has(ref.name)) referrers.set(ref.name, []);
      referrers.get(ref.name).push({ ...ref, file, article: id, lang });
    }
  }
  const files = existsSync(CHART_DIR)
    ? readdirSync(CHART_DIR).filter((f) => f.endsWith(".json"))
    : [];
  const deps = {
    postExists: (id) => existsSync(path.join(POSTS_DIR, `${id}.json`)),
    markdownOf: (file) => readFileSync(path.join(BLOG_DIR, file), "utf8"),
  };
  for (const [name, refs] of referrers) {
    if (!files.includes(`${name}.json`))
      errors.push(`${refs[0].at}: public/blog-charts/${name}.json が無い`);
  }
  for (const f of files) {
    const name = f.replace(/\.json$/, "");
    const refs = referrers.get(name) ?? [];
    if (refs.length === 0)
      errors.push(`public/blog-charts/${f}: どの記事からも参照されていない`);
    let chart;
    try {
      chart = JSON.parse(readFileSync(path.join(CHART_DIR, f), "utf8"));
    } catch (e) {
      errors.push(`public/blog-charts/${f}: JSON として読めない: ${e.message}`);
      continue;
    }
    errors.push(...checkChart(name, chart, refs, deps));
  }
  return errors;
}

const example = () => JSON.parse(readFileSync(EXAMPLE, "utf8"));
const messages = (chart, opts) =>
  validateBlogChart(chart, opts).map((e) => `${e.path}: ${e.message}`);

test("リポジトリの記事と図の JSON が契約を満たす", () => {
  const errors = checkRepository();
  assert.deepEqual(errors, [], `\n${errors.join("\n")}`);
});

test("契約の例は契約を満たす", () => {
  assert.deepEqual(messages(example()), []);
});

test("綴り違いのキーは誤り（黙って無視すると counts の照合が抜ける）", () => {
  const c = example();
  c.views[0].series[0].count = c.views[0].series[0].counts;
  delete c.views[0].series[0].counts;
  const m = messages(c);
  assert.ok(
    m.some((x) => x.startsWith("views[0].series[0].count: 契約に無いキー")),
    m.join("\n"),
  );
  assert.ok(
    m.some((x) =>
      x.startsWith("views[0].series[0].counts: 単位が % のときは counts"),
    ),
    m.join("\n"),
  );
});

test("件数と値の食い違い・二重の丸めを落とす（福岡の1コース 1400/2363 は 59.2、0.5925 経由の 59.3 は誤り）", () => {
  const c = example();
  const fukuoka = c.views.find((v) => v.key === "22");
  fukuoka.series[0].values[0] = 59.3;
  assert.ok(
    messages(c).some((x) =>
      x.includes("counts 1400/2363 から 59.2 / 実際: 59.3"),
    ),
  );
});

test("行の順の取り違え（値だけ並べ替え）を落とす", () => {
  const c = example();
  c.views[0].series[0].values.reverse();
  assert.ok(messages(c).length >= 6);
});

test("予約の種類・切り替え2つ・既定の不一致・数の key を落とす", () => {
  assert.ok(
    messages({ ...example(), kind: "line" }).some((x) => x.includes("未実装")),
  );
  assert.ok(
    messages({ ...example(), kind: "pie" }).some((x) => x.startsWith("kind:")),
  );
  assert.ok(
    messages({ ...example(), switch2: { label: "期間" } }).some((x) =>
      x.startsWith("switch2: 契約に無いキー"),
    ),
  );
  assert.ok(
    messages({ ...example(), switch: { label: "会場", default: 22 } }).some(
      (x) => x.startsWith("switch.default"),
    ),
  );
  const noSwitch = { ...example(), switch: undefined };
  delete noSwitch.switch;
  assert.ok(
    messages(noSwitch).some((x) => x.startsWith("switch: キーは省かない")),
  );
});

test("答えの数字は図の中の値だけ（会場どうしの比べは通す）", () => {
  const c = example();
  c.description = "福岡は1コースの1着率が61.7%。";
  assert.ok(
    messages(c).some((x) => x.startsWith("description: 数字は views のどれか")),
  );
  c.description = "1コースの1着率は、戸田が42.6%、福岡が59.2%、徳山が61.6%。";
  // 切り替えのある図は既定の view（福岡）の答えも同じ文にする
  c.views.find((v) => v.key === "22").description = c.description;
  assert.deepEqual(messages(c), []);
});

test("期間の終わりは集計日より後にできない", () => {
  const c = example();
  c.views[0].badge.period.to = "2026-12-31";
  assert.ok(
    messages(c).some((x) => x.includes("badge.period.to: source.dataVersion")),
  );
});

test("翻訳記事から参照される JSON はその言語の文字がそろう", () => {
  const m = messages(example(), { langs: ["ja", "en"] });
  assert.ok(m.some((x) => x.startsWith("title: en の記事から参照される")));
});

test("「競艇」は図の文字に書けない", () => {
  assert.ok(
    messages({ ...example(), title: "競艇の進入コース別の1着率" }).some((x) =>
      x.includes("「競艇」"),
    ),
  );
});

test("分母0・無い日付・横棒の単位が % 以外を落とす", () => {
  const c = example();
  c.views[1].series[0].totals = [0, 0, 0, 0, 0, 0];
  c.views[1].series[0].counts = [0, 0, 0, 0, 0, 0];
  assert.ok(messages(c).some((x) => x.includes("totals[0]: 分母は1以上")));
  const d = example();
  d.source.dataVersion = "2026-02-30";
  assert.ok(
    messages(d).some((x) => x.startsWith("source.dataVersion: YYYY-MM-DD")),
  );
  const u = example();
  u.axes.value.unit = "レース";
  assert.ok(
    messages(u).some((x) => x.startsWith('axes.value.unit: hbar は "%" だけ')),
  );
});

test("字数の上限: 答え90字・注記70字・行のラベル8字", () => {
  assert.ok(
    messages({ ...example(), description: "あ".repeat(91) }).some((x) =>
      x.startsWith("description: 1〜90字"),
    ),
  );
  assert.ok(
    messages({ ...example(), note: "あ".repeat(71) }).some((x) =>
      x.startsWith("note: 1〜70字"),
    ),
  );
  const c = example();
  c.rows[0].label = "あ".repeat(9);
  assert.ok(messages(c).some((x) => x.startsWith("rows[0].label: 1〜8字")));
});

test("記事のタグの書き方: 大文字・自己終了・段落の中・外の src を落とし、正しい1行を拾う", () => {
  const ok =
    'a\n\n<ryujin-chart src="/blog-charts/x-y.json" rows="6"></ryujin-chart>\n\nb';
  assert.deepEqual(scanArticle("t.md", ok).errors, []);
  assert.deepEqual(
    scanArticle("t.md", ok).refs.map((r) => [r.name, r.rows]),
    [["x-y", 6]],
  );
  const bad = [
    '<RyujinChart src="/blog-charts/x.json" rows="6"></RyujinChart>',
    '<ryujin-chart src="/blog-charts/x.json" rows="6" />',
    'a\n<ryujin-chart src="/blog-charts/x.json" rows="6"></ryujin-chart>',
    '<ryujin-chart src="https://example.com/x.json" rows="6"></ryujin-chart>',
    '<ryujin-chart src="/blog/x.json" rows="6"></ryujin-chart>',
  ];
  for (const md of bad)
    assert.ok(scanArticle("t.md", md).errors.length > 0, md);
  assert.deepEqual(scanArticle("t.md", "```\n<ryujin-chart>\n```").errors, []);
  assert.deepEqual(
    scanArticle("t.md", "説明: `<ryujin-chart src=…>` と書く").errors,
    [],
  );
  assert.deepEqual(scanArticle("t.md", "    <ryujin-chart>").errors, []);
});

test("よくある質問の節の図・全角の ％ の写し間違い・言語ごとの値の型を落とす", () => {
  const md =
    '## よくある質問\n\n### 問い\n\n<ryujin-chart src="/blog-charts/x.json" rows="6"></ryujin-chart>\n';
  assert.ok(
    scanArticle("t.md", md).errors.some((e) =>
      e.includes("よくある質問の節には図を置かない"),
    ),
  );
  assert.ok(
    messages({ ...example(), description: "福岡は６１．７％。" }).some((x) =>
      x.startsWith("description: 数字は views"),
    ),
  );
  assert.ok(
    messages({ ...example(), title: { ja: "題", en: {} } }).some((x) =>
      x.startsWith("title.en: 文字列"),
    ),
  );
});

test("切り替えのある図は、全 view に答えの文（description）が要る。切り替えの無い図は要らない", () => {
  const c = example();
  delete c.views[3].description;
  assert.ok(
    messages(c).some((x) =>
      x.startsWith(
        "views[3].description: 切り替え（switch）のある図は、全 view に答えの1文が要る",
      ),
    ),
    messages(c).join("\n"),
  );
  const single = { ...example(), switch: null, views: [example().views[0]] };
  delete single.views[0].description;
  single.description =
    "全国の1コースの1着率は55.5%（55,414レース中30,732回）。";
  assert.deepEqual(messages(single), []);
  // 最上位の答えは既定の view の答えと同じ（片方だけ直すと画面と本文がずれる）
  const drift = example();
  drift.views.find((v) => v.key === "22").description =
    "福岡は1コースの1着率が59.2%（2,363レース中1,400回）。";
  assert.ok(
    messages(drift).some((x) =>
      x.startsWith(
        "description: 既定の view（22）の description と同じ文にする",
      ),
    ),
  );
});

test("答えの文の「N レース中 M 回」は、その view か全国の母数と件数の組だけ", () => {
  const c = example();
  const toda = c.views.find((v) => v.key === "02");
  toda.description = toda.description.replace(
    "2,256レース中960回",
    "2,265レース中690回",
  );
  const i = c.views.indexOf(toda);
  assert.ok(
    messages(c).some((x) =>
      x.startsWith(`views[${i}].description: 「2,265…中690回」`),
    ),
    messages(c).join("\n"),
  );
});

test("参照と JSON の突き合わせ: rows・article・本文に無い答えの数字・書かない言い方", () => {
  const c = example();
  const deps = {
    postExists: () => true,
    markdownOf: () => "福岡の1コースは59.2%。",
  };
  const refs = [
    {
      name: c.id,
      rows: 5,
      at: "public/blog/example.md:3",
      file: "example.md",
      article: "example",
      lang: "ja",
    },
  ];
  const errs = checkChart(c.id, { ...c, note: "必ず当たる" }, refs, deps);
  assert.ok(
    errs.some((e) => e.includes('rows="6"')),
    errs.join("\n"),
  );
  assert.ok(
    errs.some((e) => e.includes("「55.5%」が記事の本文に無い")),
    errs.join("\n"),
  );
  assert.ok(
    errs.some((e) => e.includes("書かない言い方「必ず当た」")),
    errs.join("\n"),
  );
  assert.ok(
    checkChart(c.id, { ...c, article: "other" }, refs, deps).some((e) =>
      e.includes("article: 参照元の記事 example"),
    ),
  );
});
