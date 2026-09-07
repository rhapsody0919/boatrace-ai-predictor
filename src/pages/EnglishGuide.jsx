/**
 * EnglishGuide - 英語圏の初心者向けボートレース入門ガイド（/en/guide）
 * 競技を全く知らない海外ユーザーが、ルール理解から boatAI の予想の読み方まで到達できる構成
 */
import { Link } from "react-router-dom";
import Header from "../components/Header";
import "./EnglishGuide.css";

const TECHNIQUES = [
  {
    name: "Nige",
    kanji: "逃げ",
    en: "Escape",
    desc: "Lane 1 holds the inside line and leads at the first mark. The most common winning move — this is why boat 1 is usually the favorite.",
  },
  {
    name: "Sashi",
    kanji: "差し",
    en: "Inside pass",
    desc: "A boat dives inside a rival at the first turn and slips through. Typical for lane 2 when lane 1 turns wide.",
  },
  {
    name: "Makuri",
    kanji: "まくり",
    en: "Outside sweep",
    desc: "An outer boat attacks at full throttle around the outside of the leaders. Powerful move for lanes 3-4.",
  },
  {
    name: "Makuri-zashi",
    kanji: "まくり差し",
    en: "Sweep & pass",
    desc: "A hybrid: sweep outside some boats, then cut inside others. Spectacular and common for lanes 4-6 — often pays big.",
  },
  {
    name: "Nuki",
    kanji: "抜き",
    en: "Overtake",
    desc: "Passing the leader after the first mark, later in the race.",
  },
  {
    name: "Megumare",
    kanji: "恵まれ",
    en: "Lucky win",
    desc: "Winning because leading boats collided or were penalized.",
  },
];

const BET_TYPES = [
  { name: "Win (Tansho)", pick: "Pick the 1st place boat", difficulty: "★" },
  {
    name: "Place (Fukusho)",
    pick: "Pick a boat that finishes 1st or 2nd",
    difficulty: "★",
  },
  {
    name: "Exacta (Nirentan)",
    pick: "Pick 1st and 2nd in exact order",
    difficulty: "★★",
  },
  {
    name: "Quinella (Nirenpuku)",
    pick: "Pick the top 2 in any order",
    difficulty: "★★",
  },
  {
    name: "Trio (Sanrenpuku)",
    pick: "Pick the top 3 in any order",
    difficulty: "★★★",
  },
  {
    name: "Trifecta (Sanrentan)",
    pick: "Pick 1st, 2nd and 3rd in exact order — the big-payout bet",
    difficulty: "★★★★",
  },
];

// 実データを使った実例（BOA-250）。localbetjapan.com等の既存英語リソースは
// 架空の数値で説明する形式にとどまっていたため、実際の過去レース
// （2026-09-06 住之江11R）を差別化ポイントとして使う。
const EXAMPLE_RACE = {
  raceId: "2026-09-06-12-11",
  venue: "Suminoe",
  date: "September 6, 2026",
  raceNo: 11,
  entries: [
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
  ],
  pick: [1, 3, 4],
  payout: "¥1,010",
};

const DATA_POINTS = [
  {
    icon: "🏅",
    name: "Class & win rate",
    desc: "Racer skill level and career win rate.",
  },
  {
    icon: "⚙️",
    name: "Motor performance",
    desc: "2-boat win rate of the racer's assigned motor.",
  },
  {
    icon: "📈",
    name: "Recent form",
    desc: "Whether the racer's win rate is trending up or down lately.",
  },
  {
    icon: "⏱️",
    name: "Start stability",
    desc: "How consistent the racer's start timing is.",
  },
];

export default function EnglishGuide() {
  return (
    <div className="app">
      <title>
        What is Kyotei? Rules, Betting & Free AI Guide | Ryujin Radar
      </title>
      <meta
        name="description"
        content="A complete beginner's guide to Kyotei (Japanese boat racing): rules, winning techniques, betting types, and how to read Ryujin Radar's free AI predictions."
      />
      <link rel="canonical" href="https://www.boat-ai.jp/en/guide" />

      <Header />

      <div className="eg-container">
        {/* Hero */}
        <section className="eg-hero">
          <h1>🚤 What is Kyotei?</h1>
          <p className="eg-hero-lead">
            Kyotei (競艇) — Japanese boat racing — is one of Japan&apos;s four
            government-sanctioned betting sports, running nearly every day at 24
            venues across the country. Six hydroplane boats race three laps
            around a 600m course, and you can bet on the outcome. This guide
            takes you from zero knowledge to reading AI predictions like a
            local.
          </p>
        </section>

        {/* Quick facts */}
        <section className="eg-section">
          <h2>⚡ Quick Facts</h2>
          <div className="eg-facts-grid">
            <div className="eg-fact">
              <strong>6 boats</strong>
              <span>Every race, numbered 1-6 with fixed colors</span>
            </div>
            <div className="eg-fact">
              <strong>3 laps / 1,800m</strong>
              <span>Around a 600m water course</span>
            </div>
            <div className="eg-fact">
              <strong>~1 minute 50 sec</strong>
              <span>Races are short and intense</span>
            </div>
            <div className="eg-fact">
              <strong>24 venues</strong>
              <span>From Kiryu in the east to Omura in the west</span>
            </div>
            <div className="eg-fact">
              <strong>Flying start</strong>
              <span>Boats are already moving at the start line</span>
            </div>
            <div className="eg-fact">
              <strong>Parimutuel betting</strong>
              <span>Odds are set by the betting pool, like horse racing</span>
            </div>
          </div>
        </section>

        {/* The key concept */}
        <section className="eg-section eg-highlight">
          <h2>🔑 The One Thing to Know: Lane 1 Wins Half the Time</h2>
          <p>
            Unlike most racing sports, Kyotei has a massive positional bias. The
            boat starting from
            <strong>
              {" "}
              lane 1 (the innermost course) wins roughly 50% of all races
              nationwide
            </strong>{" "}
            — because it takes the shortest line around the first turn.
          </p>
          <p>
            Almost everything in Kyotei prediction revolves around one question:
            <strong>
              {" "}
              will lane 1 hold, or will someone take it down?
            </strong>{" "}
            Ryujin Radar&apos;s &quot;Lane-1 upset index&quot; measures exactly
            this for every race.
          </p>
        </section>

        {/* Winning techniques */}
        <section className="eg-section">
          <h2>🥇 The 6 Winning Techniques (Kimarite)</h2>
          <p>
            Every win is officially classified by <em>how</em> the boat won.
            Learning these six terms unlocks Japanese race commentary and Ryujin
            Radar&apos;s predictions.
          </p>
          <div className="eg-technique-list">
            {TECHNIQUES.map((t) => (
              <div key={t.name} className="eg-technique">
                <div className="eg-technique-name">
                  <strong>{t.name}</strong>{" "}
                  <span className="eg-kanji">{t.kanji}</span> — {t.en}
                </div>
                <p>{t.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Racer classes */}
        <section className="eg-section">
          <h2>🏅 Racer Classes</h2>
          <p>
            All ~1,600 professional racers are ranked into four classes,
            reviewed twice a year. Class is a strong predictor of performance:
          </p>
          <ul className="eg-list">
            <li>
              <strong>A1</strong> — The elite (top ~20%). An A1 racer in lane 1
              is a formidable favorite.
            </li>
            <li>
              <strong>A2</strong> — Strong senior racers.
            </li>
            <li>
              <strong>B1</strong> — The mid-tier majority.
            </li>
            <li>
              <strong>B2</strong> — Rookies and lower-ranked racers.
            </li>
          </ul>
          <p className="eg-note">
            Women race alongside men in the same races — Kyotei is one of the
            few sports where both compete directly.
          </p>
        </section>

        {/* Betting types */}
        <section className="eg-section">
          <h2>🎫 Betting Types</h2>
          <div className="eg-table-wrapper">
            <table className="eg-table">
              <thead>
                <tr>
                  <th>Bet type</th>
                  <th>What you pick</th>
                  <th>Difficulty</th>
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
            The Trifecta (3連単) is by far the most popular bet — average
            payouts are around ¥7,000 per ¥100 stake, with big upsets paying
            over ¥100,000.
          </p>
        </section>

        {/* How to read boatAI */}
        <section className="eg-section">
          <h2>🤖 How to Read Ryujin Radar&apos;s Predictions</h2>
          <p>
            Ryujin Radar analyzes 45 data points per race — racer stats, motor
            performance, venue bias, start timing and more — and shows you{" "}
            <strong>why</strong> behind every pick. Completely free.
          </p>
          <ol className="eg-steps">
            <li>
              <strong>Pick a venue and race</strong> on the{" "}
              <Link to="/en/">top page</Link>. Each race card shows the betting
              deadline and a forecast preview.
            </li>
            <li>
              <strong>View the objective Data Table</strong> for all 6 boats.
              Ryujin Radar doesn&apos;t make you choose a prediction model —
              everyone sees the same data and builds their own read:
              <div className="eg-models">
                {DATA_POINTS.map((d) => (
                  <div key={d.name} className="eg-model">
                    <span className="eg-model-icon">{d.icon}</span>
                    <strong>{d.name}</strong>
                    <p>{d.desc}</p>
                  </div>
                ))}
              </div>
            </li>
            <li>
              <strong>Check the Lane-1 upset index</strong> — high means chaos
              is likely (bigger payouts, lower hit rate).
            </li>
            <li>
              <strong>Watch the First Mark animation</strong> — a visual
              simulation of how the decisive first turn is likely to unfold,
              with win probabilities per pattern.
            </li>
            <li>
              <strong>Read the Key Data card</strong> — the top statistical
              reasons behind each picked boat (start timing rank, motor
              strength, local win rate).
            </li>
          </ol>
        </section>

        {/* Real example (BOA-250): actual past race data, not a fictional walkthrough */}
        <section className="eg-section">
          <h2>📋 A Real Example: Reading the Data &amp; Marking a Slip</h2>
          <p>
            Most beginner guides use made-up numbers. Here&apos;s an actual race
            — Boat Race {EXAMPLE_RACE.venue}, {EXAMPLE_RACE.date}, Race{" "}
            {EXAMPLE_RACE.raceNo} — with the real entry data, the real bet, and
            the real payout.
          </p>
          <div className="eg-table-wrapper">
            <table className="eg-table">
              <thead>
                <tr>
                  <th>Boat</th>
                  <th>Racer</th>
                  <th>Class</th>
                  <th>Win rate</th>
                  <th>Local win rate</th>
                  <th>Motor 2-rate</th>
                </tr>
              </thead>
              <tbody>
                {EXAMPLE_RACE.entries.map((e) => (
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
              </tbody>
            </table>
          </div>
          <p>
            <strong>Reading it:</strong> Boat 1 is A1 class with this
            venue&apos;s best local win rate (6.59) — the textbook favorite to
            Nige from lane 1. Boat 3 is only A2 class, but its motor has a
            noticeably stronger 2-rate (38.0%) than the field — a common reason
            to look past class ranking alone for the 2nd-place pick.
          </p>
          <p>
            <strong>The bet:</strong> Trifecta (3連単), picking boats{" "}
            <strong>1 → 3 → 4</strong> in that exact order on the mark sheet —
            filling in the &quot;1&quot; oval in the 1st-place column,
            &quot;3&quot; in the 2nd-place column, and &quot;4&quot; in the
            3rd-place column, next to this race&apos;s number on the card.
          </p>
          <p className="eg-note">
            <strong>The result:</strong> Boat 1 won by Nige, boat 3 took 2nd,
            boat 4 took 3rd — exactly as picked. Payout:{" "}
            <strong>{EXAMPLE_RACE.payout}</strong> for every ¥100 wagered.
          </p>
          <p>
            <Link to={`/en/race/${EXAMPLE_RACE.raceId}`}>
              → See Ryujin Radar&apos;s full data breakdown for this race
            </Link>
          </p>
        </section>

        {/* Venue guides */}
        <section className="eg-section">
          <h2>🏟️ Visit a Venue in Person</h2>
          <p>
            Watching Kyotei live is cheap (¥100 entrance) and unforgettable. We
            have English visitor guides for the venues easiest to reach as a
            traveler — including Heiwajima near Haneda Airport and
            Suminoe&apos;s night races in Osaka.
          </p>
          <p>
            <Link to="/en/venues">→ Browse the venue guides</Link>
          </p>
        </section>

        {/* Legal disclaimer */}
        <section className="eg-section eg-disclaimer">
          <h2>⚖️ Important: Who Can Bet</h2>
          <ul className="eg-list">
            <li>
              Betting on Kyotei is legal only through Japan&apos;s official
              channels (venues and the official TELEBOAT service), and requires
              being
              <strong> physically located in Japan</strong> and{" "}
              <strong>20 years or older</strong>.
            </li>
            <li>
              Ryujin Radar provides{" "}
              <strong>information and AI analysis only</strong>. We do not
              accept bets, and predictions do not guarantee results.
            </li>
            <li>
              Please gamble responsibly. See our{" "}
              <Link to="/en/responsible-gambling">responsible gambling</Link>{" "}
              page.
            </li>
          </ul>
        </section>

        {/* CTA */}
        <section className="eg-cta">
          <h2>Ready to see the AI in action?</h2>
          <Link to="/en/" className="eg-cta-button">
            🏁 View Today&apos;s Free Predictions
          </Link>
        </section>
      </div>
    </div>
  );
}
