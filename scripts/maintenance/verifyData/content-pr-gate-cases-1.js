/**
 * verify-content-pr-gate.js の表 cases の一部（表で使う組み立ての関数と1件目から）。大きさの関所のため、本文を字のまま移した。verify ではない。
 * 不規則な空白を含む件は verify に残し、並びは verify の cases で元のままに組む。
 */
import {
  ID,
  JSON_JA,
  MANIFEST,
  MD,
  MD_EN,
  baseJson,
  baseMd,
  baseMdEn,
  config,
  enc,
} from "./content-pr-gate-fixtures.js";

export const CHART =
  '<ryujin-chart src="/blog-charts/sample-chart.json" rows="3"></ryujin-chart>';
export const CHART_BASE = [
  "public/blog/existing.md",
  "src/data/blog-posts/existing.json",
  "public/blog-charts/sample-chart.json",
];

export const CHART_PATH = "public/blog-charts/sample-guide-course-win.json";
export const chartJson = (o = {}) =>
  JSON.stringify({
    schemaVersion: 1,
    id: "sample-guide-course-win",
    article: ID,
    title: "進入コース別の1着率",
    description: "1コースの1着率は55.5%。",
    ...o,
  });
/** 既存記事の改稿で図の JSON を M。withMd が false なら本文を変えない（図だけ） */
export const chartRevision = ({ baseArticle = ID, withMd = true }) => {
  const headMd = `${baseMd}\n<ryujin-chart src="/blog-charts/sample-guide-course-win.json" rows="3"></ryujin-chart>\n`;
  return {
    md: withMd ? headMd : baseMd,
    diff: [
      ...(withMd ? [{ status: "M", path: MD }] : []),
      { status: "M", path: CHART_PATH },
    ],
    headExtra: {
      [CHART_PATH]: enc(chartJson({ title: "進入コース別の1着率（直した）" })),
    },
    base: { [MD]: baseMd, [CHART_PATH]: chartJson({ article: baseArticle }) },
    basePaths: [MD, JSON_JA, MANIFEST, CHART_PATH],
    manifestStatus: "M",
    manifest: (m) => ({ ...m, kind: "revision" }),
  };
};

/** 既存記事の改稿（.md と日本語版 JSON を M）。base と HEAD の中身を渡す */
export const revision = ({
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

// 免除の一覧（internalLinkGrandfathered）から記事の行を外す改稿（オーナー決定 2026-10-26、#1934→#1938）。
// base の一覧に MD がある・HEAD の .md に内部リンクを足し・同じ PR で一覧からその1行だけを外す。manifest の paths に設定のパスは入れない
export const GATE_CONFIG = "scripts/content/content-pr-gate.json";
export const noLinkMd =
  "# サンプル\n\n本文。\n\n![図](/images/blog/sample-guide-ja.jpg)\n";
export const grandfatherRemoval = ({
  baseList = [...config.internalLinkGrandfathered, MD, MD_EN],
  headList = [...config.internalLinkGrandfathered, MD_EN],
  headCfgOver = {},
  headMdText = baseMd,
  diff,
  manifest = (m) => m,
} = {}) => {
  const baseCfg = { ...config, internalLinkGrandfathered: baseList };
  const headCfg = {
    ...config,
    internalLinkGrandfathered: headList,
    ...headCfgOver,
  };
  const r = revision({ baseMdText: noLinkMd, headMdText });
  return {
    ...r,
    ...(diff ? { diff } : {}),
    extraDiff: [{ status: "M", path: GATE_CONFIG }],
    headExtra: { [GATE_CONFIG]: enc(`${JSON.stringify(headCfg, null, 2)}\n`) },
    base: {
      ...r.base,
      [MD_EN]: baseMdEn,
      [GATE_CONFIG]: `${JSON.stringify(baseCfg, null, 2)}\n`,
    },
    basePaths: [...r.basePaths, MD_EN],
    config: headCfg,
    manifest: (m) => manifest(r.manifest(m)),
  };
};

export const withReview = (role, extra) => (m) => ({
  ...m,
  reviews: m.reviews.map((r) => (r.role === role ? { ...r, ...extra } : r)),
});

/** cases の1件目から不規則な空白を含む件の前まで */
export const CASES_A = [
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
];
