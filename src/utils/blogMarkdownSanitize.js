/**
 * ブログ記事（public/blog/*.md）を描く rehype のプラグインと、HTML の許可リスト。
 *
 * 記事は rehype-raw で生の HTML も描くため、許可リストが無いと、記事に紛れた
 * <script>・<iframe>・on* 属性・javascript: の URL が本番の origin で動きうる
 * （同じ origin に /admin と /api/admin がある）。記事は AI も書くので、ここで塞ぐ。
 * AI 向けのスナップショット（scripts/generate-ai-snapshots.js）もこの描画の結果を保存するので同じく塞がる。
 *
 * 許可リストは GitHub と同じ既定（hast-util-sanitize の defaultSchema）に、
 * ブログの図のタグ（docs/design/blog-charts/contract.md）だけを足したもの。
 * 再現テスト: scripts/maintenance/verify-blog-markdown-sanitize.js
 */
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

export const blogSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...defaultSchema.tagNames, "ryujin-chart"],
  attributes: {
    ...defaultSchema.attributes,
    "ryujin-chart": ["src", "rows"],
  },
};

/** 生の HTML を描いたあとに許可リストで削る。順番を入れ替えると削る前の HTML が残る */
export const blogRehypePlugins = [
  rehypeRaw,
  [rehypeSanitize, blogSanitizeSchema],
];
