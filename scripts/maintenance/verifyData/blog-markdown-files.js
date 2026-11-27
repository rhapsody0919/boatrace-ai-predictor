/**
 * verify-blog-cjk-emphasis.js の道具。verify ではない。
 * 今ある全ての記事の Markdown（public/blog/*.md）を { file, markdown } の並びで返す。
 */
import { readdir, readFile } from "node:fs/promises";

const DIR = new URL("../../../public/blog/", import.meta.url);

/** @returns {Promise<Array<{ file: string, markdown: string }>>} */
export async function readBlogMarkdownFiles() {
  const files = (await readdir(DIR)).filter((f) => f.endsWith(".md")).sort();
  return Promise.all(
    files.map(async (file) => ({
      file,
      markdown: await readFile(new URL(file, DIR), "utf8"),
    })),
  );
}
