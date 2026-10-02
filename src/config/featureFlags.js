/**
 * 公開前の機能の表示切り替え。
 *
 * アナロジー・ファインダー（BOA-271）の寄与度の節は、master に入れたうえで公開までは隠す
 * （2026-10-02 ユーザー判断）。公開するときは ANALOGY_FINDER_PUBLIC を true にするだけでよい。
 * 隠している間も、本番で内部確認できるように次のどちらかで表示できる:
 *   - URL に ?analogy=1 を付けて開く（端末に覚える。?analogy=0 で忘れる）
 *   - localStorage の ANALOGY_FINDER_PREVIEW_KEY を "1" にする
 * 隠している間は節を描かないので、寄与度の API も呼ばない（DB への問い合わせは無い）。
 * キーは boatai-user: 接頭辞（キャッシュの全削除で消えないユーザー保存の名前空間）。
 */
export const ANALOGY_FINDER_PUBLIC = false;
export const ANALOGY_FINDER_PREVIEW_KEY = "boatai-user:analogy-finder-preview";

function readPreviewFlag() {
  try {
    const param = new URLSearchParams(window.location.search).get("analogy");
    if (param === "1") localStorage.setItem(ANALOGY_FINDER_PREVIEW_KEY, "1");
    if (param === "0") localStorage.removeItem(ANALOGY_FINDER_PREVIEW_KEY);
    return localStorage.getItem(ANALOGY_FINDER_PREVIEW_KEY) === "1";
  } catch {
    // localStorage が使えない環境（プライベートモード等）では、URL の指定だけで判定する
    try {
      return new URLSearchParams(window.location.search).get("analogy") === "1";
    } catch {
      return false;
    }
  }
}

export function isAnalogyFinderEnabled() {
  return ANALOGY_FINDER_PUBLIC || readPreviewFlag();
}
