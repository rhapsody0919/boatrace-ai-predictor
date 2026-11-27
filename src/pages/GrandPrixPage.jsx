import { Link } from "react-router-dom";
import Header from "../components/Header";
import Breadcrumb from "../components/Breadcrumb";
import {
  AdvanceFlow,
  Countdown,
  PastFinalCards,
  PrizeBars,
  VenueVsNational,
} from "../components/meet/GrandPrixCharts";
import { DAYS, EDITION, FAQ, FLOW, PAST_FINALS, PRIZE_RANKING } from "../data/grandPrixFeature.js";
import { grandPrixPhase } from "../pure/grandPrixPhase.js";
import { getTodayJST } from "../utils/dateUtils";
import { VENUE_SUMMARY_STATS } from "../data/venueSummaryStats.js";
import "./GrandPrixPage.css";

// グランプリの特集（/grandprix、ja 専用、BOA-1724）。年なしの永続の URL に毎年積む（seo-marketer 審査 2026-11-27）。
// 見せ方はオーナーが承認した見本2（2026-11-27）。データはこの入口で読み、図の部品には props で渡す。
// 節のページはグランプリを対象外にしている（utils/meetPageModel.js の OUT_OF_SCOPE_TITLE）ので、つなぐ先は会場ページ。
// 展開予測（AI タブ）は廃止の方針なので、つながない
const { year, venueName, venueCode } = EDITION;
const TITLE = `競艇グランプリ${year}特集｜${venueName}${EDITION.shortDates}の日程・トライアルの仕組み・過去の優勝戦｜龍神レーダー`;
const DESCRIPTION = `競艇（ボートレース）のグランプリ（SG）${year}の出場18人の獲得賞金、トライアル1st・2ndから優勝戦までの勝ち上がり、${venueName}のコース別の1着率、過去の優勝戦、6日間の日程をまとめた特集です。`;
const SUMMARY_PERIOD = `${VENUE_SUMMARY_STATS.from.replaceAll("-", "/")}〜${VENUE_SUMMARY_STATS.to.replaceAll("-", "/")}`;
const VENUE_STATS = VENUE_SUMMARY_STATS.venues[String(venueCode)];
// 答えの1行は会場の要約の向き（月1回の更新で変わりうる）から組む。差がはっきりしない項目は言わない
const RATE = { higher: "高い", lower: "低い" };
const SHARE = { higher: "多い", lower: "少ない" };
const WATER_ANSWER = [
  VENUE_STATS.vsNational.course1 && `1コースの1着率は全国より${RATE[VENUE_STATS.vsNational.course1]}`,
  VENUE_STATS.vsNational.makuri && `まくりは全国より${SHARE[VENUE_STATS.vsNational.makuri]}`,
]
  .filter(Boolean)
  .join("、");
const RELATED = [
  ["/blog/sg-race-guide-2026", "2026年SGレースの日程と会場"],
  ["/blog/omura-wind-direction-guide", "大村の水面と風（風の向き別の1着率）"],
  ["/blog/sg-g1-race-strategy", "G1レースの予想のコツ（得点率と勝負駆け）"],
];

const faqLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map(({ q, a }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: a },
  })),
};

const External = ({ href, children }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {children}
  </a>
);

function Section({ id, title, answer, children }) {
  return (
    <section className="gp-section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {answer && <p className="gp-answer">{answer}</p>}
      {children}
    </section>
  );
}

/** 出場18人と獲得賞金。確定（11/29 の後）の値が入るまで棒を出さない */
function PrizeSection() {
  return (
    <Section
      id="gp-prize-h"
      title="出場18人と獲得賞金"
      answer={PRIZE_RANKING.confirmed ? `1位は${PRIZE_RANKING.racers[0].name}。2ndから出る6人と1stから出る12人` : null}
    >
      {PRIZE_RANKING.confirmed ? (
        <>
          <PrizeBars racers={PRIZE_RANKING.racers} />
          <p className="gp-note">
            獲得賞金は<External href="https://www.boatrace-grandprix.jp/">グランプリの特設サイト</External>の
            {PRIZE_RANKING.asOf.slice(5).replace("-", "/")}現在の値です（万円未満は四捨五入）。
          </p>
        </>
      ) : (
        <p>
          出場の18人は、チャレンジカップ（11月29日まで）の後に公式から発表されます。決まりしだい、獲得賞金の図を載せます。
        </p>
      )}
    </Section>
  );
}

export default function GrandPrixPage() {
  return (
    <>
      <title>{TITLE}</title>
      <meta name="description" content={DESCRIPTION} />
      <link rel="canonical" href="https://www.boat-ai.jp/grandprix" />
      <script type="application/ld+json">{JSON.stringify(faqLd)}</script>
      <Header />
      <main className="gp-page">
        <Breadcrumb
          items={[
            { name: "ホーム", url: "/" },
            { name: "グランプリ特集", url: "/grandprix" },
          ]}
        />
        <header className="gp-head">
          <span className="gp-badge">SG</span>
          <h1>
            ボートレース グランプリ{year} 特集（{venueName} {EDITION.longDates}）
          </h1>
          <Countdown
            phase={grandPrixPhase(getTodayJST(), EDITION)}
            openLabel={EDITION.shortDates.split("〜")[0]}
          />
          <p>年間の獲得賞金の上位18人が出場する、1年の総決算の大会です。</p>
          <p className="gp-strong">
            <Link to={`/venue/${venueCode}`}>{venueName}の会場ページ（その日の出走表）→</Link>
          </p>
        </header>
        <PrizeSection />
        <Section id="gp-flow-h" title="勝ち上がり" answer="18人から、6日間で優勝戦の6人にしぼられる">
          <AdvanceFlow stages={FLOW} />
          <p className="gp-note">
            出典は大村の特設サイトの<External href={EDITION.roadToFinalUrl}>グランプリの勝ち上がりチャート</External>です。
          </p>
        </Section>
        <Section id="gp-water-h" title={`${venueName}の水面`} answer={WATER_ANSWER || null}>
          <VenueVsNational
            venue={VENUE_STATS}
            national={VENUE_SUMMARY_STATS.national}
            period={SUMMARY_PERIOD}
            venueName={venueName}
          />
          <p className="gp-note">
            決まり手は全レースのうちの割合で、1コースの1着率とは別の数字です。{venueName}は海水の水面で干満差があり、通年ナイターの会場です。
          </p>
        </Section>
        <Section id="gp-past-h" title="過去の優勝戦">
          <PastFinalCards finals={PAST_FINALS} />
          <p className="gp-note">
            2021〜2023年はグランプリの特設サイト、2024・2025年は公式のレース結果で確かめた値です。2024・2025年は公式の結果に進入の列が無いため、枠番だけを載せています。
          </p>
        </Section>
        <Section id="gp-days-h" title="日程（6日間）">
          <ol className="gp-days">
            {DAYS.map((d) => (
              <li key={d.date}>
                <span className="gp-strong">{d.date}</span>
                <span className="gp-sub">{d.label}</span>
                <span>{d.stage}</span>
                <span className="gp-sub gp-day-body">{d.body}</span>
              </li>
            ))}
          </ol>
        </Section>
        <Section id="gp-faq-h" title="よくある質問">
          {FAQ.map(({ q, a }) => (
            <div key={q} className="gp-faq">
              <h3>{q}</h3>
              <p>{a}</p>
            </div>
          ))}
        </Section>
        <Section id="gp-links-h" title="あわせて読む">
          <ul className="gp-links">
            {RELATED.map(([to, label]) => (
              <li key={to}>
                <Link to={to}>{label}</Link>
              </li>
            ))}
          </ul>
        </Section>
        <Section id="gp-caution-h" title="ご注意">
          <p className="gp-note gp-disclaimer">
            日程は<External href={EDITION.scheduleUrl}>BOAT RACE公式のグレードレース日程</External>
            （2026年11月27日に確認）によります。順延・中止で変わることがあるため、当日の開催は公式サイトで確認してください。龍神レーダーのAIの予想とデータは参考の情報で、結果を保証するものではありません。舟券の投票は、日本国内に住む20歳以上の方だけができます。
          </p>
        </Section>
      </main>
    </>
  );
}
