import Header from "../components/Header";
import Footer from "../components/Footer";
import "./ContentHub.css";
import { buildCollectionJsonLd } from "./ContentHubLogic";
import {
  BeginnerSection,
  StrategySection,
  DataSection,
} from "./ContentHubArticleSections";
import { VenueSection } from "./ContentHubVenueSection";
import { CtaSection } from "./ContentHubCtaSection";

function ContentHub() {
  return (
    <>
      <title>
        ボートレースのルール・買い方 完全ガイド【24会場攻略】| 龍神レーダー
      </title>
      <meta
        name="description"
        content="ボートレースのルール・買い方から24会場の攻略法、データ分析手法、予想のコツまで体系的に解説する完全ガイド。初心者から上級者まで学べます。"
      />
      <link rel="canonical" href="https://www.boat-ai.jp/guide" />
      <script type="application/ld+json">{buildCollectionJsonLd()}</script>

      <Header />

      <div className="content-hub-page">
        <div className="content-hub-container">
          {/* ヘッダーセクション */}
          <header className="hub-header">
            <h1>ボートレース完全ガイド</h1>
            <p className="hub-lead">
              初心者から上級者まで、ボートレースで勝つために必要な知識を体系的に学べます
            </p>
          </header>

          {/* 初心者向けセクション */}
          <BeginnerSection />

          {/* 戦略セクション */}
          <StrategySection />

          {/* 会場攻略セクション */}
          <VenueSection />

          {/* データ分析セクション */}
          <DataSection />

          {/* CTAセクション */}
          <CtaSection />
        </div>
      </div>

      <Footer
        links={[
          { to: "/blog", label: "ブログ一覧" },
          { to: "/about", label: "About" },
          { to: "/faq", label: "FAQ" },
          { to: "/privacy", label: "プライバシーポリシー" },
        ]}
      />
    </>
  );
}

export default ContentHub;
