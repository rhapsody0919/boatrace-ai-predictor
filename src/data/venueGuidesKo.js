/**
 * 한국어판 경장(競艇場) 방문 가이드 콘텐츠 데이터
 * 영어판(venueGuidesEn.js)과 같은 회장을 대상으로 번역·현지화
 * scripts/generate-sitemap.js（node 직접 실행）에서도 import되므로 Vite 전용 문법을 사용하지 않고 순수 JS 데이터로 유지할 것
 *
 * name: 한글 표기（1차 표시）, kanji: 로마자 표기（실제 역명・안내판 대조용 보조 표기）
 */

export const VENUE_GUIDES_KO = [
  {
    slug: "kiryu",
    code: 1,
    name: "기류",
    kanji: "Kiryu",
    region: "군마",
    regionGroup: "kanto",
    tagline: "나이터 경주의 발상지 — 일본에서 가장 높은 곳에 있는 경장",
    intro: [
      "군마현에 있는 기류 경정장은 1997년 일본 24개 경정장 중 최초로 나이터(야간) 경주를 도입한 곳으로, 지금은 모든 경주가 조명 아래에서 진행됩니다（첫 경주 약 오후 3시, 마지막 경주 약 오후 8시 반）. 또한 해발 128m로 일본에서 가장 높은 곳에 위치한 경정장이기도 합니다.",
      "고지대의 옅은 공기 때문에 모터 출력이 해수면 근처 경장보다 다소 약해져, 순수하게 안쪽 라인을 지키는 '니게'보다 바깥쪽 정의 추입(다시)이 힘을 발휘하기 쉬운 편입니다. 겨울부터 봄까지는 '아카기오로시'라 불리는 강한 계절풍이 불어 경주에 변수를 더합니다.",
    ],
    access: [
      "JR료모선 '이와주쿠'역 → 도보 약 12분, 또는 무료 셔틀버스",
      "경주일에는 '아자미'역에서도 무료 셔틀버스 운행",
    ],
    mapQuery: "ボートレース桐生",
    lat: 36.39642168,
    lng: 139.30845653,
    videoUrl: "https://www.youtube.com/@boatracejpkiryu",
    cashless: {
      note: "일반 구매는 현금만 가능하며 신용카드는 사용할 수 없습니다. 캐시리스 투표를 원한다면 무료 'DK카드'를 발급받으세요. 현장 기계에서 충전할 수 있으며, 지정석 이용 시 100엔당 1포인트가 적립됩니다.",
      url: "https://www.kiryu-kyotei.com/sp/index.php?page=about-question",
    },
    facts: {
      water: "담수（인공 수지）",
      character: "일본에서 가장 높은 고지대 — 옅은 공기가 추입정에 유리",
      nightRace: true,
    },
    tip: "이곳의 낮은 기압은 바깥쪽 추입정에 유리하게 작용합니다 — 저희 AI는 기류 경주를 예측할 때 항상 고도 영향을 함께 분석합니다.",
    nearbyAttractions: [
      {
        name: "기류 신마치 방직 거리",
        description:
          "톱니 지붕 공장이 남아있는 옛 방직 거리로, 기류는 400년 넘게 견직물로 번성한 도시입니다. 거리 남쪽 끝의 '유린칸' 창고군이 이 지역의 중심입니다.",
        lat: 36.416606,
        lng: 139.34303,
      },
      {
        name: "오리모노 산코칸 직물박물관",
        description:
          "기류의 방직 문화를 소개하는 박물관으로, 신마치 방직 거리 안에 실제로 작동하는 베틀을 전시하고 있습니다. 거리 산책과 함께 둘러보기 좋습니다.",
      },
      {
        name: "기류 텐만구",
        description:
          "약 400년 전 기류 신마치가 이 신사를 중심으로 형성되었으며, 지금도 지역의 신앙 중심지입니다. 매달 25일 무렵 골동품 시장이 열립니다.",
        lat: 36.422137,
        lng: 139.34634,
      },
      {
        name: "기류역 일대",
        description:
          "시내 주요 기차역과 주변 상점가로, 경정장과 신마치 방직 거리, 기류 시내 중심부를 이어줍니다.",
        lat: 36.41102148,
        lng: 139.33332328,
      },
      {
        name: "기류가오카 공원（동물원 & 놀이공원）",
        description:
          "작은 동물원（기린, 사자, 코끼리 등）과 놀이공원이 함께 있는 무료 시립 공원으로, 기류역에서 도보 약 15분 거리에 있어 가족 나들이로 좋습니다.",
      },
    ],
    schedule: {
      typicalRaceDays:
        "이곳의 모든 경주는 야간에 열립니다. 정기 경주는 매년 여러 차례, 회당 약 4~7일간 진행됩니다.",
      seasonalNotes:
        "간혹 SG／G1급 전국 대회가 열리기도 하니 정확한 일정은 공식 홈페이지를 확인하세요.",
    },
    image: {
      src: "/images/venues/kiryu.jpg",
      alt: "기류 경정장",
      credit: "Photo by cake6, CC BY 3.0, via Wikimedia Commons",
      creditUrl: "https://commons.wikimedia.org/wiki/File:Kiryu-kyotei-01.jpg",
    },
  },
];
