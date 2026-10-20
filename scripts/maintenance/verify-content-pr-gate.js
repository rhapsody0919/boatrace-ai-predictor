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
  changedJsonStrings,
  findJudgementPhrases,
  changedMdParagraphs,
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
    ...(over.headExtra ?? {}),
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

/** 既存記事の改稿（.md と日本語版 JSON を M）。base と HEAD の中身を渡す */
const revision = ({
  baseMdText = baseMd,
  headMdText = baseMdText,
  baseJsonObj = baseJson,
  headJsonObj = baseJsonObj,
}) => ({
  md: headMdText,
  json: headJsonObj,
  diff: [
    { status: "M", path: MD },
    { status: "M", path: JSON_JA },
  ],
  base: { [MD]: baseMdText, [JSON_JA]: JSON.stringify(baseJsonObj) },
  basePaths: [MD, JSON_JA, MANIFEST],
  manifestStatus: "M",
  manifest: (m) => ({ ...m, kind: "revision" }),
});

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
    "JSON の description の「競艇」は落ちる",
    { json: { ...baseJson, description: "競艇の説明" } },
    /\[kyotei\].* description/,
  ],
  [
    "入れ子の metaTitle の「競艇」は落ちる（例外は最上位の文字列だけ）",
    { json: { ...baseJson, x: { metaTitle: "競艇" } } },
    /\[kyotei\].* x\.metaTitle/,
  ],
  [
    "metaTitle の下の入れ子の「競艇」は落ちる",
    { json: { ...baseJson, metaTitle: { title: "競艇" } } },
    /\[kyotei\].* metaTitle\.title/,
  ],
  [
    "metaTitle が配列の「競艇」は落ちる",
    { json: { ...baseJson, metaTitle: ["競艇"] } },
    /\[kyotei\].* metaTitle\.0/,
  ],
  [
    "meta で始まる別のキー（metaKeywords）の「競艇」は落ちる",
    { json: { ...baseJson, metaKeywords: "競艇" } },
    /\[kyotei\].* metaKeywords/,
  ],
  [
    "JSON の metaTitle の「競艇」は通る（オーナー決定 10/20、code-style.md 例外1。暫定）",
    { json: { ...baseJson, metaTitle: "競艇の記事" } },
    "ok",
  ],
  // 判断が要る句（決定 (a): 変えた行・足した行だけ、誤解を生む句と正規表現、免責の決まり文の例外）
  [
    "足した行の「必ず当たる」は落ちる",
    { md: `${baseMd}\nこの買い方なら必ず当たる\n` },
    /\[judgement\].*必ず当たる/,
  ],
  [
    "足した行の「回収率120%」は落ちる",
    { md: `${baseMd}\n回収率は120%でした\n` },
    /\[judgement\].*回収率は120%/,
  ],
  [
    "全角の「回収率１５０％」も落ちる",
    { md: `${baseMd}\n回収率１５０％\n` },
    /\[judgement\].*回収率150%/,
  ],
  [
    "100% 未満の回収率・的中率はデータの記述として通る",
    { md: `${baseMd}\n回収率は85.3%、的中率は12%だった\n` },
    "ok",
  ],
  [
    "免責文（保証されません・必ずご自身の判断で）を含む新規記事は通る",
    { md: `${baseMd}\n結果は保証されません。舟券は必ずご自身の判断で。\n` },
    "ok",
  ],
  [
    "新規でも「的中保証はしません」は例外の行で通る",
    { md: `${baseMd}\n的中保証はしません\n` },
    "ok",
  ],
  [
    "JSON の tags に足した「儲かる」は落ちる",
    { json: { ...baseJson, tags: ["入門", "儲かる買い方"] } },
    /\[judgement\].*儲かる/,
  ],
  [
    "改稿で触っていない行・値に「回収率」「的中率」「回収率150%」があっても通る",
    revision({
      baseMdText: `${baseMd}\n回収率150%の月もあった。的中率の話\n`,
      headMdText: `${baseMd}\n回収率150%の月もあった。的中率の話\n\n追記した行\n`,
      baseJsonObj: {
        ...baseJson,
        description: "回収率120%を必ず当たると書いた古い説明",
      },
      headJsonObj: {
        ...baseJson,
        description: "回収率120%を必ず当たると書いた古い説明",
        title: "新しい題",
      },
    }),
    "ok",
  ],
  [
    "改稿で行を並べ替えただけなら見ない",
    revision({
      baseMdText: `${baseMd}\n必ず当たる\n\nB の行\n`,
      headMdText: `${baseMd}\nB の行\n\n必ず当たる\n`,
    }),
    "ok",
  ],
  [
    "改稿で変えた行に「的中保証」があれば落ちる",
    revision({
      baseMdText: `${baseMd}\n古い行\n`,
      headMdText: `${baseMd}\n的中保証つきの買い方\n`,
    }),
    /\[judgement\].*的中保証/,
  ],
  [
    "改稿で変えた行が「的中保証はしません」なら例外の行で通る",
    revision({
      baseMdText: `${baseMd}\n古い行\n`,
      headMdText: `${baseMd}\n的中保証はしません\n`,
    }),
    "ok",
  ],
  [
    "改稿で JSON の値を変えて「稼げる」を入れると落ちる",
    revision({
      baseJsonObj: { ...baseJson, description: "説明" },
      headJsonObj: { ...baseJson, description: "これで稼げる" },
    }),
    /\[judgement\].*稼げる/,
  ],
  [
    "改稿で変えていない metaTitle の「競艇」は見ない",
    revision({
      baseJsonObj: { ...baseJson, metaTitle: "競艇の記事" },
      headJsonObj: { ...baseJson, metaTitle: "競艇の記事", title: "新しい題" },
    }),
    "ok",
  ],
  [
    "改稿で変えた metaTitle の「競艇」も通る（暫定の例外）",
    revision({
      baseJsonObj: { ...baseJson, metaTitle: "記事" },
      headJsonObj: { ...baseJson, metaTitle: "競艇の記事" },
    }),
    "ok",
  ],
  // ---- 8271c413a の審査 P1-1: 免責の決まり文は、その部分だけを消して残りを照合する
  [
    "「必ず当たる。結果は保証されません」は落ちる（決まり文の行でも残りを見る）",
    { md: `${baseMd}\n必ず当たる。結果は保証されません\n` },
    /\[judgement\].*必ず当たる/,
  ],
  [
    "「回収率300%！※結果を保証するものではありません」は落ちる",
    { md: `${baseMd}\n回収率300%！※結果を保証するものではありません\n` },
    /\[judgement\].*回収率300%/,
  ],
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
  [
    "改稿で、触っていない行と変えた行にまたがる句も段落で落ちる",
    revision({
      baseMdText: `${baseMd}\n必ず\n古い行\n`,
      headMdText: `${baseMd}\n必ず\n当たる\n`,
    }),
    /\[judgement\].*必ず当たる/,
  ],
  [
    "改稿で、句の無い段落だけを変えたなら別の段落の句は見ない",
    revision({
      baseMdText: `${baseMd}\n必ず当たる（古い文）\n\n古い行\n`,
      headMdText: `${baseMd}\n必ず当たる（古い文）\n\n新しい行\n`,
    }),
    "ok",
  ],
  // ---- P2-2: 回収率の見落とし
  ...[
    ["コンマ区切り", "回収率1,343%"],
    ["逆の語順", "120%の回収率"],
    ["パーセント", "回収率120パーセント"],
    ["間が7字以上", "回収率がなんと驚異の150%"],
    ["半角と全角の混ざり", "回収率１2０%"],
    ["倍", "回収率 1.5倍"],
  ].map(([name, text]) => [
    `回収率の${name}（${text}）は落ちる`,
    { md: `${baseMd}\n${text}\n` },
    /\[judgement\].*回収率/,
  ]),
  [
    "回収率が 100% 未満・1倍未満・漢数字は通る",
    {
      md: `${baseMd}\n回収率85%、回収率0.8倍、回収率は百二十パーセント\n`,
    },
    "ok",
  ],
  // ---- 3feff1cc1 の再審査 P2-1: オッズや別の数を回収率の主張として拾わない
  ...[
    ["文の区切りをまたぐ", "回収率が低い。オッズは1.2倍"],
    ["倍の逆の語順", "オッズ2.0倍の回収率85%"],
    ["倍の逆の語順（数だけ）", "単勝1.5倍で回収率"],
    ["1倍を切る", "回収率は1倍を切る"],
    ["1倍未満", "回収率1倍未満"],
    ["100%以下", "回収率100%以下"],
    ["150%を下回る", "回収率が150%を下回る"],
    ["× と =", "的中率60% × オッズ1.3倍 = 回収率78%"],
    ["箇条をまたぐ", "- 回収率が高い\n- オッズ3倍以上を狙う"],
    [
      "表の列をまたぐ",
      "| 点数 | 必要オッズ | 回収率の傾向 |\n|---|---|---|\n| 3点 | 30倍以上 | ⭐高回収率 |",
    ],
    ["表の見出しをまたぐ", "| 会場 | 100%超え | 最高回収率 | おすすめ |"],
    ["空白で隣り合う数（P3-3）", "回収率 R1 150%"],
  ].map(([name, text]) => [
    `回収率の主張ではない（${name}）は通る`,
    { md: `${baseMd}\n${text}\n` },
    "ok",
  ]),
  [
    "回収率が2倍は落ちる（倍は回収率の後4字まで）",
    { md: `${baseMd}\n回収率が2倍になった\n` },
    /\[judgement\].*回収率が2倍/,
  ],
  [
    "回収率は120%は落ちる",
    { md: `${baseMd}\n回収率は120%\n` },
    /\[judgement\].*回収率は120%/,
  ],
  // ---- P3-1: 今ある行の複製は、増えた分を足した行とみなす
  [
    "改稿で、今ある「必ず当たる」の行を複製すると落ちる",
    revision({
      baseMdText: `${baseMd}\n必ず当たる\n`,
      headMdText: `${baseMd}\n必ず当たる\n\n必ず当たる\n`,
    }),
    /\[judgement\].*必ず当たる/,
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
  // ---- 回帰の審査 P2: 画像の差し替え・実在しない id の revision・manifest だけ
  [
    "別の記事の画像だけを M で差し替えると落ちる",
    {
      diff: [{ status: "M", path: "public/images/blog/other-article.jpg" }],
      headExtra: { "public/images/blog/other-article.jpg": JPEG },
      basePaths: [MD, JSON_JA, "public/images/blog/other-article.jpg"],
      manifest: (m) => ({ ...m, kind: "revision" }),
    },
    /\[image\] 変えた public\/images\/blog\/other-article\.jpg をどの/,
  ],
  [
    "実在しない id の revision は落ちる",
    {
      diff: [{ status: "M", path: MD }],
      manifest: (m) => ({ ...m, kind: "revision" }),
    },
    /\[manifest\] kind が revision なのに base に src\/data\/blog-posts\/sample-guide\.json が無い/,
  ],
  [
    "manifest だけの PR は落ちる",
    {
      diff: [],
      basePaths: [MD, JSON_JA],
      manifest: (m) => ({ ...m, kind: "revision" }),
    },
    /\[manifest\] paths が空/,
  ],
  // ---- 回帰の審査 P3
  [
    "存在しない日付（2026-02-30）の content_at は落ちる",
    { manifest: (m) => ({ ...m, content_at: "2026-02-30T00:00:00Z" }) },
    /content_at が ISO の時刻でない/,
  ],
  [
    "T24:00 の at は落ちる",
    { manifest: withReview("fan", { at: "2026-10-20T24:00:00Z" }) },
    /at が ISO の時刻でない/,
  ],
  [
    "/\\ で始まるリンクは内部リンクにならない",
    { mdEn: "# Sample\n\nSee [x](/\\evil.example.com).\n" },
    /\[link\].*sample-guide-en\.md/,
  ],
  [
    "図のタグが1行目でも通る",
    { md: `${CHART}\n\n${baseMd}`, basePaths: CHART_BASE },
    "ok",
  ],
  [
    "図のタグが最後の行（末尾の改行なし）でも通る",
    { md: `${baseMd}\n${CHART}`, basePaths: CHART_BASE },
    "ok",
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
