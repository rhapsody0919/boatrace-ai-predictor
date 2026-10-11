import { useEffect } from "react";

// index.htmlに静的定義されているデフォルト値。
// og:title等はReactの宣言的な<meta>ではJS実行後にしか反映されず、
// index.htmlの静的タグと重複／競合するため、DOMを直接書き換えて対応する。
// (description/canonicalは静的定義が無いため宣言的なJSXで問題ない)
const DEFAULT_META = {
  'meta[name="keywords"]':
    "ボートレース,AI分析,過去データ,データサイエンス,無料,データ分析,モーター性能,選手データ,龍神レーダー",
  'meta[property="og:title"]':
    "龍神レーダー - 無料のボートレースAI予想＆データ分析",
  'meta[property="og:description"]':
    "選手成績・モーター・展示・スタートのデータを、過去の実際のレース結果で数えて見える化するボートレースのデータ分析サービス。全24場に対応し、完全無料・登録不要で使えます。",
  'meta[property="og:image"]': "https://www.boat-ai.jp/ogp-image.png",
  'meta[name="twitter:title"]':
    "龍神レーダー - 無料のボートレースAI予想＆データ分析",
  'meta[name="twitter:description"]':
    "選手成績・モーター・展示・スタートのデータを、過去の実際のレース結果で数えて見える化するボートレースのデータ分析サービス。完全無料・登録不要。",
  'meta[name="twitter:image"]': "https://www.boat-ai.jp/ogp-image.png",
};

/**
 * ページ固有のOGP/Twitterカード/keywordsをindex.htmlの静的タグに反映する。
 * アンマウント時（他ページへの遷移時）はデフォルト値に復元する。
 * 値が null/undefined のフィールドはデフォルト値のまま変更しない。
 *
 * og:url だけは index.html に静的に置かない（BOA-691。トップ固定だと Facebook 等が
 * すべての共有をトップとして扱う）。url を渡されたときにタグを作り、離れるときに消す
 */
export function useSocialMeta({ title, description, url, image, keywords }) {
  useEffect(() => {
    const values = {
      'meta[name="keywords"]': keywords,
      'meta[property="og:title"]': title,
      'meta[property="og:description"]': description,
      'meta[property="og:image"]': image,
      'meta[name="twitter:title"]': title,
      'meta[name="twitter:description"]': description,
      'meta[name="twitter:image"]': image,
    };

    Object.entries(values).forEach(([selector, value]) => {
      if (value == null) return;
      document.querySelector(selector)?.setAttribute("content", value);
    });

    let ogUrl = null;
    if (url != null) {
      ogUrl = document.createElement("meta");
      ogUrl.setAttribute("property", "og:url");
      ogUrl.setAttribute("content", url);
      document.head.appendChild(ogUrl);
    }

    return () => {
      Object.entries(DEFAULT_META).forEach(([selector, value]) => {
        document.querySelector(selector)?.setAttribute("content", value);
      });
      ogUrl?.remove();
    };
  }, [title, description, url, image, keywords]);
}
