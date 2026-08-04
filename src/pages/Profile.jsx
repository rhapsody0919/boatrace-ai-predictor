import React from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import { useSocialMeta } from "../hooks/useSocialMeta";
import "./Profile.css";

const TITLE = "運営者プロフィール | BoatAI";
const DESCRIPTION =
  "BoatAI運営者「らぷそでぃ」のプロフィール。インフラエンジニアとしての経験を活かし、ボートレースAI予想サービスを開発した経緯と開発の裏話をご紹介します。";

export default function Profile() {
  const navigate = useNavigate();

  useSocialMeta({
    title: TITLE,
    description: DESCRIPTION,
    url: "https://www.boat-ai.jp/profile",
    keywords: "BoatAI,運営者,プロフィール,らぷそでぃ,インフラエンジニア,AI開発",
  });

  return (
    <>
      <title>{TITLE}</title>
      <meta name="description" content={DESCRIPTION} />
      <link rel="canonical" href="https://www.boat-ai.jp/profile" />

      {/* Person Schema */}
      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "ProfilePage",
          mainEntity: {
            "@type": "Person",
            name: "らぷそでぃ",
            jobTitle: "インフラエンジニア",
            description: "BoatAI開発者",
            url: "https://www.boat-ai.jp/profile",
            sameAs: ["https://x.com/kyouteiboatai"],
          },
        })}
      </script>

      {/* BreadcrumbList */}
      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            {
              "@type": "ListItem",
              position: 1,
              name: "ホーム",
              item: "https://www.boat-ai.jp/",
            },
            {
              "@type": "ListItem",
              position: 2,
              name: "運営者プロフィール",
              item: "https://www.boat-ai.jp/profile",
            },
          ],
        })}
      </script>

      <Header />

      <div className="profile-container">
        <div className="profile-header">
          <h1>運営者プロフィール</h1>
          <p>BoatAIを作った人について</p>
        </div>

        {/* プロフィールカード */}
        <section className="profile-card-section">
          <div className="profile-card">
            <div className="profile-image">
              <div className="profile-image-placeholder">
                <span>🚤</span>
              </div>
            </div>
            <div className="profile-info">
              <h2 className="profile-name">らぷそでぃ</h2>
              <p className="profile-title">インフラエンジニア / BoatAI開発者</p>
              <div className="profile-tags">
                <span className="tag">インフラ構築</span>
                <span className="tag">AI/機械学習</span>
                <span className="tag">Python</span>
                <span className="tag">データ分析</span>
              </div>
            </div>
          </div>
        </section>

        {/* 自己紹介 */}
        <section className="profile-section">
          <h2>自己紹介</h2>
          <p>
            はじめまして、らぷそでぃです。普段はインフラエンジニアとして、サーバー構築やクラウド環境の設計・運用を担当しています。
          </p>
          <p>
            ボートレースとの出会いは5年前。最初は「ギャンブルなんて」と思っていましたが、データを分析すればするほど「これは運ではなく、確率と統計の世界だ」と気づきました。エンジニアの性分で「じゃあAIに予想させたらどうなる？」と思い立ち、BoatAIの開発を始めました。
          </p>
        </section>

        {/* なぜBoatAIを作ったか */}
        <section className="profile-section">
          <h2>なぜBoatAIを作ったか</h2>
          <div className="story-timeline">
            <div className="story-item">
              <div className="story-icon">💸</div>
              <div className="story-content">
                <h3>きっかけ：50万円の大負け</h3>
                <p>
                  ボートレースを始めて1年目、「なんとなく」で買い続けた結果、気づけば50万円の損失。通帳を見て愕然としました。「このままじゃダメだ」と思い、過去のレースデータを分析し始めたのが全ての始まりです。
                </p>
              </div>
            </div>
            <div className="story-item">
              <div className="story-icon">💡</div>
              <div className="story-content">
                <h3>開発の動機：高額予想サイトへの怒り</h3>
                <p>
                  藁にもすがる思いで月額3万円の予想サイトに登録。結果は惨敗。「プロの予想」を謳いながら、根拠も透明性もない。怒りを通り越して呆れました。「だったら自分で作ってやる」——その一心でAI開発を始めました。
                </p>
              </div>
            </div>
            <div className="story-item">
              <div className="story-icon">🎁</div>
              <div className="story-content">
                <h3>目指していること：完全無料で本物を届ける</h3>
                <p>
                  高額な予想情報に騙される人を一人でも減らしたい。だからBoatAIは完全無料。的中率も回収率も全て公開。「無料だから適当」ではなく、「無料でも本物」を証明し続けます。
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 失敗談・学び */}
        <section className="profile-section">
          <h2>開発で苦労したこと</h2>
          <div className="lessons-grid">
            <div className="lesson-card">
              <div className="lesson-icon">😱</div>
              <h3>最初のモデルは的中率15%</h3>
              <p>
                「AIなら余裕で当たるでしょ」と思って作った最初のモデル。的中率はまさかの15%。ランダムに選んだ方がマシなレベルでした。現実の厳しさを思い知らされました。
              </p>
            </div>
            <div className="lesson-card">
              <div className="lesson-icon">🔧</div>
              <h3>精度向上との終わりなき戦い</h3>
              <p>
                モデルの精度を1%上げるのに1ヶ月かかることもザラ。特徴量の選定、ハイパーパラメータの調整、過学習との戦い...。今も毎日改善を続けています。
              </p>
            </div>
            <div className="lesson-card">
              <div className="lesson-icon">📊</div>
              <h3>データ収集の地獄</h3>
              <p>
                45項目以上のデータを収集・整理する作業は想像以上に過酷でした。スクレイピング、データクレンジング、欠損値処理...。華やかなAI開発の裏側は地道な作業の連続です。
              </p>
            </div>
          </div>
        </section>

        {/* 経歴・スキル */}
        <section className="profile-section">
          <h2>経歴・スキル</h2>
          <div className="experience-list">
            <div className="experience-item">
              <div className="experience-period">5年</div>
              <div className="experience-content">
                <h3>インフラエンジニア</h3>
                <p>
                  サーバー構築、クラウド環境設計・運用、自動化ツール開発など。大規模システムの安定稼働を支えてきた経験が、BoatAIの安定運用に活きています。
                </p>
              </div>
            </div>
            <div className="experience-item">
              <div className="experience-period">2025年〜</div>
              <div className="experience-content">
                <h3>BoatAI開発・運営</h3>
                <p>
                  機械学習モデルの開発、Webサービスの構築・運用。毎日のデータ更新と予想生成を自動化し、24時間365日稼働するシステムを構築。
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* SNS・連絡先 */}
        <section className="profile-section">
          <h2>SNS・お問い合わせ</h2>
          <div className="social-links">
            <a
              href="https://x.com/kyouteiboatai"
              target="_blank"
              rel="noopener noreferrer"
              className="social-link twitter"
            >
              <span className="social-icon">𝕏</span>
              <span>X (Twitter)</span>
            </a>
          </div>
          <p className="contact-note">
            ご質問やフィードバックは<a href="/contact">お問い合わせページ</a>
            またはXのDMからお気軽にどうぞ。
          </p>
        </section>

        {/* CTA */}
        <section className="profile-cta">
          <h2>BoatAIを試してみる</h2>
          <p>登録不要・完全無料でAI予想を確認できます</p>
          <button onClick={() => navigate("/")} className="cta-button">
            AI予想を見る
          </button>
        </section>
      </div>
    </>
  );
}
