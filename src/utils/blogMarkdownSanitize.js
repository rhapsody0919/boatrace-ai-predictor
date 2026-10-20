/**
 * ブログ記事（public/blog/*.md）を描く rehype のプラグインと、HTML の許可リスト。
 *
 * 記事は rehype-raw で生の HTML も描くため、許可リストが無いと、記事に紛れた
 * <script>・<iframe>・on* 属性・javascript: の URL が本番の origin で動きうる
 * （同じ origin に /admin と /api/admin がある）。記事は AI も書くので、ここで塞ぐ。
 * AI 向けのスナップショット（scripts/generate-ai-snapshots.js）もこの描画の結果を保存するので同じく塞がる。
 *
 * 許可リストは GitHub と同じ既定（hast-util-sanitize の defaultSchema）に、
 * ブログの図のタグ ryujin-chart（契約は docs/design/blog-charts/contract.md、図の部品の PR で入る）だけを足したもの。
 * 図の src は /blog-charts/ の下の JSON に限る（外の JSON を読む口にしない）。rows は数として扱われ値の制限が効かないので、範囲は図の部品と CI で絞る。
 * 再現テスト: scripts/maintenance/verify-blog-markdown-sanitize.js
 */
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { BLOG_CHART_TAG, BLOG_CHART_SRC_RE } from "./blogChartTag.js";

export const blogSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...defaultSchema.tagNames, BLOG_CHART_TAG],
  attributes: {
    ...defaultSchema.attributes,
    [BLOG_CHART_TAG]: [["src", BLOG_CHART_SRC_RE], "rows"],
  },
};

/** 生の HTML を描いたあとに許可リストで削る。順番を入れ替えると削る前の HTML が残る */
export const blogRehypePlugins = [
  rehypeRaw,
  [rehypeSanitize, blogSanitizeSchema],
];
