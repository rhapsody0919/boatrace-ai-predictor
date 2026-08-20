import { useState } from "react";
import Header from "../components/Header";
import Footer from "../components/Footer";
import {
  HolmesSherlock,
  HolmesWatson,
  HolmesAdler,
  HolmesMycroft,
  HolmesMoriarty,
} from "../components/holmes";
import "./Holmes.css";

const TABS = [
  {
    key: "sherlock",
    label: "🔍 シャーロック",
    color: "#059669",
    Component: HolmesSherlock,
  },
  {
    key: "watson",
    label: "🩺 ワトソン",
    color: "#0284c7",
    Component: HolmesWatson,
  },
  {
    key: "adler",
    label: "💎 アドラー",
    color: "#9333ea",
    Component: HolmesAdler,
  },
  {
    key: "mycroft",
    label: "🏛️ マイクロフト",
    color: "#ca8a04",
    Component: HolmesMycroft,
  },
  {
    key: "moriarty",
    label: "🎩 モリアーティ",
    color: "#1f2937",
    Component: HolmesMoriarty,
  },
];

function Holmes() {
  const [activeTab, setActiveTab] = useState("sherlock");

  const ActiveComponent =
    TABS.find((t) => t.key === activeTab)?.Component || HolmesSherlock;

  return (
    <div className="holmes-page">
      <>
        <title>ホームズ予想 (α版) - 龍神レーダー</title>
        <meta name="robots" content="noindex, nofollow" />
        <meta
          name="description"
          content="機械学習・深層学習による次世代予想モデルの実験ページ（α版）"
        />
      </>

      <Header />

      <main className="holmes-content">
        <div className="holmes-container">
          <header className="holmes-hero">
            <div className="holmes-alpha-banner">
              🧪 α版 - 開発中のため動線は非公開です
            </div>
            <h1 className="holmes-title">🕵️ ホームズ予想</h1>
            <p className="holmes-subtitle">
              機械学習・深層学習による次世代予想モデルの実験場
            </p>
          </header>

          <nav
            className="holmes-tabs"
            role="tablist"
            aria-label="予想モデル選択"
          >
            {TABS.map((tab) => {
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  role="tab"
                  aria-selected={isActive}
                  className={`holmes-tab ${isActive ? "active" : ""}`}
                  style={
                    isActive
                      ? {
                          background: tab.color,
                          borderColor: tab.color,
                          color: "#fff",
                        }
                      : undefined
                  }
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          <div className="holmes-tab-panel" role="tabpanel">
            <ActiveComponent />
          </div>

          <section className="holmes-info">
            <h2>このページについて</h2>
            <div className="holmes-info-grid">
              <div className="holmes-info-card">
                <h3>📍 位置づけ</h3>
                <p>
                  既存の3モデル（スタンダード／本命狙い／穴狙い）は手動チューニングのヒューリスティックです。このページは、その先を見据えた機械学習・深層学習モデルの実装と評価のための実験場です。
                </p>
              </div>
              <div className="holmes-info-card">
                <h3>🧭 5 人の探偵</h3>
                <p>
                  シャーロック・ホームズの世界観から名前を借り、各モデルの個性を表現しています。それぞれ独立した手法で同じデータに挑み、最終的にどのアプローチが最も勝てるかを定量比較します。シャーロック（統計モデル）とモリアーティ（賭け方最適化）は実装済みで、実データで稼働中です。
                </p>
              </div>
              <div className="holmes-info-card">
                <h3>⚠️ 注意</h3>
                <p>
                  ワトソン・アドラー・マイクロフトのタブはダミーデータです。実モデルの統合は順次行われます。ヘッダーからの導線は意図的に非公開とし、URL
                  直叩きでのみアクセス可能です。
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>

      <Footer copyrightText="© 2025 龍神レーダー - ホームズ予想 α版" />
    </div>
  );
}

export default Holmes;
