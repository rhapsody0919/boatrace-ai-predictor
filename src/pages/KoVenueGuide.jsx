/**
 * KoVenueGuide - 회장별 한국어 가이드（/ko/venues, /ko/venues/:slug）
 * 한국은 자국에 경정이 있어 방일 관광객 중에서도 관심도가 높은 편（BOA-132）
 * JSX 구조는 VenueGuide.jsx에 공통화되어 있음. 여기서는 한국어 문구만 관리한다
 */
import { Link } from "react-router-dom";
import { VenueGuideList, VenueGuideDetail } from "./VenueGuide";
import { VenueRegionHub } from "./VenueRegionHub";
import { VENUE_GUIDES_KO } from "../data/venueGuidesKo";

const copy = {
  listTitle: "일본 경정장 방문 가이드: 교통편과 입장료 정보 | 용신 레이더",
  listDescription:
    "일본 보트레이스（경정） 경정장 방문 가이드: 가는 방법, 입장료, 나이터 경주, 베팅 팁까지. 기류 경정장을 시작으로 순차 추가 중입니다.",
  heroTitle: "🏟️ 경정장 방문 가이드",
  heroLead: (
    <>
      일본에는 총 24개의 경정장이 있으며, 대부분 100엔의 입장료로 누구나 관람할
      수 있습니다. 이 가이드는 여행자가 가기 쉬운 경정장을 중심으로 가는 방법,
      각 경장의 특징, 처음 방문할 때 즐기는 법을 소개합니다. 아직 경정이
      낯설다면 <Link to="/ko/guide">초보자 가이드</Link>부터 확인해 보세요.
    </>
  ),
  nightRaceBadge: "🌙 나이터 경주",
  ctaHeading: "출발 전, 오늘의 AI 예측을 확인해 보세요",
  ctaButton: "🏁 무료 예측 보기",
  backToAll: "← 전체 경정장 목록",
  detailTitle: (venue) =>
    `${venue.name} 경정장 교통·방문 가이드（${venue.kanji}） | 용신 레이더`,
  detailDescription: (venue) =>
    `${venue.region} ${venue.name} 경정장 방문 방법: 가까운 역에서 가는 법, 입장료, 수면 특성과 베팅 팁. ${venue.tagline}.`,
  detailHeading: (venue) => (
    <>
      🚤 {venue.name} 경정장 <span className="eg-kanji">{venue.kanji}</span>
    </>
  ),
  whyVisit: "방문해야 하는 이유",
  gettingThere: "🚉 가는 방법",
  entranceNote:
    "입장료: 100엔（대부분의 경장）. 무료 셔틀버스는 경주일에만 운행하니 정확한 시간은 공식 홈페이지를 확인하세요.",
  quickFacts: "⚡ 한눈에 보기",
  factLabels: {
    water: "수질",
    character: "경주 스타일",
    nightRace: "나이터 경주",
    entrance: "입장료",
  },
  nightRaceYes: "있음 🌙",
  nightRaceNo: "없음（주간 경주만）",
  scheduleHeading: "📅 경주 일정",
  nearbyAttractionsHeading: "🗺️ 주변 볼거리",
  officialSiteLabel: "공식 홈페이지 →",
  mapHeading: "경정장 지도",
  multiMapLabel: "🗺️ 주변 볼거리 위치도（경정장 포함）",
  googleMapLabel: "📍 구글맵（경정장 위치, 길찾기 바로가기）",
  scheduleOfficialLabel: "공식 전체 일정 보기 →",
  videoLabel: "📺 공식 유튜브 채널에서 경주 하이라이트 보기 →",
  raceVideoHeading: "🎬 경정이 어떤 스포츠인지 미리 보기",
  raceVideoNote:
    "BOATRACE 공식 유튜브 채널의 영상으로, 최신 경주 하이라이트가 계속 업데이트됩니다. 방문 전 미리 분위기를 느껴보세요.",
  languageBarrierHeading: "🌐 한국어만 해도 베팅할 수 있나요?",
  languageBarrierBody: [
    "네, 가능합니다. 만 20세 이상이면 국적과 관계없이 누구나 일본 경정장에서 합법적으로 베팅할 수 있습니다. 현장 투표는 '마크시트' 방식으로, 경주 번호·베팅 종류·정 번호·금액에 해당하는 칸을 채우는 방식이라 일본어를 몰라도 숫자만 선택하면 됩니다.",
    "티켓은 100엔부터 구매할 수 있습니다. 일부 경정장은 영어 안내판이나 스마트폰 번역 도움을 제공하지만, 모든 곳에서 직원의 영어 응대가 보장되지는 않으니 방문 전 공식 영어 가이드를 확인하는 것이 좋습니다.",
    "한 가지 유의할 점: 온라인 투표는 일본 은행 계좌와 주소가 있는 거주자만 이용할 수 있어, 방문객은 반드시 현장에서 직접 구매해야 합니다. 또한 신용카드나 페이페이 등 일반 전자결제는 사용할 수 없고, 각 경정장이 자체 발급하는 선불카드를 이용해야 합니다（아래 결제 방법 참고）.",
  ],
  languageBarrierLinkLabel: "BOATRACE 공식 영어 가이드 보기 →",
  cashlessHeading: "💳 이곳의 결제 방법",
  cashlessLinkLabel: "공식 결제 안내 보기 →",
  bettingTip: "💡 베팅 팁",
  beforeYouBet: "⚖️ 베팅 전 꼭 확인하세요",
  disclaimer: (
    <>
      경정 베팅은 일본 현지에서, 만 20세 이상만 가능합니다. 용신 레이더는 정보와 AI
      분석만 제공합니다 — 규칙과 베팅 종류는{" "}
      <Link to="/ko/guide">초보자 가이드</Link>를 참고하세요.
    </>
  ),
  seeTodaysPredictions: (venue) =>
    `오늘의 AI 예측 보기${venue.facts.nightRace ? "（나이터 경주 포함）" : ""}`,
  regionTitle: (region) =>
    `${region.labelKo} 경정장 방문 가이드: 교통편과 입장료 정보 | 용신 레이더`,
  regionDescription: (region) =>
    `일본 ${region.labelKo} 지역 경정장 방문 가이드: 가는 방법, 입장료, 베팅 팁.`,
  regionHeading: (region) => `🏟️ ${region.labelKo} 경정장 방문 가이드`,
  regionLabel: (region) => region.labelKo,
};

export function KoVenueGuides() {
  return <VenueGuideList lang="ko" guides={VENUE_GUIDES_KO} copy={copy} />;
}

export default function KoVenueGuide() {
  return <VenueGuideDetail lang="ko" guides={VENUE_GUIDES_KO} copy={copy} />;
}

export function KoVenueRegionHub() {
  return <VenueRegionHub lang="ko" guides={VENUE_GUIDES_KO} copy={copy} />;
}
