/**
 * KoGuide - 韓国語圏の初心者向けボートレース入門ガイド（/ko/guide）
 * 韓国には自国の競技（경정・ミサリ）が存在するため、日韓の違いセクションで差別化する
 * スタイルは EnglishGuide.css を共用
 */
import { Link } from "react-router-dom";
import Header from "../components/Header";
import "./EnglishGuide.css";

const TECHNIQUES = [
  {
    name: "인빠지기",
    kanji: "逃げ（Nige）",
    desc: "1코스 정이 가장 안쪽 라인을 지키며 1턴 마크를 가장 먼저 선회해 그대로 밀어붙이는 전법. 가장 흔한 승리 방식으로, 1번 정이 대부분 인기 1순위인 이유입니다.",
  },
  {
    name: "찌르기",
    kanji: "差し（Sashi）",
    desc: "1턴에서 앞서 선회하는 정의 안쪽 공간을 파고들어 역전하는 전법. 1코스의 선회가 벌어졌을 때 2코스가 자주 성공시킵니다.",
  },
  {
    name: "휘감기",
    kanji: "まくり（Makuri）",
    desc: "바깥쪽 정이 전속력으로 안쪽 정들을 바깥에서 휘감아 제치는 전법. 3-4코스의 강력한 무기입니다.",
  },
  {
    name: "휘감아찌르기",
    kanji: "まくり差し（Makuri-zashi）",
    desc: "일부 정을 휘감은 뒤 다른 정의 안쪽을 찌르는 복합 기술. 4-6코스의 화려한 전법으로 고배당이 자주 나옵니다.",
  },
  {
    name: "추월",
    kanji: "抜き（Nuki）",
    desc: "1턴 마크 이후의 구간에서 선두를 추월하는 것.",
  },
  {
    name: "어부지리",
    kanji: "恵まれ（Megumare）",
    desc: "선두권 정들의 충돌이나 반칙 실격 덕분에 승리하는 것.",
  },
];

const DIFFERENCES = [
  {
    item: "경정장 수",
    kr: "미사리 1곳",
    jp: "전국 24곳 (거의 매일 개최)",
  },
  {
    item: "코스 진입",
    kr: "배정된 코스 고정 (고정 진입)",
    jp: "진입 자유 (대부분 배정대로 서지만 코스 다툼도 있음)",
  },
  {
    item: "1코스 승률",
    kr: "약 34%",
    jp: "전국 평균 약 50% (경정장에 따라 40-60%대)",
  },
  {
    item: "승리 전법 용어",
    kr: "인빠지기·찌르기·휘감기·휘감아찌르기",
    jp: "같은 개념을 니게(逃げ)·사시(差し)·마쿠리(まくり)·마쿠리자시로 부름",
  },
  {
    item: "베팅 방식",
    kr: "단승식·연승식·쌍승식·복승식·삼쌍승식·삼복승식",
    jp: "동일한 6종 + 확대복승식 (명칭만 다르고 구조는 같음)",
  },
];

const BET_TYPES = [
  { name: "단승식", pick: "1착 정을 맞히기", difficulty: "★" },
  { name: "연승식", pick: "2착 이내에 들 정 1척을 맞히기", difficulty: "★" },
  { name: "쌍승식", pick: "1·2착을 순서까지 맞히기", difficulty: "★★" },
  {
    name: "복승식",
    pick: "1·2착 조합을 순서 무관하게 맞히기",
    difficulty: "★★",
  },
  {
    name: "삼복승식",
    pick: "1-3착 조합을 순서 무관하게 맞히기",
    difficulty: "★★★",
  },
  {
    name: "삼쌍승식",
    pick: "1·2·3착을 순서까지 맞히기 — 고배당의 꽃",
    difficulty: "★★★★",
  },
];

const MODELS = [
  {
    icon: "🎯",
    name: "안정형",
    desc: "가장 가능성 높은 전개를 따릅니다. 꾸준한 적중을 원할 때.",
  },
  {
    icon: "⚖️",
    name: "표준형",
    desc: "두 번째로 가능성 높은 전개에 기반한 균형 잡힌 선택.",
  },
  {
    icon: "🌪️",
    name: "고배당형",
    desc: "세 번째 전개로 고배당을 노립니다. 혼전 경주에 적합.",
  },
];

export default function KoGuide() {
  return (
    <div className="app">
      <title>일본 경정(쿄테이)이란? 규칙·베팅 입문 가이드 | 용신 레이더</title>
      <meta
        name="description"
        content="일본 경정(BOAT RACE) 입문 가이드: 규칙, 승리 전법, 베팅 방식, 한국 경정과의 차이, 그리고 용신 레이더의 무료 AI 예측 보는 법."
      />
      <link rel="canonical" href="https://www.boat-ai.jp/ko/guide" />

      <Header />

      <div className="eg-container">
        {/* Hero */}
        <section className="eg-hero">
          <h1>🚤 일본 경정(쿄테이)이란?</h1>
          <p className="eg-hero-lead">
            일본 경정(BOAT RACE, 일본어로는 쿄테이)은 일본의 4대 공영 경기 중
            하나로, 전국 24개 경정장에서 거의 매일 열립니다. 6척의 모터보트가
            600m 수면을 3바퀴 돌아 승부를 가리고, 결과에 합법적으로 베팅할 수
            있습니다. 미사리 경정을 아는 분이라면 이미 절반은 아는 셈 — 이
            가이드는 나머지 절반, 일본만의 특징과 AI 예측 읽는 법을 안내합니다.
          </p>
        </section>

        {/* Korea vs Japan */}
        <section className="eg-section eg-highlight">
          <h2>🇰🇷🇯🇵 한국 경정과 일본 경정, 무엇이 다른가</h2>
          <p>
            한국 경정(미사리)과 기본 규칙은 같지만, 예측 관점에서 중요한 차이가
            있습니다:
          </p>
          <div className="eg-table-wrapper">
            <table className="eg-table">
              <thead>
                <tr>
                  <th>항목</th>
                  <th>한국 경정</th>
                  <th>일본 경정</th>
                </tr>
              </thead>
              <tbody>
                {DIFFERENCES.map((d) => (
                  <tr key={d.item}>
                    <td>
                      <strong>{d.item}</strong>
                    </td>
                    <td>{d.kr}</td>
                    <td>{d.jp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="eg-note">
            핵심 차이는 <strong>1코스 승률</strong>입니다. 일본은 약 50%로
            한국(약 34%)보다 훨씬 높아, 예측의 출발점이 「1코스가 지키느냐,
            무너지느냐」가 됩니다. 용신 레이더의 「1코스 이변 지수」는 바로 이것을
            경주마다 수치화한 것입니다.
          </p>
        </section>

        {/* Quick facts */}
        <section className="eg-section">
          <h2>⚡ 기본 정보</h2>
          <div className="eg-facts-grid">
            <div className="eg-fact">
              <strong>6척</strong>
              <span>매 경주 1-6번, 색상 고정</span>
            </div>
            <div className="eg-fact">
              <strong>3바퀴 / 1,800m</strong>
              <span>600m 수면 코스</span>
            </div>
            <div className="eg-fact">
              <strong>약 1분 50초</strong>
              <span>짧고 강렬한 승부</span>
            </div>
            <div className="eg-fact">
              <strong>24개 경정장</strong>
              <span>동쪽 키류부터 서쪽 오무라까지</span>
            </div>
            <div className="eg-fact">
              <strong>플라잉 스타트</strong>
              <span>스타트 라인 통과 시 이미 주행 중</span>
            </div>
            <div className="eg-fact">
              <strong>패리뮤추얼 방식</strong>
              <span>배당률은 베팅 총액으로 결정 (경마와 동일)</span>
            </div>
          </div>
        </section>

        {/* Winning techniques */}
        <section className="eg-section">
          <h2>🥇 6가지 승리 전법 (키마리테)</h2>
          <p>
            모든 승리는 「어떻게 이겼는가」로 공식 분류됩니다. 한국 경정과 같은
            개념이지만 일본어 용어를 알아두면 일본 중계와 용신 레이더 예측을 읽을 수
            있습니다.
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
          <h2>🏅 선수 등급</h2>
          <p>
            약 1,600명의 프로 선수가 4개 등급으로 나뉘며, 반년마다 재심사를
            받습니다. 등급은 성적을 예측하는 강력한 지표입니다:
          </p>
          <ul className="eg-list">
            <li>
              <strong>A1</strong> — 최정예 (상위 약 20%). 1코스의 A1 선수는
              최강의 인기 후보입니다.
            </li>
            <li>
              <strong>A2</strong> — 실력 있는 상위권 선수.
            </li>
            <li>
              <strong>B1</strong> — 다수를 차지하는 중견 선수.
            </li>
            <li>
              <strong>B2</strong> — 신인 및 하위권 선수.
            </li>
          </ul>
          <p className="eg-note">
            여자 선수가 남자 선수와 같은 경주에서 직접 겨루는, 몇 안 되는 스포츠
            중 하나입니다.
          </p>
        </section>

        {/* Betting types */}
        <section className="eg-section">
          <h2>🎫 베팅 방식</h2>
          <div className="eg-table-wrapper">
            <table className="eg-table">
              <thead>
                <tr>
                  <th>방식</th>
                  <th>맞히는 것</th>
                  <th>난이도</th>
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
            삼쌍승식(일본의 3연단)이 압도적으로 인기 있는 방식으로, ¥100당 평균
            배당은 약 ¥7,000, 큰 이변 때는 ¥100,000를 넘기도 합니다.
          </p>
        </section>

        {/* How to read boatAI */}
        <section className="eg-section">
          <h2>🤖 용신 레이더 예측 보는 법</h2>
          <p>
            용신 레이더는 경주당 45개 데이터 — 선수 성적, 모터 성능, 경정장 특성,
            스타트 타이밍 등 — 를 분석해 모든 추천의 <strong>이유</strong>까지
            보여줍니다. 완전 무료입니다.
          </p>
          <ol className="eg-steps">
            <li>
              <Link to="/ko/">홈 화면</Link>에서{" "}
              <strong>경정장과 경주를 선택</strong>합니다. 각 경주 카드에 발매
              마감 시각과 예상 전개가 표시됩니다.
            </li>
            <li>
              <strong>스타일에 맞는 예측 모델을 선택</strong>합니다:
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
              <strong>1코스 이변 지수를 확인</strong>합니다 — 높을수록 혼전
              가능성이 크고 (배당은 높아지고 적중률은 낮아집니다).
            </li>
            <li>
              <strong>1턴 마크 전개 애니메이션</strong>을 봅니다 — 승부를 가르는
              1턴이 어떻게 전개될지 확률과 함께 시각화합니다.
            </li>
            <li>
              <strong>핵심 데이터 카드</strong>를 읽습니다 — 각 추천 정의 통계적
              근거 (스타트 순위, 모터 성능, 현지 승률)입니다.
            </li>
          </ol>
        </section>

        {/* Venue guides */}
        <section className="eg-section">
          <h2>🏟️ 직접 경정장에 가보기</h2>
          <p>
            현장 관람은 입장료 ¥100로 저렴하고 잊지 못할 경험입니다. 일본 전국
            24개 경정장 모두의 한국어 가이드를 준비했습니다 — 하네다 공항 근처의
            헤이와지마, 오사카 스미노에의 나이터 경주 등.
          </p>
          <p>
            <Link to="/ko/venues">→ 경정장 가이드 보기</Link>
          </p>
        </section>

        {/* Legal disclaimer */}
        <section className="eg-section eg-disclaimer">
          <h2>⚖️ 중요: 베팅 자격과 법적 안내</h2>
          <ul className="eg-list">
            <li>
              일본 경정 베팅은 일본 공식 채널(경정장 및 공식 TELEBOAT)을
              통해서만 합법이며, <strong>일본 국내에 체류 중</strong>이고{" "}
              <strong>20세 이상</strong>이어야 합니다.
            </li>
            <li>
              <strong>
                대한민국 법률상 내국인의 해외 도박은 처벌 대상이 될 수 있습니다.
              </strong>{" "}
              해외 불법 중계·사설 베팅 사이트 이용은 절대 하지 마십시오.
            </li>
            <li>
              용신 레이더는 <strong>정보와 AI 분석만을 제공</strong>합니다. 베팅을
              받지 않으며, 베팅을 권유하지 않고, 예측은 결과를 보장하지
              않습니다.
            </li>
            <li>
              책임 있는 이용을 부탁드립니다.{" "}
              <Link to="/ko/responsible-gambling">책임 있는 베팅</Link> 페이지를
              참고하세요.
            </li>
          </ul>
        </section>

        {/* CTA */}
        <section className="eg-cta">
          <h2>AI의 실력을 직접 확인해 보세요</h2>
          <Link to="/ko/" className="eg-cta-button">
            🏁 오늘의 무료 예측 보기
          </Link>
        </section>
      </div>
    </div>
  );
}
