/**
 * 記事の中身だけの PR の関門（scripts/lib/contentPrGate.js）を表で検査する。
 * 各関門に通る例と落ちる例を最低1つずつ置く。加えて、今の public/blog の全 .md と
 * src/data/blog-posts の全 JSON に本文の関門（生 HTML・「競艇」・内部リンク）を当てても
 * errors が0であること、public/images/blog の全 JPEG から寸法が読めることを固定する。
 * 外部接続なし・実時刻に依存しない（tier ci）。
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateContentPr } from "../content/contentPrGateEval.js";
import {
  readJpegSize,
  checkRawHtml,
  checkKyoteiMd,
  checkKyoteiJson,
  checkInternalLinks,
  changedJsonStrings,
  findJudgementPhrases,
  changedMdParagraphs,
} from "../lib/contentPrGate.js";
import { parseRawDiff } from "../content/check-content-pr.js";
import {
  JPEG,
  ID,
  MD,
  JSON_JA,
  MANIFEST,
  baseMd,
  baseJson,
  config,
} from "./verifyData/content-pr-gate-fixtures.js";
import { makePr } from "./verifyData/content-pr-gate-make-pr.js";
import {
  CASES_A,
  withReview,
} from "./verifyData/content-pr-gate-cases-1.js";
import { CASES_B1 } from "./verifyData/content-pr-gate-cases-2.js";
import { CASES_B2 } from "./verifyData/content-pr-gate-cases-3.js";
import { CASES_B3 } from "./verifyData/content-pr-gate-cases-4.js";
import { CASES_B4 } from "./verifyData/content-pr-gate-cases-5.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");


// expect: "ok" | RegExp（errors のどれかに当たる）
const cases = [
  ...CASES_A,
  // ---- P2-1: 強調・空白・実体参照・ゼロ幅文字・段落内の改行ですり抜けない
  ...[
    ["強調 **必ず**当たる", "**必ず**当たる"],
    ["強調 必ず **当たる**", "必ず **当たる**"],
    ["全角空白", "必ず　当たる"],
    ["数値の実体参照", "&#24517;ず当たる"],
    ["16進の実体参照", "&#x5FC5;ず当たる"],
    ["名前付きの実体参照", "必ず&nbsp;当たる"],
    [
      "ゼロ幅文字",
      `必${String.fromCodePoint(0x200b)}ず当${String.fromCodePoint(0x2060)}たる`,
    ],
    ["段落内の改行", "必ず\n当たる"],
    ["打ち消し線とバッククォート", "~~必~~ず`当`たる"],
  ].map(([name, text]) => [
    `${name}でも「必ず当たる」は落ちる`,
    { md: `${baseMd}\n${text}\n` },
    /\[judgement\].*必ず当たる/,
  ]),
  ...CASES_B1,
  [
    "改稿で featured が base と同じなら通る",
    {
      json: { ...baseJson, featured: true, featuredRank: 5 },
      diff: [
        { status: "M", path: MD },
        { status: "M", path: JSON_JA },
      ],
      base: {
        [JSON_JA]: JSON.stringify({
          ...baseJson,
          featured: true,
          featuredRank: 5,
        }),
      },
      basePaths: [MD, JSON_JA, MANIFEST],
      manifestStatus: "M",
      manifest: (m) => ({ ...m, kind: "revision" }),
    },
    "ok",
  ],
  [
    "改稿で featuredRank を変えると落ちる",
    {
      json: { ...baseJson, featured: true, featuredRank: 1 },
      diff: [
        { status: "M", path: MD },
        { status: "M", path: JSON_JA },
      ],
      base: {
        [JSON_JA]: JSON.stringify({
          ...baseJson,
          featured: true,
          featuredRank: 5,
        }),
      },
      basePaths: [MD, JSON_JA, MANIFEST],
      manifestStatus: "M",
      manifest: (m) => ({ ...m, kind: "revision" }),
    },
    /\[featured\].*featuredRank を base から変えている/,
  ],
  ...CASES_B2,
  ...CASES_B3,
  ...CASES_B4,
];

const failures = [];
for (const [name, over, expect] of cases) {
  let result;
  try {
    result = evaluateContentPr(makePr(over));
  } catch (err) {
    failures.push(`${name}: 例外 ${err.message}`);
    continue;
  }
  const pass =
    expect === "ok"
      ? result.ok
      : !result.ok && result.errors.some((e) => expect.test(e));
  if (!pass)
    failures.push(`${name}: 期待 ${expect}、結果 ${JSON.stringify(result)}`);
}

// メタ情報の「競艇」の一覧（暫定の例外を後で一括で外すため。オーナー決定 10/20）
{
  const withMeta = evaluateContentPr(
    makePr({
      json: {
        ...baseJson,
        metaTitle: "競艇の記事",
        metaDescription: "競艇（ボートレース）の説明",
      },
    }),
  );
  if (!withMeta.ok)
    failures.push(
      `meta の「競艇」は通るはず: ${JSON.stringify(withMeta.errors)}`,
    );
  const entry = (withMeta.metaKyotei ?? []).find((m) => m.id === ID);
  if (
    !entry ||
    JSON.stringify([...entry.keys].sort()) !==
      JSON.stringify(["metaDescription", "metaTitle"])
  )
    failures.push(
      `metaKyotei に ${ID} の metaTitle・metaDescription が出るはず: ${JSON.stringify(withMeta.metaKyotei)}`,
    );
  if (withMeta.judgementWordsFound.includes("競艇"))
    failures.push("meta の「競艇」を判断が要る語に数えない");
  const without = evaluateContentPr(makePr());
  if ((without.metaKyotei ?? []).length !== 0)
    failures.push(
      `meta に「競艇」が無ければ metaKyotei は空: ${JSON.stringify(without.metaKyotei)}`,
    );
  const titleKyotei = evaluateContentPr(
    makePr({
      json: { ...baseJson, title: "競艇の記事", metaTitle: "競艇の記事" },
    }),
  );
  if (
    titleKyotei.ok ||
    !titleKyotei.errors.some((e) => /\[kyotei\].* title/.test(e))
  )
    failures.push("title の「競艇」は、meta にあっても落ちる");
}

// p1 の記録
{
  const r = evaluateContentPr(
    makePr({ manifest: withReview("seo-marketer", { p1: 3 }) }),
  );
  if (r.p1Recorded["seo-marketer"] !== 3 || r.p1Recorded.fan !== 0)
    failures.push(`p1Recorded が違う: ${JSON.stringify(r.p1Recorded)}`);
}

// 単体: readJpegSize
{
  const size = readJpegSize(JPEG);
  if (size?.width !== 200 || size?.height !== 100)
    failures.push(`readJpegSize が ${JSON.stringify(size)}`);
}

// 単体: CLI の差分（--raw -z）の読み取り（mode・ASCII 以外のパス）
{
  const out =
    ":000000 120000 0000000 abcdef0 A\0public/blog/記事.md\0" +
    ":100644 100644 1111111 2222222 M\0public/blog/x.md\0" +
    ":100644 000000 3333333 0000000 D\0public/images/blog/old.jpg\0";
  const want = [
    { status: "A", path: "public/blog/記事.md", mode: "120000" },
    { status: "M", path: "public/blog/x.md", mode: "100644" },
    { status: "D", path: "public/images/blog/old.jpg", mode: "000000" },
  ];
  const rows = parseRawDiff(out);
  if (JSON.stringify(rows) !== JSON.stringify(want))
    failures.push(`parseRawDiff が ${JSON.stringify(rows)}`);
  if (parseRawDiff("").length !== 0)
    failures.push("parseRawDiff('') が空でない");
}

// 今の記事の図の JSON は、リポジトリ（作業ツリー）にあるかで答える。
// 以前は checkRawHtml に実在の答えを渡さず（既定は常に「無い」）、図つきの記事を足した PR では、
// その記事が「今の記事」として検査され、図が同じ PR にあっても必ず落ちた（2026-10-21 #1747）
const chartExistsUnder = (root) => (repoPath) =>
  existsSync(join(root, repoPath));

// 再現テスト: 図つきの記事と、同じ PR で足した図の JSON の組
{
  const tmp = mkdtempSync(join(tmpdir(), "content-gate-chart-"));
  try {
    mkdirSync(join(tmp, "public/blog-charts"), { recursive: true });
    writeFileSync(
      join(tmp, "public/blog-charts/new-article-course-win.json"),
      "{}",
    );
    const md = [
      "# 新しい記事",
      "",
      "本文。",
      "",
      '<ryujin-chart src="/blog-charts/new-article-course-win.json" rows="6"></ryujin-chart>',
      "",
      "次の段落。",
      "",
    ].join("\n");
    const path = "public/blog/new-article.md";
    // 修正前の呼び方（実在の答えなし）では落ちる
    if (checkRawHtml(path, md).length === 0)
      failures.push(
        "再現テスト: 実在の答えなしで図の行が通った（再現できていない）",
      );
    // 修正後: 図の JSON がリポジトリにあれば通る
    const ok = checkRawHtml(path, md, chartExistsUnder(tmp));
    if (ok.length !== 0)
      failures.push(
        `再現テスト: 図の JSON があるのに落ちた: ${ok.join(" / ")}`,
      );
    // 図の JSON が無ければ、今までどおり落ちる
    const missing = checkRawHtml(
      path,
      md.replace("new-article-course-win", "missing-chart"),
      chartExistsUnder(tmp),
    );
    if (
      !missing.some((e) => e.includes("public/blog-charts/missing-chart.json"))
    )
      failures.push(
        `再現テスト: 無い図の JSON を通した: ${JSON.stringify(missing)}`,
      );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// 今の記事を壊さない: 全 .md・全 JSON を「変えたファイル」（status M）とみなして本文の関門を当てる
const blogDir = join(ROOT, "public/blog");
const mdFiles = readdirSync(blogDir).filter((f) => f.endsWith(".md"));
const masterErrors = [];
// 情報: 今の記事を「足したファイル」とみなして句の判定を当てたときの件数（落とさない。hq の見積もり用）
const phraseHits = [];
for (const f of mdFiles) {
  const path = `public/blog/${f}`;
  const text = readFileSync(join(blogDir, f), "utf8");
  phraseHits.push(
    ...findJudgementPhrases(
      changedMdParagraphs(text, undefined).map((p) => p.text),
      config,
    ).map((h) => ({
      path,
      ...h,
    })),
  );
  masterErrors.push(
    ...checkRawHtml(path, text, chartExistsUnder(ROOT)),
    ...checkKyoteiMd(path, text, config),
    ...checkInternalLinks(path, text, "M", config),
  );
}
const postsDir = join(ROOT, "src/data/blog-posts");
const jsonFiles = readdirSync(postsDir, { recursive: true }).filter((f) =>
  String(f).endsWith(".json"),
);
for (const f of jsonFiles) {
  const path = `src/data/blog-posts/${f}`;
  const obj = JSON.parse(readFileSync(join(postsDir, f), "utf8"));
  // メタ情報の「競艇」は通す（暫定の例外）。それ以外の値の「競艇」は error
  masterErrors.push(...checkKyoteiJson(path, obj, config).errors);
  const strings = changedJsonStrings(obj, undefined).map((s) => s.value);
  phraseHits.push(
    ...findJudgementPhrases(strings, config).map((h) => ({ path, ...h })),
  );
}
const imgDir = join(ROOT, "public/images/blog");
const jpgFiles = readdirSync(imgDir).filter((f) => /\.jpe?g$/i.test(f));
for (const f of jpgFiles) {
  if (!readJpegSize(readFileSync(join(imgDir, f))))
    masterErrors.push(`[image] public/images/blog/${f} の寸法が読めない`);
}
failures.push(...masterErrors.map((e) => `今の記事: ${e}`));

// 免除一覧が古くならないこと（内部リンクを足した記事は一覧から外す）
for (const p of config.internalLinkGrandfathered) {
  const text = readFileSync(join(ROOT, p), "utf8");
  if (checkInternalLinks(p, text, "A", config).length === 0)
    failures.push(
      `internalLinkGrandfathered の ${p} には内部リンクがある。一覧から外す`,
    );
}

if (failures.length > 0) {
  console.error(`NG: 記事の PR の関門の検査が ${failures.length} 件落ちた`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `OK: 記事の PR の関門 ${cases.length} 件の表、今の記事 .md ${mdFiles.length} 本・JSON ${jsonFiles.length} 本・JPEG ${jpgFiles.length} 枚で errors 0`,
);
// 情報（落とさない）: 今の記事を全部「足したファイル」とみなしたときの判断が要る句
const byHit = new Map();
for (const h of phraseHits) {
  const k = h.kind === "rate" ? "回収率100%以上・1倍以上" : h.hit;
  byHit.set(k, (byHit.get(k) ?? 0) + 1);
}
console.log(
  `情報: 今の記事を足したファイルとみなすと、判断が要る句は ${phraseHits.length} 件（${new Set(phraseHits.map((h) => h.path)).size} ファイル）。` +
    [...byHit.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}:${n}`)
      .join("、"),
);
