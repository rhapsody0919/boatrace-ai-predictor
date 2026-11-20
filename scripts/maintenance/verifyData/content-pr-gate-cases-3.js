/**
 * verify-content-pr-gate.js の表 cases の一部（不規則な空白を含む件の後ろ 2/4）。大きさの関所のため、本文を字のまま移した。verify ではない。
 * 不規則な空白を含む件は verify に残し、並びは verify の cases で元のままに組む。
 */
import {
  IMG,
  JSON_JA,
  MD,
  MD_EN,
  baseMd,
  config,
} from "./content-pr-gate-fixtures.js";
import {
  chartRevision,
  withReview,
} from "./content-pr-gate-cases-1.js";

/** cases の不規則な空白を含む件の後ろ（2/4） */
export const CASES_B2 = [
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
    "記事の PR で図の JSON（public/blog-charts/{記事id}-*.json）を足せる",
    {
      md: `${baseMd}\n<ryujin-chart src="/blog-charts/sample-guide-course-win.json" rows="3"></ryujin-chart>\n`,
      extraFiles: {
        "public/blog-charts/sample-guide-course-win.json":
          '{"schemaVersion":1,"id":"sample-guide-course-win","article":"sample-guide","title":"進入コース別の1着率","description":"1コースの1着率は55.5%。"}',
      },
    },
    "ok",
  ],
  [
    "図の JSON の名前が manifest.id で始まらないと落ちる（1つの PR に1記事）",
    {
      extraFiles: {
        "public/blog-charts/other-article-x.json":
          '{"schemaVersion":1,"id":"other-article-x","article":"sample-guide","title":"進入コース別の1着率","description":"1コースの1着率は55.5%。"}',
      },
    },
    /\[chart\].*other-article-x\.json の名前/,
  ],
  [
    "図の JSON の article が manifest.id と違うと落ちる",
    {
      extraFiles: {
        "public/blog-charts/sample-guide-course-win.json":
          '{"schemaVersion":1,"id":"sample-guide-course-win","article":"other-article","title":"進入コース別の1着率","description":"1コースの1着率は55.5%。"}',
      },
    },
    /\[chart\].*article "other-article"/,
  ],
  [
    "図の JSON の「競艇」は落ちる（画面に出る文字）",
    {
      extraFiles: {
        "public/blog-charts/sample-guide-course-win.json":
          '{"schemaVersion":1,"id":"sample-guide-course-win","article":"sample-guide","title":"競艇の1着率","description":"1コースの1着率は55.5%。"}',
      },
    },
    /\[kyotei\].*sample-guide-course-win\.json の title/,
  ],
  [
    "図の JSON の判断が要る句は落ちる",
    {
      extraFiles: {
        "public/blog-charts/sample-guide-course-win.json":
          '{"schemaVersion":1,"id":"sample-guide-course-win","article":"sample-guide","title":"進入コース別の1着率","description":"1コースを買えば儲かる。"}',
      },
    },
    /\[judgement\].*儲かる/,
  ],
  ["改稿で図の JSON（M）と本文を一緒に直すと通る", chartRevision({}), "ok"],
];
