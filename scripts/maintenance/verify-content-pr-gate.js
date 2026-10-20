/**
 * 記事の中身だけの PR の関門（scripts/lib/contentPrGate.js）を表で検査する。
 * 各関門に通る例と落ちる例を最低1つずつ置く。加えて、今の public/blog の全 .md と
 * src/data/blog-posts の全 JSON に本文の関門（生 HTML・「競艇」・内部リンク）を当てても
 * errors が0であること、public/images/blog の全 JPEG から寸法が読めることを固定する。
 * 外部接続なし・実時刻に依存しない（tier ci）。
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateContentPr,
  computeContentSha256,
  sha256Hex,
  readJpegSize,
  checkRawHtml,
  checkKyoteiMd,
  checkKyoteiJson,
  checkInternalLinks,
} from "../lib/contentPrGate.js";
import { parseRawDiff } from "../content/check-content-pr.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const config = JSON.parse(
  readFileSync(join(ROOT, "scripts/content/content-pr-gate.json"), "utf8"),
);

// 幅200・高さ100 の最小の JPEG ヘッダー（APP0 → SOF0）
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08,
  0x00, 0x64, 0x00, 0xc8, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11,
  0x01,
]);
const enc = (s) => new TextEncoder().encode(s);

const ID = "sample-guide";
const MD = `public/blog/${ID}.md`;
const MD_EN = `public/blog/${ID}-en.md`;
const JSON_JA = `src/data/blog-posts/${ID}.json`;
const IMG = "public/images/blog/sample-guide-ja.jpg";
const MANIFEST = `docs/content-manifests/${ID}.json`;

const baseMd = `# サンプル\n\n本文。[会場ガイド](/venues) を見る。\n\n![図](/images/blog/sample-guide-ja.jpg)\n`;
const baseMdEn = `# Sample\n\nSee [venues](/en/venues).\n`;
const baseJson = {
  id: ID,
  title: "サンプルの記事",
  description: "説明",
  date: "2026-10-20",
  featured: false,
  image: "/images/blog/sample-guide-ja.jpg",
};

/** 正しい新規記事の PR。over で中身・差分・manifest を差し替える */
function makePr(over = {}) {
  const files = {
    [MD]: over.md ?? baseMd,
    [MD_EN]: over.mdEn ?? baseMdEn,
    [JSON_JA]: JSON.stringify(over.json ?? baseJson, null, 2),
  };
  const head = {
    ...Object.fromEntries(Object.entries(files).map(([k, v]) => [k, enc(v)])),
    [IMG]: over.img ?? JPEG,
    ...Object.fromEntries(
      Object.entries(over.extraFiles ?? {}).map(([k, v]) => [k, enc(v)]),
    ),
  };
  const diff = [
    ...(over.diff ?? [
      { status: "A", path: MD },
      { status: "A", path: MD_EN },
      { status: "A", path: JSON_JA },
      { status: "A", path: IMG },
    ]),
    ...Object.keys(over.extraFiles ?? {}).map((path) => ({
      status: "A",
      path,
    })),
  ].map((d) => ({ mode: "100644", ...d }));
  const live = diff.filter((d) => d.status !== "D").map((d) => d.path);
  const fileShas = Object.fromEntries(
    live.filter((p) => head[p]).map((p) => [p, sha256Hex(head[p])]),
  );
  const contentSha = computeContentSha256(fileShas);
  const review = (role, agent, extra = {}) => ({
    role,
    agent,
    result: "pass",
    p0: 0,
    p1: 0,
    reviewed_sha256: contentSha,
    model: "claude-opus-5-5",
    at: "2026-10-20T01:00:00Z",
    ...extra,
  });
  const manifest = {
    schema: "content-pr-manifest/v1",
    id: ID,
    kind: "new",
    ticket: "BOA-999",
    paths: diff.map((d) => d.path),
    files: fileShas,
    content_sha256: contentSha,
    content_at: "2026-10-20T00:00:00Z",
    judgement_words: [],
    reviews: [
      review("content-qa", "content-qa"),
      review("wording-editor", "wording-editor"),
      review("fan", "boatrace-fan-reviewer"),
      review("seo-marketer", "seo-marketer"),
    ],
    author: { model: "claude-opus-5-5", lane: "hq-writer" },
    created_at: "2026-10-20T02:00:00Z",
  };
  const finalManifest = over.manifest ? over.manifest(manifest) : manifest;
  head[MANIFEST] = enc(
    over.rawManifest !== undefined
      ? over.rawManifest
      : JSON.stringify(finalManifest),
  );
  const basePaths = over.basePaths ?? [
    "public/blog/existing.md",
    "src/data/blog-posts/existing.json",
  ];
  const fullDiff = [
    ...diff,
    { status: over.manifestStatus ?? "A", path: MANIFEST, mode: "100644" },
    ...(over.extraDiff ?? []).map((d) => ({ mode: "100644", ...d })),
  ];
  return {
    diff: fullDiff,
    head: over.head ? over.head(head) : head,
    base: over.base ?? {},
    basePaths,
    headPaths: over.headPaths ?? [
      ...new Set([
        ...basePaths,
        ...fullDiff.filter((d) => d.status !== "D").map((d) => d.path),
      ]),
    ],
    config: over.config ?? config,
  };
}

const CHART =
  '<ryujin-chart src="/blog-charts/sample-chart.json" rows="3"></ryujin-chart>';
const CHART_BASE = [
  "public/blog/existing.md",
  "src/data/blog-posts/existing.json",
  "public/blog-charts/sample-chart.json",
];

const withReview = (role, extra) => (m) => ({
  ...m,
  reviews: m.reviews.map((r) => (r.role === role ? { ...r, ...extra } : r)),
});

// expect: "ok" | RegExp（errors のどれかに当たる）
const cases = [
  ["正しい新規記事は通る", {}, "ok"],
  // 許可のパス
  [
    "許可外のパスは落ちる",
    { extraDiff: [{ status: "M", path: "src/App.jsx" }] },
    /\[path\] src\/App\.jsx/,
  ],
  [
    "PNG は落ちる",
    { extraDiff: [{ status: "A", path: "public/images/blog/x.png" }] },
    /\[path\] public\/images\/blog\/x\.png/,
  ],
  [
    "翻訳 JSON の置き場所は通る（master に無くても）",
    {
      extraFiles: {
        [`src/data/blog-posts/en/${ID}.json`]: JSON.stringify({
          id: ID,
          title: "Sample",
          description: "d",
        }),
      },
    },
    "ok",
  ],
  // 生の HTML
  ["本文の HTML タグは落ちる", { md: `${baseMd}\n<div>x</div>\n` }, /\[html\]/],
  [
    "コードブロックとインラインコードの中の < は数えない",
    { md: `${baseMd}\n\`<b>\`\n\n\`\`\`\n<div>\n\`\`\`\n1号艇 <5 回\n` },
    "ok",
  ],
  // 「競艇」
  [
    "本文の「競艇」は落ちる",
    { md: `${baseMd}\n競艇の話\n` },
    /\[kyotei\] public\/blog\/sample-guide\.md:/,
  ],
  [
    "JSON の title の「競艇」は落ちる",
    { json: { ...baseJson, title: "競艇の記事" } },
    /\[kyotei\] .* title/,
  ],
  [
    "JSON の metaTitle の「競艇」は本文の関門は通るが、判断が要る語として落ちる",
    { json: { ...baseJson, metaTitle: "競艇の記事" } },
    /\[judgement\].*競艇/,
  ],
  // 判断が要る語
  [
    "判断が要る語があれば落ちる（PR を作らずオーナーへ回す）",
    { md: `${baseMd}\n的中率の話\n` },
    /\[judgement\].*的中率/,
  ],
  [
    "判断が要る語を申告していても落ちる",
    {
      md: `${baseMd}\n的中率の話\n`,
      manifest: (m) => ({ ...m, judgement_words: ["的中率"] }),
    },
    /\[judgement\].*judgement_words が空でない/,
  ],
  [
    "語が無くても judgement_words が空でなければ落ちる",
    { manifest: (m) => ({ ...m, judgement_words: ["保証"] }) },
    /\[judgement\].*judgement_words が空でない/,
  ],
  // slug
  [
    "id がファイル名と違うと落ちる",
    { json: { ...baseJson, id: "other" } },
    /\[slug\].*ファイル名/,
  ],
  [
    "id の形が違うと落ちる（大文字）",
    { json: { ...baseJson, id: "Sample-guide" } },
    /\[slug\].*形でない/,
  ],
  ["base の .md と衝突すると落ちる", { basePaths: [MD] }, /\[slug\].*衝突/],
  // 画像
  [
    "参照する画像が HEAD に無いと落ちる",
    { md: `${baseMd}\n![x](/images/blog/missing.jpg)\n` },
    /\[image\].*missing\.jpg.*HEAD に無い/,
  ],
  [
    "JPEG のヘッダーが読めないと落ちる",
    { img: enc("not a jpeg") },
    /\[image\].*幅と高さ/,
  ],
  [
    "足した画像をどこも参照しないと落ちる",
    {
      md: baseMd.replace("![図](/images/blog/sample-guide-ja.jpg)", ""),
      json: { ...baseJson, image: "/images/blog/existing.jpg" },
      head: (h) => ({ ...h, "public/images/blog/existing.jpg": JPEG }),
    },
    /\[image\].*参照していない/,
  ],
  // featured
  [
    "新規で featured=true は落ちる",
    { json: { ...baseJson, featured: true } },
    /\[featured\].*featured=false/,
  ],
  [
    "新規で featuredRank があると落ちる",
    { json: { ...baseJson, featuredRank: 3 } },
    /\[featured\].*featuredRank/,
  ],
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
  // 内部リンク
  [
    "翻訳 .md に内部リンクが無いと落ちる",
    { mdEn: "# Sample\n\nNo link.\n" },
    /\[link\].*sample-guide-en\.md/,
  ],
  // manifest
  [
    "manifest が無いと落ちる",
    { head: (h) => h, extraDiff: [], manifestStatus: "D" },
    /\[manifest\].*ちょうど1つ/,
  ],
  [
    "schema が違うと落ちる",
    { manifest: (m) => ({ ...m, schema: "v0" }) },
    /\[manifest\] schema/,
  ],
  [
    "manifest の id がファイル名と違うと落ちる",
    { manifest: (m) => ({ ...m, id: "x" }) },
    /\[manifest\] id/,
  ],
  [
    "kind が違うと落ちる",
    { manifest: (m) => ({ ...m, kind: "draft" }) },
    /\[manifest\] kind/,
  ],
  [
    "ticket が空だと落ちる",
    { manifest: (m) => ({ ...m, ticket: " " }) },
    /\[manifest\] ticket/,
  ],
  [
    "paths に差分のパスが無いと落ちる",
    { manifest: (m) => ({ ...m, paths: m.paths.slice(1) }) },
    /\[manifest\] paths に差分の/,
  ],
  [
    "paths に余計なパスがあると落ちる",
    { manifest: (m) => ({ ...m, paths: [...m.paths, "public/blog/x.md"] }) },
    /\[manifest\] paths の public\/blog\/x\.md が差分に無い/,
  ],
  [
    "削除は落ちる（記事の PR では削除を許さない）",
    {
      extraDiff: [{ status: "D", path: "public/images/blog/old.jpg" }],
      manifest: (m) => ({
        ...m,
        paths: [...m.paths, "-public/images/blog/old.jpg"],
      }),
    },
    /\[delete\] public\/images\/blog\/old\.jpg/,
  ],
  [
    "manifest.paths に「-」があると落ちる",
    {
      manifest: (m) => ({
        ...m,
        paths: [...m.paths, "-public/images/blog/old.jpg"],
      }),
    },
    /\[delete\].*manifest\.paths/,
  ],
  [
    "files の sha256 が中身と違うと落ちる",
    {
      manifest: (m) => ({ ...m, files: { ...m.files, [MD]: "0".repeat(64) } }),
    },
    /\[manifest\] files の public\/blog\/sample-guide\.md の sha256/,
  ],
  [
    "content_sha256 が違うと落ちる",
    { manifest: (m) => ({ ...m, content_sha256: "0".repeat(64) }) },
    /\[manifest\] content_sha256/,
  ],
  [
    "author.lane が空だと落ちる",
    { manifest: (m) => ({ ...m, author: { model: "x", lane: "" } }) },
    /author\.lane/,
  ],
  // reviews
  [
    "役が欠けると落ちる",
    { manifest: (m) => ({ ...m, reviews: m.reviews.slice(1) }) },
    /role content-qa が 0 行/,
  ],
  [
    "役が2行あると落ちる",
    { manifest: (m) => ({ ...m, reviews: [...m.reviews, m.reviews[0]] }) },
    /role content-qa が 2 行/,
  ],
  [
    "許されない agent は落ちる",
    { manifest: withReview("fan", { agent: "general-purpose" }) },
    /agent "general-purpose" は許されていない/,
  ],
  [
    "fan に discussion-panel は通る",
    { manifest: withReview("fan", { agent: "discussion-panel" }) },
    "ok",
  ],
  [
    "設定に足した agent は通る",
    {
      manifest: withReview("seo-marketer", { agent: "hq-review:seo" }),
      config: {
        ...config,
        allowedReviewAgents: {
          ...config.allowedReviewAgents,
          "seo-marketer": ["seo-marketer", "hq-review:seo"],
        },
      },
    },
    "ok",
  ],
  [
    "reviewed_sha256 がずれると落ちる",
    {
      manifest: withReview("wording-editor", {
        reviewed_sha256: "f".repeat(64),
      }),
    },
    /reviewed_sha256/,
  ],
  [
    "P0 があると落ちる（fan）",
    { manifest: withReview("fan", { p0: 1 }) },
    /p0 が 1 件/,
  ],
  [
    "content-qa の P1 は落ちる",
    { manifest: withReview("content-qa", { p1: 2 }) },
    /content-qa）\s*の p1 が 2 件/,
  ],
  [
    "seo-marketer の P1 は記録だけで通る",
    { manifest: withReview("seo-marketer", { p1: 3 }) },
    "ok",
  ],
  [
    "result が pass でないと落ちる",
    { manifest: withReview("content-qa", { result: "fail" }) },
    /result が pass でない/,
  ],
  [
    "at が content_at より前だと落ちる",
    { manifest: withReview("fan", { at: "2026-10-19T00:00:00Z" }) },
    /content_at より前/,
  ],
  [
    "at が created_at より後だと落ちる",
    { manifest: withReview("fan", { at: "2026-10-21T00:00:00Z" }) },
    /created_at より後/,
  ],
  [
    "review の model が空だと落ちる",
    { manifest: withReview("fan", { model: "" }) },
    /model が空/,
  ],
  // ---- 指摘 P0-1: manifest が JSON の非オブジェクト
  ...["null", "1", '"s"', "true", "[]"].map((raw) => [
    `manifest が ${raw} だと落ちる`,
    { rawManifest: raw },
    /\[manifest\].*オブジェクトでない/,
  ]),
  // ---- 指摘 P1-1: ファイルの型（mode）と status T
  [
    "symlink（120000）は落ちる",
    {
      diff: [
        { status: "A", path: MD, mode: "120000" },
        { status: "A", path: MD_EN },
        { status: "A", path: JSON_JA },
        { status: "A", path: IMG },
      ],
    },
    /\[mode\] public\/blog\/sample-guide\.md.*120000/,
  ],
  [
    "実行ビット（100755）は落ちる",
    {
      diff: [
        { status: "A", path: MD },
        { status: "A", path: MD_EN },
        { status: "A", path: JSON_JA },
        { status: "A", path: IMG, mode: "100755" },
      ],
    },
    /\[mode\].*100755/,
  ],
  [
    "gitlink（160000）は落ちる",
    {
      extraDiff: [{ status: "A", path: "public/blog/sub.md", mode: "160000" }],
      manifest: (m) => ({ ...m, paths: [...m.paths, "public/blog/sub.md"] }),
    },
    /\[mode\].*160000/,
  ],
  [
    "status T（種類の変更）は落ちる",
    {
      diff: [
        { status: "T", path: MD },
        { status: "A", path: MD_EN },
        { status: "A", path: JSON_JA },
        { status: "A", path: IMG },
      ],
    },
    /\[path\].*状態 T/,
  ],
  [
    "mode が無い行は落ちる",
    {
      diff: [
        { status: "A", path: MD, mode: undefined },
        { status: "A", path: MD_EN },
        { status: "A", path: JSON_JA },
        { status: "A", path: IMG },
      ],
    },
    /\[mode\] public\/blog\/sample-guide\.md/,
  ],
  // ---- 指摘 P1-2: 生 HTML の抜け道（Markdown のパーサーで判定）
  [
    "タブ＋```（実はインデントのコード）の後の HTML は落ちる",
    { md: `${baseMd}\n\t\`\`\`\n\n<div>x</div>\n` },
    /\[html\]/,
  ],
  [
    "エスケープしたバッククォートの間の HTML は落ちる",
    { md: `${baseMd}\n本文 \\\`<b>x</b>\\\` です\n` },
    /\[html\]/,
  ],
  [
    "情報文字列に ` を含むフェンス（フェンスにならない）の後の HTML は落ちる",
    { md: `${baseMd}\n\`\`\`a\`b\n<div>x</div>\n\`\`\`\n` },
    /\[html\]/,
  ],
  ["HTML コメントは落ちる", { md: `${baseMd}\n<!-- x -->\n` }, /\[html\]/],
  [
    "自動リンク <https://…> は html ではない",
    { md: `${baseMd}\n<https://www.boatrace.jp/>\n` },
    "ok",
  ],
  [
    "インデントのコードの中の HTML は数えない",
    { md: `${baseMd}\n    <div>x</div>\n` },
    "ok",
  ],
  // ---- 図のタグ（src/utils/blogChartTag.js の形だけ、前後が空行、JSON が実在）
  [
    "正しい図の行は通る（JSON が base にある）",
    { md: `${baseMd}\n${CHART}\n`, basePaths: CHART_BASE },
    "ok",
  ],
  [
    "属性が rows → src の順は落ちる（src → rows だけ）",
    {
      md: `${baseMd}\n<ryujin-chart rows="12" src="/blog-charts/sample-chart.json"></ryujin-chart>\n`,
      basePaths: CHART_BASE,
    },
    /\[html\]/,
  ],
  [
    "図の JSON が HEAD にあれば通る（headPaths）",
    {
      md: `${baseMd}\n${CHART}\n`,
      headPaths: [
        MD,
        MD_EN,
        JSON_JA,
        IMG,
        MANIFEST,
        "public/blog-charts/sample-chart.json",
      ],
    },
    "ok",
  ],
  [
    "図の行の前が空行でないと落ちる",
    { md: `${baseMd}本文\n${CHART}\n`, basePaths: CHART_BASE },
    /\[html\].*図のタグ/,
  ],
  [
    "図の行の後が空行でないと落ちる",
    { md: `${baseMd}\n${CHART}\n本文\n`, basePaths: CHART_BASE },
    /\[html\]/,
  ],
  [
    "図の属性が多い（onload）と落ちる",
    {
      md: `${baseMd}\n<ryujin-chart src="/blog-charts/sample-chart.json" rows="3" onload="x"></ryujin-chart>\n`,
      basePaths: CHART_BASE,
    },
    /\[html\]/,
  ],
  [
    "図を /> で閉じると落ちる",
    {
      md: `${baseMd}\n<ryujin-chart src="/blog-charts/sample-chart.json" rows="3" />\n`,
      basePaths: CHART_BASE,
    },
    /\[html\]/,
  ],
  [
    "図の src が /blog-charts/ の外だと落ちる",
    {
      md: `${baseMd}\n<ryujin-chart src="/data/sample-chart.json" rows="3"></ryujin-chart>\n`,
      basePaths: [...CHART_BASE, "public/data/sample-chart.json"],
    },
    /\[html\]/,
  ],
  [
    "図の src に .. があると落ちる",
    {
      md: `${baseMd}\n<ryujin-chart src="/blog-charts/../x.json" rows="3"></ryujin-chart>\n`,
      basePaths: CHART_BASE,
    },
    /\[html\]/,
  ],
  [
    "図の rows が数字でないと落ちる",
    {
      md: `${baseMd}\n<ryujin-chart src="/blog-charts/sample-chart.json" rows="a"></ryujin-chart>\n`,
      basePaths: CHART_BASE,
    },
    /\[html\]/,
  ],
  [
    "図の rows が 13 だと落ちる（1〜12）",
    {
      md: `${baseMd}\n<ryujin-chart src="/blog-charts/sample-chart.json" rows="13"></ryujin-chart>\n`,
      basePaths: CHART_BASE,
    },
    /\[html\]/,
  ],
  [
    "図の JSON が base にも HEAD にも無いと落ちる",
    { md: `${baseMd}\n${CHART}\n` },
    /\[chart\].*sample-chart\.json/,
  ],
  [
    "図の行と同じ段落のほかのタグ（<div>）は今までどおり落ちる",
    { md: `${baseMd}\n<div>x</div>\n`, basePaths: CHART_BASE },
    /\[html\]/,
  ],
  [
    "インデントのコード・インラインコードの中の図のタグは数えない",
    {
      md: `${baseMd}\n    ${CHART}\n\n本文 \`<ryujin-chart src="/x" rows="1"></ryujin-chart>\`\n`,
    },
    "ok",
  ],
  // ---- 指摘 P2-1: 削除（上の2例）
  // ---- 指摘 P2-2: 内部リンクに画像・プロトコル相対を数えない
  [
    "画像だけ（![..](/..)）では内部リンクにならない",
    { mdEn: "# Sample\n\n![x](/images/blog/sample-guide-ja.jpg)\n" },
    /\[link\].*sample-guide-en\.md/,
  ],
  [
    "プロトコル相対（](//）は内部リンクにならない",
    { mdEn: "# Sample\n\nSee [x](//evil.example.com/).\n" },
    /\[link\].*sample-guide-en\.md/,
  ],
  [
    "参照リンク [x][r] + [r]: /venues は内部リンクとして数える",
    { mdEn: "# Sample\n\nSee [venues][r].\n\n[r]: /en/venues\n" },
    "ok",
  ],
  // ---- 指摘 P2-3: JSON の「競艇」は metaTitle・metaDescription 以外すべて
  [
    "JSON の tags の「競艇」は落ちる",
    { json: { ...baseJson, tags: ["競艇", "入門"] } },
    /\[kyotei\].*tags/,
  ],
  [
    "JSON の category の「競艇」は落ちる",
    { json: { ...baseJson, category: "競艇入門" } },
    /\[kyotei\].*category/,
  ],
  // ---- 指摘 P2-4: 許可のパスのすり抜け
  ...[
    "public/blog/sub/x.md",
    "public/Blog/x.md",
    "public/images/blog/x.JPG",
    "public/blog/../x.md",
    "src/data/blog-posts/en/../x.json",
    ".github/workflows/x.yml",
  ].map((p) => [
    `許可外のパス ${p} は落ちる`,
    {
      extraDiff: [{ status: "A", path: p }],
      manifest: (m) => ({ ...m, paths: [...m.paths, p] }),
    },
    new RegExp(`\\[path\\] ${p.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")} `),
  ]),
  // ---- 指摘 P3: 時刻の形
  [
    "タイムゾーンの無い at は落ちる",
    { manifest: withReview("fan", { at: "2026-10-20T01:00:00" }) },
    /at が ISO の時刻でない/,
  ],
  [
    "日付だけの content_at は落ちる",
    { manifest: (m) => ({ ...m, content_at: "2026-10-20" }) },
    /content_at が ISO の時刻でない/,
  ],
  [
    "±hh:mm の時刻は通る",
    {
      manifest: (m) => ({
        ...withReview("fan", { at: "2026-10-20T10:00:00+09:00" })(m),
      }),
    },
    "ok",
  ],
  // ---- 指摘 P3: .md と JSON の対応
  [
    "足した日本語版 .md に日本語版 JSON が無いと落ちる",
    {
      diff: [
        { status: "A", path: MD },
        { status: "A", path: IMG },
      ],
      manifest: (m) => ({ ...m, kind: "revision" }),
    },
    /\[pair\] public\/blog\/sample-guide\.md/,
  ],
  [
    "足した日本語版 JSON に日本語版 .md が無いと落ちる",
    {
      md: baseMd,
      diff: [
        { status: "A", path: JSON_JA },
        { status: "A", path: IMG },
      ],
    },
    /\[pair\] src\/data\/blog-posts\/sample-guide\.json/,
  ],
  [
    "翻訳 .md に日本語版が無いと落ちる",
    {
      extraFiles: { "public/blog/nojp-en.md": "# x\n\n[a](/en)\n" },
      manifest: (m) => ({ ...m, paths: m.paths }),
    },
    /\[pair\] public\/blog\/nojp-en\.md/,
  ],
  [
    "翻訳 JSON の id がファイル名と違うと落ちる",
    {
      extraFiles: {
        [`src/data/blog-posts/en/${ID}.json`]: JSON.stringify({
          id: "other",
          title: "Sample",
          description: "d",
        }),
      },
    },
    /\[slug\] src\/data\/blog-posts\/en\/sample-guide\.json/,
  ],
  // ---- 指摘 P3: 1つの PR に1記事、kind
  [
    "別の記事の .md が混ざると落ちる",
    {
      extraFiles: { "public/blog/existing-en.md": "# x\n\n[a](/en)\n" },
      basePaths: [
        "public/blog/existing.md",
        "src/data/blog-posts/existing.json",
      ],
    },
    /\[manifest\].*1つの PR に1記事/,
  ],
  [
    "kind=new なのに日本語版 JSON の追加が無いと落ちる",
    {
      diff: [{ status: "M", path: MD }],
      basePaths: [MD, JSON_JA],
    },
    /\[manifest\] kind が new/,
  ],
  [
    "kind=revision なのに日本語版 JSON の追加があると落ちる",
    { manifest: (m) => ({ ...m, kind: "revision" }) },
    /\[manifest\] kind が revision/,
  ],
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

// 今の記事を壊さない: 全 .md・全 JSON を「変えたファイル」（status M）とみなして本文の関門を当てる
const blogDir = join(ROOT, "public/blog");
const mdFiles = readdirSync(blogDir).filter((f) => f.endsWith(".md"));
const masterErrors = [];
for (const f of mdFiles) {
  const path = `public/blog/${f}`;
  const text = readFileSync(join(blogDir, f), "utf8");
  masterErrors.push(
    ...checkRawHtml(path, text),
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
  masterErrors.push(
    ...checkKyoteiJson(
      path,
      JSON.parse(readFileSync(join(postsDir, f), "utf8")),
    ),
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
