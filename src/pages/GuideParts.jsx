/**
 * GuideParts - 外国語の入門ガイド（EnglishGuide・KoGuide・ZhTwGuide）が共に使う殻: 頁の枠・頭・節・CTA・表・券種の表・決まり手・データの項目・レース詳細のタブの一覧・実例のレースの出走表。
 * 画面の文は各ページから渡す（言語ごとの字は各ページに残す。廃止語の検査 check-deprecated-terms がページを名指しで読むため）
 */
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Header from "../components/Header";
import Footer from "../components/Footer";
import { getSiteFooterLinks } from "../components/siteFooterLinks";

// 実データを使った実例（BOA-250、2026-09-06 住之江11R）の出走表。3つの言語で同じ実レースを使う
const EXAMPLE_RACE_ENTRIES = [
  {
    boat: 1,
    name: "徳増　　秀樹",
    grade: "A1",
    winRate: "6.16",
    localWinRate: "6.59",
    motor2Rate: "32.2%",
  },
  {
    boat: 2,
    name: "近江　　翔吾",
    grade: "A2",
    winRate: "6.49",
    localWinRate: "6.24",
    motor2Rate: "28.2%",
  },
  {
    boat: 3,
    name: "山本　　修一",
    grade: "A2",
    winRate: "5.68",
    localWinRate: "6.62",
    motor2Rate: "38.0%",
  },
  {
    boat: 4,
    name: "佐々木　翔斗",
    grade: "A2",
    winRate: "5.30",
    localWinRate: "5.43",
    motor2Rate: "33.7%",
  },
  {
    boat: 5,
    name: "白水　　勝也",
    grade: "A1",
    winRate: "6.38",
    localWinRate: "6.50",
    motor2Rate: "23.5%",
  },
  {
    boat: 6,
    name: "間庭　　菜摘",
    grade: "B1",
    winRate: "4.67",
    localWinRate: "4.56",
    motor2Rate: "27.8%",
  },
];

/** 頁の枠（title・meta・canonical・頭・本文の入れ物・足）。children が本文の節 */
export function GuidePage({ title, description, canonical, children }) {
  const { t } = useTranslation();

  return (
    <div className="app">
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonical} />

      <Header />

      <div className="eg-container">{children}</div>
      <Footer links={getSiteFooterLinks(t)} />
    </div>
  );
}

/** 頁の頭（h1 と導入の文） */
export function GuideHero({ heading, children }) {
  return (
    <section className="eg-hero">
      <h1>{heading}</h1>
      <p className="eg-hero-lead">{children}</p>
    </section>
  );
}

/** 本文の節（h2 と中身） */
export function GuideSection({ heading, children }) {
  return (
    <section className="eg-section">
      <h2>{heading}</h2>
      {children}
    </section>
  );
}

/** 頁の終わりの CTA（見出しと今日の予想へのボタン） */
export function GuideCta({ to, heading, children }) {
  return (
    <section className="eg-cta">
      <h2>{heading}</h2>
      <Link to={to} className="eg-cta-button">
        {children}
      </Link>
    </section>
  );
}

/** 見出しの行（head は th の断片）と本体の行（children の tr）の表 */
export function GuideTable({ head, children }) {
  return (
    <div className="eg-table-wrapper">
      <table className="eg-table">
        <thead>
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** 券種の表（名・当てる物・難しさ。見出しの字だけ言語ごと） */
export function BetTypesTable({ head, items }) {
  return (
    <GuideTable head={head}>
      {items.map((b) => (
        <tr key={b.name}>
          <td>
            <strong>{b.name}</strong>
          </td>
          <td>{b.pick}</td>
          <td>{b.difficulty}</td>
        </tr>
      ))}
    </GuideTable>
  );
}

/** 実例のレースの出走表（見出しの字だけ言語ごと） */
export function ExampleEntriesTable({ head }) {
  return (
    <GuideTable head={head}>
      {EXAMPLE_RACE_ENTRIES.map((e) => (
        <tr key={e.boat}>
          <td>
            <strong>{e.boat}</strong>
          </td>
          <td translate="no">{e.name}</td>
          <td>{e.grade}</td>
          <td>{e.winRate}</td>
          <td>{e.localWinRate}</td>
          <td>{e.motor2Rate}</td>
        </tr>
      ))}
    </GuideTable>
  );
}

/** 決まり手の一覧（名・日本語の名・英語の言い換えは en があるときだけ・説明） */
export function TechniqueList({ items }) {
  return (
    <div className="eg-technique-list">
      {items.map((t) => (
        <div key={t.name} className="eg-technique">
          <div className="eg-technique-name">
            <strong>{t.name}</strong>{" "}
            <span className="eg-kanji">{t.kanji}</span>
            {t.en ? ` — ${t.en}` : null}
          </div>
          <p>{t.desc}</p>
        </div>
      ))}
    </div>
  );
}

/** 予想の材料のデータの項目（絵・名・説明） */
export function DataPointModels({ points }) {
  return (
    <div className="eg-models">
      {points.map((d) => (
        <div key={d.name} className="eg-model">
          <span className="eg-model-icon">{d.icon}</span>
          <strong>{d.name}</strong>
          <p>{d.desc}</p>
        </div>
      ))}
    </div>
  );
}

/** レース詳細のタブの一覧（タブの名は i18n の raceTabs、説明は言語ごと） */
export function RaceTabsList({ intro, tabs }) {
  const { t } = useTranslation();

  return (
    <>
      <p>{intro}</p>
      <ul className="eg-list eg-race-tabs">
        {tabs.map((tab) => (
          <li key={tab.key}>
            <strong>{t(`raceTabs.${tab.key}`)}</strong>: {tab.desc}
          </li>
        ))}
      </ul>
    </>
  );
}
