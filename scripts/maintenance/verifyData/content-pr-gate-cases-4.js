/**
 * verify-content-pr-gate.js の表 cases の一部（不規則な空白を含む件の後ろ 3/4）。大きさの関所のため、本文を字のまま移した。verify ではない。
 * 不規則な空白を含む件は verify に残し、並びは verify の cases で元のままに組む。
 */
import {
  ID,
  IMG,
  JPEG,
  JSON_JA,
  MANIFEST,
  MD,
  MD_EN,
  baseJson,
  baseMd,
} from "./content-pr-gate-fixtures.js";
import {
  CHART,
  CHART_BASE,
  CHART_PATH,
  chartJson,
  chartRevision,
  withReview,
} from "./content-pr-gate-cases-1.js";

/** cases の不規則な空白を含む件の後ろ（3/4） */
export const CASES_B3 = [
  [
    "base の article が別記事の図（M）は落ちる（article だけ書き換えて乗っ取らない）",
    chartRevision({ baseArticle: "sample-guide-x" }),
    /\[chart\].*base の article "sample-guide-x"/,
  ],
  [
    "名前が、manifest.id を接頭辞に持つ別記事の id で始まる図は落ちる",
    {
      extraFiles: {
        "public/blog-charts/sample-guide-x-c.json": chartJson({
          id: "sample-guide-x-c",
        }),
      },
      basePaths: [
        "public/blog/existing.md",
        "src/data/blog-posts/existing.json",
        "src/data/blog-posts/sample-guide-x.json",
      ],
    },
    /\[chart\].*sample-guide-x-c\.json は記事 sample-guide-x の図/,
  ],
  [
    "図だけの改稿は落ちる（本文と表も同じ PR で直す）",
    chartRevision({ withMd: false }),
    /\[chart\].*本文（public\/blog\/sample-guide/,
  ],
  [
    "図の JSON には meta の例外が効かない（最上位の metaTitle の「競艇」も落ちる）",
    { extraFiles: { [CHART_PATH]: chartJson({ metaTitle: "競艇の図" }) } },
    /\[kyotei\].*sample-guide-course-win\.json の metaTitle/,
  ],
  [
    "図 id が空の名前（{記事id}-.json）は落ちる",
    {
      extraFiles: {
        "public/blog-charts/sample-guide-.json": chartJson({
          id: "sample-guide-",
        }),
      },
    },
    /\[chart\].*sample-guide-\.json の名前/,
  ],
  [
    "図の JSON の中の画像のパスは、画像の参照に数えない",
    {
      extraFiles: {
        [CHART_PATH]: chartJson({ note: "/images/blog/other.jpg" }),
      },
      headExtra: { "public/images/blog/other.jpg": JPEG },
      extraDiff: [{ status: "A", path: "public/images/blog/other.jpg" }],
    },
    /\[image\] 変えた public\/images\/blog\/other\.jpg をどの/,
  ],
  [
    "public/blog-charts の下の入れ子のパスは落ちる",
    {
      extraFiles: {
        "public/blog-charts/sub/sample-guide-x.json":
          '{"schemaVersion":1,"id":"sample-guide-course-win","article":"sample-guide","title":"進入コース別の1着率","description":"1コースの1着率は55.5%。"}',
      },
    },
    /\[path\].*blog-charts\/sub/,
  ],
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
