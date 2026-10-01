import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import "./HomeAiIntro.css";

/**
 * トップの「龍神レーダーのボートレースAI予想」セクション（集客レーン Phase3、2026-09-29）
 *
 * 「競艇ai予想 無料」等でトップが6〜8位にいるため、何のサイトかを説明する本文と、
 * 成績ページへのリンクをクロールできる形で置く。
 * 的中率・回収率の数値は出さない（2026-10-01 ユーザー判断）。以前は展開予測の実測的中率を出していたが、
 * 決まり手を見ずに判定しており、予想なしの「1〜3号艇のどれかが1着」を下回ることが分かった（BOA-617）。
 * /accuracy・/hit-races は日本語のみのページ（TRANSLATED_PATHS 未登録）。言語プレフィックスを
 * 付けると /en/accuracy → /accuracy のリダイレクトを挟むため、付けずにリンクする。
 */
function HomeAiIntro() {
  const { t } = useTranslation();

  return (
    <section className="home-ai-intro" aria-labelledby="home-ai-intro-title">
      <h2 id="home-ai-intro-title">{t("home.aiIntro.title")}</h2>
      <p>{t("home.aiIntro.lead")}</p>
      <p>{t("home.aiIntro.method")}</p>

      <ul className="home-ai-intro__links">
        <li>
          <Link to="/accuracy">{t("home.aiIntro.accuracyLink")}</Link>
        </li>
        <li>
          <Link to="/hit-races">{t("home.aiIntro.hitRacesLink")}</Link>
        </li>
      </ul>
    </section>
  );
}

export default HomeAiIntro;
