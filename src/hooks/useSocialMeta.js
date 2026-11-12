import { useEffect, useState } from "react";

// index.htmlに静的定義されているデフォルト値。
// og:title等はReactの宣言的な<meta>ではJS実行後にしか反映されず、
// index.htmlの静的タグと重複／競合するため、DOMを直接書き換えて対応する。
// (description/canonicalは静的定義が無いため宣言的なJSXで問題ない)
const DEFAULT_META = {
  'meta[name="keywords"]':
    "ボートレース,AI分析,過去データ,データサイエンス,無料,データ分析,モーター性能,選手データ,龍神レーダー",
  'meta[property="og:title"]':
    "ボートレースのデータ分析とAI予想が無料｜競艇 龍神レーダー",
  'meta[property="og:description"]':
    "選手成績・モーター・展示・スタートのデータを、過去の実際のレース結果で数えて見える化するボートレースのデータ分析サービス。全24場に対応し、完全無料・登録不要で使えます。",
  'meta[property="og:image"]': "https://www.boat-ai.jp/ogp-image.png",
  'meta[name="twitter:title"]':
    "ボートレースのデータ分析とAI予想が無料｜競艇 龍神レーダー",
  'meta[name="twitter:description"]':
    "選手成績・モーター・展示・スタートのデータを、過去の実際のレース結果で数えて見える化するボートレースのデータ分析サービス。完全無料・登録不要。",
  'meta[name="twitter:image"]': "https://www.boat-ai.jp/ogp-image.png",
};

// 今このフックを使っている部品（描いた順）。DOM には最後に描いた部品の値を出す。
// 以前は effect の中で直接書き換え、離れるときに既定値へ戻していた。effect の走る順が
// 「新しいページの設定→古いページの再設定」になると、URL・<title> は新しいページなのに
// og:title が古いページのまま残った（HR22: /en/venues→/en/venues/heiwajima で、
// og:title が一覧のまま15秒変わらない赤が CI で 11/9〜11/12 に5回。順が入れ替わる経路は
// 手元で再現できず未確定）。描いた順で持てば、effect の順に依らず新しいページが勝つ
const entries = [];
let nextOrder = 0;

function applyTop() {
  const top = entries.reduce(
    (best, e) => (best === null || e.order > best.order ? e : best),
    null,
  );
  Object.entries(DEFAULT_META).forEach(([selector, fallback]) => {
    const value = top?.values[selector];
    document
      .querySelector(selector)
      ?.setAttribute("content", value == null ? fallback : value);
  });
  // og:url は index.html に置かない。値を持つ部品が上にいるときだけ1つ置く
  const url = top?.url;
  let ogUrl = document.querySelector('meta[property="og:url"]');
  if (url == null) {
    ogUrl?.remove();
    return;
  }
  if (!ogUrl) {
    ogUrl = document.createElement("meta");
    ogUrl.setAttribute("property", "og:url");
    document.head.appendChild(ogUrl);
  }
  ogUrl.setAttribute("content", url);
}

/**
 * ページ固有のOGP/Twitterカード/keywordsをindex.htmlの静的タグに反映する。
 * アンマウント時（他ページへの遷移時）はデフォルト値に復元する。
 * 値が null/undefined のフィールドはデフォルト値のまま変更しない。
 * 同時に複数の部品が使っているときは、最後に描いた部品の値を出す。
 *
 * og:url だけは index.html に静的に置かない（BOA-691。トップ固定だと Facebook 等が
 * すべての共有をトップとして扱う）。url を渡されたときにタグを作り、離れるときに消す
 */
export function useSocialMeta({ title, description, url, image, keywords }) {
  // 描いた順は最初の描画で決める（effect の走る順ではなく）
  const [order] = useState(() => nextOrder++);
  useEffect(() => {
    const entry = {
      order,
      url,
      values: {
        'meta[name="keywords"]': keywords,
        'meta[property="og:title"]': title,
        'meta[property="og:description"]': description,
        'meta[property="og:image"]': image,
        'meta[name="twitter:title"]': title,
        'meta[name="twitter:description"]': description,
        'meta[name="twitter:image"]': image,
      },
    };
    entries.push(entry);
    applyTop();
    return () => {
      entries.splice(entries.indexOf(entry), 1);
      applyTop();
    };
  }, [order, title, description, url, image, keywords]);
}
