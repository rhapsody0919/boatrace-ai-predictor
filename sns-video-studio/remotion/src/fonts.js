import { loadFont } from "@remotion/google-fonts/NotoSansJP";

/**
 * 全CMコンポーネント共通のフォント指定。
 *
 * 旧実装は`"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP"`という
 * macOS専用フォント名を21ファイルに個別ハードコードしていた。レンダリングは
 * Linux上のヘッドレスChromiumで行われるためどちらも存在せず`sans-serif`に
 * フォールバックし、fontconfigが解決するCJKフォント（中国語簡体字インスタンス
 * 等）が使われ日本語が中国語風グリフで描画される不具合があった（2026-09-04）。
 *
 * `@remotion/google-fonts`でNoto Sans JPを明示的にバンドル・待機することで、
 * レンダリング環境のフォント有無に依存しない描画結果にする。
 */
// 実使用ウェイトは400/700/800/900がほぼ全て（300/600は各1箇所のみで、
// 未バンドルでも近傍ウェイトへブラウザが自動フォールバックし視覚差は軽微）。
// ウェイト数を絞るのはリクエスト数削減のため（6ウェイト×japanese/latin全チャンクで
// 700件超のフォント取得が発生し、レンダリング時間・安定性を損なうことを実測で確認）。
const { fontFamily } = loadFont("normal", {
  weights: ["400", "700", "800", "900"],
  subsets: ["japanese", "latin"],
});

export const FONT = `"${fontFamily}", sans-serif`;
