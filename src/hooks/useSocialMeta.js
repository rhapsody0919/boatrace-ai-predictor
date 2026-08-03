import { useEffect } from "react";

// index.htmlに静的定義されているデフォルト値。
// og:title等はReactの宣言的な<meta>ではJS実行後にしか反映されず、
// index.htmlの静的タグと重複／競合するため、DOMを直接書き換えて対応する。
// (description/canonicalは静的定義が無いため宣言的なJSXで問題ない)
const DEFAULT_META = {
  'meta[name="keywords"]':
    "ボートレース,AI分析,予測精度,データサイエンス,無料,データ分析,モーター性能,選手データ,BoatAI",
  'meta[property="og:title"]':
    "BoatAI - AIボートレース予想 | 完全無料・実績公開中",
  'meta[property="og:description"]':
    "45項目のデータをAIが分析するボートレース予測サービス。高精度なレース展開分析を完全無料・登録不要で今すぐ使えます。",
  'meta[property="og:url"]': "https://www.boat-ai.jp/",
  'meta[property="og:image"]': "https://www.boat-ai.jp/ogp-image.png",
  'meta[name="twitter:title"]':
    "BoatAI - AIボートレース予想 | 完全無料・実績公開中",
  'meta[name="twitter:description"]':
    "45項目のデータをAIが分析するボートレース予測サービス。高精度なレース展開分析を完全無料で提供。",
  'meta[name="twitter:image"]': "https://www.boat-ai.jp/ogp-image.png",
};

/**
 * ページ固有のOGP/Twitterカード/keywordsをindex.htmlの静的タグに反映する。
 * アンマウント時（他ページへの遷移時）はデフォルト値に復元する。
 * 値が null/undefined のフィールドはデフォルト値のまま変更しない。
 */
export function useSocialMeta({ title, description, url, image, keywords }) {
  useEffect(() => {
    const values = {
      'meta[name="keywords"]': keywords,
      'meta[property="og:title"]': title,
      'meta[property="og:description"]': description,
      'meta[property="og:url"]': url,
      'meta[property="og:image"]': image,
      'meta[name="twitter:title"]': title,
      'meta[name="twitter:description"]': description,
      'meta[name="twitter:image"]': image,
    };

    Object.entries(values).forEach(([selector, value]) => {
      if (value == null) return;
      document.querySelector(selector)?.setAttribute("content", value);
    });

    return () => {
      Object.entries(DEFAULT_META).forEach(([selector, value]) => {
        document.querySelector(selector)?.setAttribute("content", value);
      });
    };
  }, [title, description, url, image, keywords]);
}
