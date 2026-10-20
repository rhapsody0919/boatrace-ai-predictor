/**
 * ブログ画像（public/images/blog/）の実寸を、画像のヘッダーから読む（BOA-908）。
 *
 * BlogPost.jsx は画像に width/height を付けて CLS を防ぐ（比率は 16:9〜3:1・縦長まで様々なので、
 * 一律の aspect-ratio ではなく実寸を使う。PR#559 の撤回の経緯）。以前は寸法を手で書いた表
 * （src/data/blogImageDimensions.js）を記事の PR のたびに直していた。ビルドの時にここで作るので、
 * 記事の PR は .md・.json・画像だけを触ればよい。画面へは vite.config.js の仮想モジュールで渡す。
 * 検証: scripts/maintenance/verify-blog-image-dimensions.js
 */
import fs from "node:fs";
import path from "node:path";

// SOF（フレームの始まり）のマーカー。C4（DHT）・C8（JPG 拡張）・CC（DAC）は SOF ではない
const isStartOfFrame = (marker) =>
  marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

/**
 * JPEG のヘッダーから幅と高さを読む。JPEG でない・壊れているときは null
 * @param {Uint8Array} buf
 * @returns {{ width: number, height: number } | null}
 */
export function readJpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    // 埋め草の 0xFF と、長さを持たないマーカー（RST・TEM）は1つずつ進む
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const length = (buf[i + 2] << 8) | buf[i + 3];
    if (isStartOfFrame(marker)) {
      const height = (buf[i + 5] << 8) | buf[i + 6];
      const width = (buf[i + 7] << 8) | buf[i + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += 2 + length;
  }
  return null;
}

/**
 * ディレクトリの JPEG の寸法の表を作る。キーは画面の URL（例 /images/blog/x.jpg）
 * 読めない JPEG があれば例外にする（寸法の無い画像が黙って混ざると CLS が戻るため）
 * @param {string} dir 例 public/images/blog
 * @param {string} urlPrefix 例 /images/blog/
 * @returns {Record<string, { width: number, height: number }>}
 */
export function buildImageDimensions(dir, urlPrefix) {
  const entries = fs
    .readdirSync(dir)
    .filter((name) => /\.jpe?g$/i.test(name))
    .sort()
    .map((name) => {
      const size = readJpegSize(fs.readFileSync(path.join(dir, name)));
      if (!size) {
        throw new Error(
          `blogImageDimensions: ${path.join(dir, name)} の寸法をヘッダーから読めません`,
        );
      }
      return [`${urlPrefix}${name}`, size];
    });
  return Object.fromEntries(entries);
}
