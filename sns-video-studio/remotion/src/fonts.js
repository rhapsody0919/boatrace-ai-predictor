import { loadFont } from "@remotion/fonts";
import notoSansJpUrl from "./fonts/noto-sans-jp/NotoSansJP-wght.woff2";

/**
 * 全CMコンポーネント共通のフォント指定。
 *
 * 旧実装は`"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP"`という
 * macOS専用フォント名を21ファイルに個別ハードコードしていた。レンダリングは
 * Linux上のヘッドレスChromiumで行われるためどちらも存在せず`sans-serif`に
 * フォールバックし、fontconfigが解決するCJKフォント（中国語簡体字インスタンス
 * 等）が使われ日本語が中国語風グリフで描画される不具合があった（2026-09-04）。
 *
 * Noto Sans JP をリポジトリに同梱し、ネットを読まずに描く（2026-11-04）。
 * 以前は`@remotion/google-fonts`で fonts.gstatic.com から読んでいた。Google の配る Noto Sans JP は
 * 可変フォント（wght 100〜900）を unicode-range で分けたもので、4つの太さ × 121 個 = 1頁ごとに 484 回の読み取りがあった。
 * 同梱するのは同じ版（2.004）の可変フォントを woff2 に詰め直した1つ（約4.35MB、全 16,732 字。分割のまま置くと 121 ファイル・約5.2MB で、
 * 以前の japanese・latin の分割が含む 16,591 字しか無い）。字の形は同じで、描いた画素も以前と一致した（PR の前後の比べ）。
 * 作り方は fonts/noto-sans-jp/build.py。ライセンスは SIL OFL 1.1（fonts/noto-sans-jp/OFL.txt）。
 * 同梱に無い字を描く型は fonts/useGlyphGuard.js が描画を止める（豆腐を出さない）。
 *
 * ファイルは import で読む（webpack の asset/resource）。staticFile は使わない: f01・人気薄の1着は --public-dir に
 * 声・撮った画面だけのフォルダを渡すので、public/ に置いたフォントがその描画では見つからない。
 */
// 太さは以前の google-fonts と同じ 400/700/800/900（300/600 は各1箇所のみで、近い太さへブラウザが寄せる。以前と同じ見た目にするため変えない）。
// 1つの可変フォントを太さごとの面として登録する（面の weight が1つの値なので、可変の軸はその値に固定される。以前の分割と同じ）。
export const FONT_FAMILY = "Noto Sans JP";
export const FONT_WEIGHTS = ["400", "700", "800", "900"];
for (const weight of FONT_WEIGHTS) {
  loadFont({
    family: FONT_FAMILY,
    url: notoSansJpUrl,
    weight,
    style: "normal",
    format: "woff2",
  });
}

export const FONT = `"${FONT_FAMILY}", sans-serif`;
