/**
 * HreflangTags - 全ページ共通の hreflang 代替リンクを出力
 * そのページが提供されている言語分の代替 URL を検索エンジンに伝える
 * （デフォルト言語はプレフィックスなし、それ以外は /{code} プレフィックス）。
 * 値は getHreflangAlternates（sitemap・ボット向け HTML と同じ関数）で組む。
 * 1言語でしか提供されていないページは代替が存在しないため何も出さない（canonical は各ページが設定）
 *
 * React 19 のネイティブ head ホイスティングを使用（react-helmet-async は
 * React 19 で link/meta タグが出力されないため使わない）
 */
import { useLocation } from "react-router-dom";
import { parseLangFromPath, getHreflangAlternates } from "../config/languages";

const SITE_URL = "https://www.boat-ai.jp";

function HreflangTags() {
  const { pathname } = useLocation();
  // 言語プレフィックスを除いた基準パス
  const { basePath } = parseLangFromPath(pathname);

  return (
    <>
      {getHreflangAlternates(basePath, SITE_URL).map(({ hreflang, href }) => (
        <link key={hreflang} rel="alternate" hrefLang={hreflang} href={href} />
      ))}
    </>
  );
}

export default HreflangTags;
