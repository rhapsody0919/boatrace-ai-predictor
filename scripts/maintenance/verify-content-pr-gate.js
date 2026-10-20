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
  ];
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
    paths: diff.map((d) => (d.status === "D" ? `-${d.path}` : d.path)),
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
  head[MANIFEST] = enc(JSON.stringify(finalManifest));
  return {
    diff: [
      ...diff,
      { status: over.manifestStatus ?? "A", path: MANIFEST },
      ...(over.extraDiff ?? []),
    ],
    head: over.head ? over.head(head) : head,
    base: over.base ?? {},
    basePaths: over.basePaths ?? [
      "public/blog/existing.md",
      "src/data/blog-posts/existing.json",
    ],
    config: over.config ?? config,
  };
}

const withReview = (role, extra) => (m) => ({
  ...m,
  reviews: m.reviews.map((r) => (r.role === role ? { ...r, ...extra } : r)),
});

// expect: "ok" | "hold"（ok かつ hold）| RegExp（errors のどれかに当たる）
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
    "JSON の metaTitle の「競艇」は通るが hold（申告あり）",
    {
      json: { ...baseJson, metaTitle: "競艇の記事" },
      manifest: (m) => ({ ...m, judgement_words: ["競艇"] }),
    },
    "hold",
  ],
  // 判断が要る語
  [
    "判断が要る語を申告していなければ落ちる",
    { md: `${baseMd}\n的中率の話\n` },
    /\[judgement\].*的中率/,
  ],
  [
    "判断が要る語を申告していれば hold で通る",
    {
      md: `${baseMd}\n的中率の話\n`,
      manifest: (m) => ({ ...m, judgement_words: ["的中率"] }),
    },
    "hold",
  ],
  [
    "語が無くても申告が空でなければ hold",
    { manifest: (m) => ({ ...m, judgement_words: ["保証"] }) },
    "hold",
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
    "削除は「-」つきで通る",
    {
      extraDiff: [{ status: "D", path: "public/images/blog/old.jpg" }],
      manifest: (m) => ({
        ...m,
        paths: [...m.paths, "-public/images/blog/old.jpg"],
      }),
    },
    "ok",
  ],
  [
    "削除を「-」なしで書くと落ちる",
    {
      extraDiff: [{ status: "D", path: "public/images/blog/old.jpg" }],
      manifest: (m) => ({
        ...m,
        paths: [...m.paths, "public/images/blog/old.jpg"],
      }),
    },
    /\[manifest\] paths に差分の -public\/images\/blog\/old\.jpg が無い/,
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
      ? result.ok && !result.hold
      : expect === "hold"
        ? result.ok && result.hold
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
  if (text.includes("](/"))
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
