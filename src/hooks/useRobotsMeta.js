import { useEffect } from "react";

// index.htmlに静的定義されているデフォルト値。useSocialMeta.jsと同じ理由
// （宣言的な<meta>では静的タグと重複し、後勝ちの保証が無いため）でDOMを直接書き換える。
const DEFAULT_ROBOTS_CONTENT =
  "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";
const SELECTOR = 'meta[name="robots"]';

/**
 * ページ固有の noindex 指定を index.html の静的 robots タグに反映する。
 * アンマウント時（他ページへの遷移時）はデフォルト値に復元する。
 * @param {boolean} noindex trueの場合 "noindex, follow" を設定する
 */
export function useRobotsMeta(noindex) {
  useEffect(() => {
    if (noindex) {
      document
        .querySelector(SELECTOR)
        ?.setAttribute("content", "noindex, follow");
    }
    return () => {
      document
        .querySelector(SELECTOR)
        ?.setAttribute("content", DEFAULT_ROBOTS_CONTENT);
    };
  }, [noindex]);
}
