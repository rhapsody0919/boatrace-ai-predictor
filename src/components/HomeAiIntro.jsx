import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  buildFaqItems,
  isAssistShown,
  toFaqPageLd,
} from "../utils/homeAiIntroFaq.js";
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
 *
 * 「レースを開いたら、この2つで確かめる」（SEO 施策 B1、2026-10-11 ユーザー承認のモック）:
 * 検索から初めて来た人が、龍神ソナー・思考アシストで何が分かり、どう開けばよいかを読めるようにする。
 * 思考アシストの切り替えはレース詳細で ja のときだけ出る（RaceDetailPage の showViewSwitch）ので、
 * そのカードと操作の文は ja だけで出す
 *
 * 短文とよくある質問（SEO 施策 A2、2026-10-12 オーナー承認の原稿）:
 * 答えは <details> の中に置き、閉じていても DOM にある。FAQPage の JSON-LD は、画面に出す問いと答えの
 * 文字列（faqItems）からそのまま作り、画面と食い違わないようにする。
 * 思考アシストに触れる問い・答えは、ja 以外では龍神ソナーだけの言い方（*SonarOnly）に替える。
 * 問い・答えと JSON-LD を組む関数は src/utils/homeAiIntroFaq.js に置き、ボット向け HTML
 * （api/_lib/botPage.js の renderTopHtml）と共有する。ボット向けトップはこのセクションの文言を
 * 同じ i18n のキーで出す（src/utils/botPageModel.js の buildTopModel）。ここで文言・キーを変えたら、
 * あちらも合わせる（照合 verify-bot-html-parity.js が食い違いを見つける）
 */
function HomeAiIntro() {
  const { t, i18n } = useTranslation();
  const showAssist = isAssistShown(i18n.resolvedLanguage);
  const faqItems = buildFaqItems(t, showAssist);

  return (
    <section className="home-ai-intro" aria-labelledby="home-ai-intro-title">
      <h2 id="home-ai-intro-title">{t("home.aiIntro.title")}</h2>
      <p>{t("home.aiIntro.lead")}</p>
      <p>{t("home.aiIntro.method")}</p>
      <p className="home-ai-intro__tools-intro">
        {showAssist
          ? t("home.aiIntro.toolsIntro")
          : t("home.aiIntro.toolsIntroSonarOnly")}
      </p>

      <div className="home-ai-intro__check">
        <h3>{t("home.aiIntro.checkTitle")}</h3>
        <div className="home-ai-intro__tools">
          <div className="home-ai-intro__tool">
            <p className="home-ai-intro__tool-name">{t("raceTabs.sonar")}</p>
            <p className="home-ai-intro__tool-where">
              {t("home.aiIntro.sonarWhere")}
            </p>
            <ul>
              <li>{t("home.aiIntro.sonarQ1")}</li>
              <li>{t("home.aiIntro.sonarQ2")}</li>
            </ul>
          </div>
          {showAssist && (
            <div className="home-ai-intro__tool">
              <p className="home-ai-intro__tool-name">
                {t("raceDetailPage.assistSwitch.assist")}
              </p>
              <p className="home-ai-intro__tool-where">
                {t("home.aiIntro.assistWhere")}
              </p>
              <ul>
                <li>{t("home.aiIntro.assistQ1")}</li>
                <li>{t("home.aiIntro.assistQ2")}</li>
              </ul>
            </div>
          )}
        </div>
        <ol className="home-ai-intro__steps">
          <li>{t("home.aiIntro.step1")}</li>
          <li>{t("home.aiIntro.step2", { button: t("raceCard.view") })}</li>
          <li>
            {showAssist
              ? t("home.aiIntro.step3")
              : t("home.aiIntro.step3SonarOnly")}
          </li>
        </ol>
        <a className="home-ai-intro__venues-link" href="#today-venues">
          {t("home.aiIntro.venuesLink")}
        </a>
        <p className="home-ai-intro__note">{t("home.aiIntro.disclaimer")}</p>
      </div>

      <ul className="home-ai-intro__links">
        <li>
          <Link to="/accuracy">{t("home.aiIntro.accuracyLink")}</Link>
        </li>
        <li>
          <Link to="/hit-races">{t("home.aiIntro.hitRacesLink")}</Link>
        </li>
      </ul>

      <div className="home-ai-intro__faq">
        <h3>{t("home.aiIntro.faqTitle")}</h3>
        {faqItems.map(({ question, answer }) => (
          <details key={question} className="home-ai-intro__faq-item">
            <summary>{question}</summary>
            <p>{answer}</p>
          </details>
        ))}
        <script type="application/ld+json">
          {JSON.stringify(toFaqPageLd(faqItems))}
        </script>
      </div>
    </section>
  );
}

export default HomeAiIntro;
