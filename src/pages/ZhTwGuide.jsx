/**
 * ZhTwGuide - 繁体字中国語圏（台湾・香港）の初心者向けボートレース入門ガイド（/zh-TW/guide）
 * EnglishGuide の繁体字版。スタイルは EnglishGuide.css を共用
 */
import { Link } from "react-router-dom";
import Header from "../components/Header";
import "./EnglishGuide.css";

const TECHNIQUES = [
  {
    name: "逃走",
    kanji: "逃げ（Nige）",
    desc: "1號艇守住最內側航道，在第一轉彎標率先過彎。最常見的獲勝方式 — 這也是1號艇通常是大熱門的原因。",
  },
  {
    name: "切入",
    kanji: "差し（Sashi）",
    desc: "在第一轉彎從對手內側切入超越。當1號艇過彎偏大時，2號艇常用這招獲勝。",
  },
  {
    name: "外攻",
    kanji: "まくり（Makuri）",
    desc: "外側艇全速從領先艇外圍強行超越。3、4號艇的強力武器。",
  },
  {
    name: "外攻切入",
    kanji: "まくり差し（Makuri-zashi）",
    desc: "複合技：先從外側壓制部分對手，再切入其他艇的內側。4-6號艇的精彩絕技，往往帶來高派彩。",
  },
  {
    name: "超越",
    kanji: "抜き（Nuki）",
    desc: "在第一轉彎標之後的賽段中超越領先艇。",
  },
  {
    name: "幸運勝出",
    kanji: "恵まれ（Megumare）",
    desc: "因領先艇碰撞或違規出局而獲勝。",
  },
];

const BET_TYPES = [
  { name: "單勝", pick: "猜中第1名的艇", difficulty: "★" },
  { name: "複勝", pick: "猜中進入前2名的其中1艘艇", difficulty: "★" },
  { name: "2連單", pick: "按正確順序猜中第1、2名", difficulty: "★★" },
  { name: "2連複", pick: "猜中前2名（順序不限）", difficulty: "★★" },
  { name: "3連複", pick: "猜中前3名（順序不限）", difficulty: "★★★" },
  {
    name: "3連單",
    pick: "按正確順序猜中第1、2、3名 — 高派彩的主流玩法",
    difficulty: "★★★★",
  },
];

const MODELS = [
  {
    icon: "🎯",
    name: "穩健型",
    desc: "跟隨最有可能的比賽展開。適合想穩定命中的你。",
  },
  {
    icon: "⚖️",
    name: "標準型",
    desc: "根據第二可能的展開做出平衡選擇。",
  },
  {
    icon: "🌪️",
    name: "冷門型",
    desc: "瞄準第三可能展開帶來的高派彩。適合混戰賽事。",
  },
];

export default function ZhTwGuide() {
  return (
    <div className="app">
      <title>什麼是日本賽艇（Kyotei）？規則與投注入門指南 | 龍神雷達</title>
      <meta
        name="description"
        content="日本賽艇（BOAT RACE / Kyotei）新手完全指南：比賽規則、獲勝方式、投注玩法，以及如何看懂龍神雷達的免費 AI 預測。"
      />
      <link rel="canonical" href="https://www.boat-ai.jp/zh-TW/guide" />

      <Header />

      <div className="eg-container">
        {/* Hero */}
        <section className="eg-hero">
          <h1>🚤 什麼是日本賽艇（Kyotei）？</h1>
          <p className="eg-hero-lead">
            日本賽艇（BOAT RACE，日文稱 Kyotei）是日本四大公營競技之一， 全國 24
            個賽場幾乎每天都有比賽。6 艘水上滑行艇繞行 600 公尺水道 3
            圈一決勝負，觀眾可以合法投注比賽結果。
            這份指南帶你從零開始，一路學到像行家一樣看懂 AI 預測。
          </p>
        </section>

        {/* Quick facts */}
        <section className="eg-section">
          <h2>⚡ 快速認識</h2>
          <div className="eg-facts-grid">
            <div className="eg-fact">
              <strong>6 艘艇</strong>
              <span>每場比賽 1-6 號艇，顏色固定</span>
            </div>
            <div className="eg-fact">
              <strong>3 圈 / 1,800m</strong>
              <span>繞行 600 公尺水道</span>
            </div>
            <div className="eg-fact">
              <strong>約 1 分 50 秒</strong>
              <span>比賽短暫而激烈</span>
            </div>
            <div className="eg-fact">
              <strong>24 個賽場</strong>
              <span>從東邊的桐生到西邊的大村</span>
            </div>
            <div className="eg-fact">
              <strong>飛行式起跑</strong>
              <span>通過起跑線時艇已在高速行進中</span>
            </div>
            <div className="eg-fact">
              <strong>彩池分配制</strong>
              <span>賠率由投注總額決定，與賽馬相同</span>
            </div>
          </div>
        </section>

        {/* The key concept */}
        <section className="eg-section eg-highlight">
          <h2>🔑 最重要的一件事：1號位的勝率約五成</h2>
          <p>
            和多數競速運動不同，賽艇的起跑位置優勢非常巨大。從
            <strong>
              1號位（最內側航道）出發的艇，全國平均約有 50% 的機率獲勝
            </strong>
            — 因為它在第一個轉彎標能走最短路線。
          </p>
          <p>
            賽艇預測幾乎都圍繞著同一個問題：
            <strong>1號位能守住嗎？還是會被誰擊敗？</strong>
            龍神雷達的「1號位失守指數」正是為每場比賽量化這件事。
          </p>
        </section>

        {/* Winning techniques */}
        <section className="eg-section">
          <h2>🥇 6 種獲勝方式（決まり手）</h2>
          <p>
            每一場勝利都會依「如何獲勝」被官方分類。 記住這 6
            個詞，就能看懂日文賽事實況和龍神雷達的預測。
          </p>
          <div className="eg-technique-list">
            {TECHNIQUES.map((t) => (
              <div key={t.name} className="eg-technique">
                <div className="eg-technique-name">
                  <strong>{t.name}</strong>{" "}
                  <span className="eg-kanji">{t.kanji}</span>
                </div>
                <p>{t.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Racer classes */}
        <section className="eg-section">
          <h2>🏅 選手級別</h2>
          <p>
            全日本約 1,600 名職業選手分為四個級別，每半年重新評級一次。
            級別是預測表現的重要依據：
          </p>
          <ul className="eg-list">
            <li>
              <strong>A1</strong> — 頂尖菁英（前 20% 左右）。A1
              選手搭配1號位是最強熱門。
            </li>
            <li>
              <strong>A2</strong> — 實力堅強的資深選手。
            </li>
            <li>
              <strong>B1</strong> — 佔多數的中堅選手。
            </li>
            <li>
              <strong>B2</strong> — 新人與排名較後的選手。
            </li>
          </ul>
          <p className="eg-note">
            女子選手與男子選手同場競技 — 賽艇是少數男女直接對決的運動之一。
          </p>
        </section>

        {/* Betting types */}
        <section className="eg-section">
          <h2>🎫 投注玩法</h2>
          <div className="eg-table-wrapper">
            <table className="eg-table">
              <thead>
                <tr>
                  <th>玩法</th>
                  <th>投注內容</th>
                  <th>難度</th>
                </tr>
              </thead>
              <tbody>
                {BET_TYPES.map((b) => (
                  <tr key={b.name}>
                    <td>
                      <strong>{b.name}</strong>
                    </td>
                    <td>{b.pick}</td>
                    <td>{b.difficulty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="eg-note">
            3連單是最受歡迎的玩法 — 每注 ¥100 的平均派彩約
            ¥7,000，大爆冷時甚至超過 ¥100,000。
          </p>
        </section>

        {/* How to read boatAI */}
        <section className="eg-section">
          <h2>🤖 如何看懂龍神雷達的預測</h2>
          <p>
            龍神雷達為每場比賽分析 45 項數據 —
            選手成績、馬達性能、賽場特性、起跑時機等 — 並清楚呈現每個選擇的
            <strong>理由</strong>。完全免費。
          </p>
          <ol className="eg-steps">
            <li>
              在<Link to="/zh-TW/">首頁</Link>
              <strong>選擇賽場和場次</strong>
              。每張賽事卡片都顯示投注截止時間與預測預覽。
            </li>
            <li>
              <strong>選擇符合你風格的預測模型</strong>：
              <div className="eg-models">
                {MODELS.map((m) => (
                  <div key={m.name} className="eg-model">
                    <span className="eg-model-icon">{m.icon}</span>
                    <strong>{m.name}</strong>
                    <p>{m.desc}</p>
                  </div>
                ))}
              </div>
            </li>
            <li>
              <strong>查看1號位失守指數</strong> —
              數值高代表容易爆冷（派彩更高、命中率更低）。
            </li>
            <li>
              <strong>觀看第一轉彎標動畫</strong> —
              以視覺化模擬呈現決定勝負的第一個轉彎最可能如何展開，並附各展開的機率。
            </li>
            <li>
              <strong>閱讀關鍵數據卡</strong> —
              每艘推薦艇背後的主要統計依據（起跑時機排名、馬達強度、當地勝率）。
            </li>
          </ol>
        </section>

        {/* Venue guides */}
        <section className="eg-section">
          <h2>🏟️ 親臨賽場體驗</h2>
          <p>
            現場觀看賽艇既便宜（入場費 ¥100）又難忘。
            我們為旅客最容易抵達的賽場準備了繁體中文賽場指南 —
            包括羽田機場附近的平和島，以及大阪住之江的夜間賽。
          </p>
          <p>
            <Link to="/zh-TW/venues">→ 瀏覽賽場指南</Link>
          </p>
        </section>

        {/* Legal disclaimer */}
        <section className="eg-section eg-disclaimer">
          <h2>⚖️ 重要：投注資格</h2>
          <ul className="eg-list">
            <li>
              投注日本賽艇僅限透過日本官方管道（賽場及官方 TELEBOAT
              服務），且必須<strong>人在日本境內</strong>並
              <strong>年滿 20 歲</strong>。
            </li>
            <li>
              龍神雷達僅提供<strong>資訊與 AI 分析</strong>
              。本站不受理投注，預測也不保證任何結果。
            </li>
            <li>
              請理性投注。詳見
              <Link to="/zh-TW/responsible-gambling">負責任博彩</Link>頁面。
            </li>
          </ul>
        </section>

        {/* CTA */}
        <section className="eg-cta">
          <h2>準備好見識 AI 的實力了嗎？</h2>
          <Link to="/zh-TW/" className="eg-cta-button">
            🏁 查看今日免費預測
          </Link>
        </section>
      </div>
    </div>
  );
}
