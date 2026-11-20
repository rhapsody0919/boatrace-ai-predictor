/**
 * verify-content-pr-gate.js の表 cases の一部（不規則な空白を含む件の後ろ 4/4）。大きさの関所のため、本文を字のまま移した。verify ではない。
 * 不規則な空白を含む件は verify に残し、並びは verify の cases で元のままに組む。
 */
import {
  JPEG,
  JSON_JA,
  MD,
  MD_EN,
  baseMd,
  config,
} from "./content-pr-gate-fixtures.js";
import {
  CHART,
  CHART_BASE,
  GATE_CONFIG,
  grandfatherRemoval,
  noLinkMd,
  withReview,
} from "./content-pr-gate-cases-1.js";

/** cases の不規則な空白を含む件の後ろ（4/4） */
export const CASES_B4 = [
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
  // ---- 免除の一覧から外す例外（オーナー決定 2026-10-26）
  [
    "改稿で内部リンクを足し、一覧からその記事の1行だけを外すと通る",
    grandfatherRemoval(),
    "ok",
  ],
  [
    "一覧から他の記事の行を外すと落ちる",
    grandfatherRemoval({
      headList: [
        ...config.internalLinkGrandfathered.filter(
          (p) => p !== "public/blog/ai-vs-human.md",
        ),
        MD_EN,
      ],
    }),
    /\[gate-config\].*public\/blog\/ai-vs-human\.md.*manifest/,
  ],
  [
    "一覧に行を足すと落ちる",
    grandfatherRemoval({
      headList: [
        ...config.internalLinkGrandfathered,
        MD_EN,
        "public/blog/x.md",
      ],
    }),
    /\[gate-config\] .*internalLinkGrandfathered からの削除だけ/,
  ],
  [
    "一覧の並べ替えは落ちる",
    grandfatherRemoval({
      headList: [MD_EN, ...config.internalLinkGrandfathered],
    }),
    /\[gate-config\] .*internalLinkGrandfathered からの削除だけ/,
  ],
  [
    "一覧の削除に他のキーの変更が混ざると落ちる",
    grandfatherRemoval({ headCfgOver: { judgementPhrases: [] } }),
    /\[gate-config\] .*internalLinkGrandfathered からの削除だけ/,
  ],
  [
    "manifest に無い記事（差分に無い翻訳）の行を外すと落ちる",
    grandfatherRemoval({ headList: [...config.internalLinkGrandfathered] }),
    /\[gate-config\].*sample-guide-en\.md.*manifest/,
  ],
  [
    "内部リンクが無いのに外すと落ちる",
    grandfatherRemoval({ headMdText: `${noLinkMd}\n追記した行\n` }),
    /\[gate-config\].*sample-guide\.md.*内部リンクが無い/,
  ],
  [
    "manifest の paths に設定のパスを入れると落ちる",
    grandfatherRemoval({
      manifest: (m) => ({ ...m, paths: [...m.paths, GATE_CONFIG] }),
    }),
    /\[manifest\] paths の scripts\/content\/content-pr-gate\.json/,
  ],
  [
    "設定の一覧を変えずに整形だけ変えると落ちる",
    grandfatherRemoval({
      headList: [...config.internalLinkGrandfathered, MD, MD_EN],
    }),
    /\[gate-config\] .*internalLinkGrandfathered からの削除だけ/,
  ],
  [
    "記事の PR でない（manifest の無い）設定の変更は今までどおり落ちる",
    { extraDiff: [{ status: "M", path: GATE_CONFIG }] },
    /\[gate-config\]|\[path\] scripts\/content\/content-pr-gate\.json/,
  ],
];
