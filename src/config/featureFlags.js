/**
 * 公開前の機能の表示切り替え。
 *
 * アナロジー・ファインダー（BOA-271）の寄与度の節は、master に入れたうえで公開までは隠す
 * （2026-10-02 ユーザー判断）。公開するときは ANALOGY_FINDER_PUBLIC を true にするだけでよい。
 * 思考アシスト（BOA-430）のページも同じ仕組みで、公開までは THINKING_ASSIST_PUBLIC = false。
 * 隠している間も、本番で内部確認できるように次のどちらかで表示できる:
 *   - URL にクエリ（?analogy=1 ／ ?assist=1）を付けて開く（端末に覚える。=0 で忘れる）
 *   - localStorage のキー（*_PREVIEW_KEY）を "1" にする
 * 隠している間は節を描かないので、寄与度の API も呼ばない（DB への問い合わせは無い）。
 * キーは boatai-user: 接頭辞（キャッシュの全削除で消えないユーザー保存の名前空間）。
 */
export const ANALOGY_FINDER_PUBLIC = true;
export const ANALOGY_FINDER_PREVIEW_KEY = "boatai-user:analogy-finder-preview";

export const THINKING_ASSIST_PUBLIC = false;
export const THINKING_ASSIST_PREVIEW_KEY =
  "boatai-user:thinking-assist-preview";

/** URL のクエリ queryName（"1" で覚える・"0" で忘れる）と localStorage の storageKey で、内部確認の印を読む */
function readPreviewFlag(queryName, storageKey) {
  try {
    const param = new URLSearchParams(window.location.search).get(queryName);
    if (param === "1") localStorage.setItem(storageKey, "1");
    if (param === "0") localStorage.removeItem(storageKey);
    return localStorage.getItem(storageKey) === "1";
  } catch {
    // localStorage が使えない環境（プライベートモード等）では、URL の指定だけで判定する
    try {
      return new URLSearchParams(window.location.search).get(queryName) === "1";
    } catch {
      return false;
    }
  }
}

export function isAnalogyFinderEnabled() {
  // 公開後も ?analogy=1/0 の印は読んで覚える（フラグを戻したとき、すぐ内部確認に切り替えられるように）
  const preview = readPreviewFlag("analogy", ANALOGY_FINDER_PREVIEW_KEY);
  return ANALOGY_FINDER_PUBLIC || preview;
}

export function isThinkingAssistEnabled() {
  return (
    THINKING_ASSIST_PUBLIC ||
    readPreviewFlag("assist", THINKING_ASSIST_PREVIEW_KEY)
  );
}
