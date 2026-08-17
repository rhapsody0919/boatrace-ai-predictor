/**
 * ブログ記事の韓国語版メタデータ。
 * 本文は public/blog/{id}-ko.md、日本語版メタデータは blogPosts.js の該当 id と対応する。
 * date等、翻訳不要なフィールドは blogPosts.js 側の値をそのまま使うため持たない。
 * imageは記事に埋め込む図解の文言が言語ごとに異なるため、韓国語版の画像パスを明示している。
 * 2026-08-17時点、featured記事の英語版と同じ25記事を全て展開（zh-TWの需要確認前だが、
 * 記事単位の動的言語判定設計のため段階的な追加は技術的リスクが無いと判断し、
 * 「測れなくても投資する」というユーザー判断のもと全件展開した）。
 * 競技名は src/locales/ko/common.json の実際のUI表記（경정）と
 * docs/reference/i18n-glossary.md の韓国語方針に合わせて「경정」で統一している。
 * 詳細: docs/design/blog-i18n/spec.md「拡張: zh-TW版」, docs/adr/0008-blog-multilingual-partial-translation.md
 */
export const blogPostsKo = [
  {
    id: "first-mark-prediction-guide",
    title: "1마크 전개 예측이란? AI가 읽어내는 레이스 전개의 원리",
    description:
      "BoatAI의 전개 예측 기능을 철저히 해설. 선수의 결정기술 분포・ST・모터 성능으로부터 1마크 회전 시의 전개를 AI가 통계적으로 예측하는 원리와 마권 전략 활용법을 소개합니다.",
    category: "사용법",
    tags: ["전개예측", "1마크", "결정기술", "AI예측", "사용법"],
    readTime: "10분",
    image: "/images/blog/first-mark-kimarite-donut-ko.jpg",
  },
  {
    id: "suji-funaken-guide",
    title:
      "스지 마권이란? 경기장별 노림수 패턴까지 조견표로 해설【오무라 1번정 승률 약 60% 등】",
    description:
      "스지 마권의 기본 패턴을 조견표로 정리. 인코스 도주・마쿠리・사시별 구매 조합, 역스지 판별법에 더해 오무라・아시야・도쿠야마 등 인코스 도주가 잘 나오는 경기장, 도다・에도가와 등 마쿠리가 잘 나오는 경기장의 경향도 해설합니다.",
    category: "전략",
    tags: ["스지마권", "구매조합", "전개예측", "마쿠리", "사시", "인코스도주"],
    readTime: "12분",
    image: "/images/blog/suji-funaken-chart-ko.jpg",
  },
  {
    id: "winning-technique-analysis-guide",
    title:
      "결정기술 데이터 분석이란? 경기장·코스별 승리 패턴을 보는 새로운 기능",
    description:
      "인빠지기・찌르기・휘감기 등 어떤 결정기술로 1착을 차지했는지를 경기장·코스별로 분석하는 새로운 기능입니다. 90일간의 레이스 데이터를 바탕으로 마권 선택이나 제외 판단의 근거로 활용하는 방법을 소개합니다.",
    category: "데이터 분석",
    tags: ["결정기술", "신기능", "데이터분석", "경기장별", "판단근거"],
    readTime: "7분",
  },
  {
    id: "motor-condition-guide",
    title: "모터 컨디션이란? 오늘 레이스의 번호별 2연대율을 알 수 있는 새 기능",
    description:
      "오늘 레이스를 선택하기만 하면 각 보트 모터의 2・3연대율을 확인할 수 있는 새 기능입니다. 막연한 모터 랭킹이 아니라 실제 베팅 판단에 그대로 활용할 수 있도록 설계했습니다.",
    category: "데이터 분석",
    tags: ["모터", "신규기능", "데이터분석", "연대율", "판단근거"],
    readTime: "7분",
  },
  {
    id: "ai-prediction-accuracy-review",
    title: "경정 AI 예측, 정말 적중할까? — 3개월・15,000레이스 검증 결과",
    description:
      "15,000레이스를 대상으로 AI 예측의 적중률과 회수율을 검증했습니다. 장단점을 솔직하게 짚어보고, 다른 서비스와의 차이점과 AI 예측의 한계까지 가감 없이 전합니다.",
    category: "데이터 분석",
    tags: ["AI예측", "적중률", "회수율", "정확도검증", "투명성"],
    readTime: "10분",
    image: "/images/blog/ai-accuracy-comparison-ko.jpg",
  },
  {
    id: "night-race-strategy",
    title: "나이터 공략법 — 주간 레이스와 다른 5가지 차이, 데이터 분석",
    description:
      "기온 변화, 안정된 수면, 상승하는 인코스 승률 등 나이터 레이스의 5가지 특징을 데이터로 분석하고, 나이터 개최 경기장별 공략 팁까지 정리했습니다.",
    category: "전략",
    tags: ["나이터", "전략", "가마고리", "마루가메", "오무라", "모터"],
    readTime: "9분",
    image: "/images/blog/night-venues-grid-ko.jpg",
  },
  {
    id: "sg-race-guide-2026",
    title: "2026년 SG 경주 완전 가이드 — 대회별 특징과 배팅 전략",
    description:
      "총리배부터 그랑프리까지, 2026년 SG 경주 8개 대회의 특징과 배팅 전략을 정리하고, SG 경주 예측이 일반전과 다른 이유와 BoatAI 활용법을 소개한다.",
    category: "상급자용",
    tags: ["SG경주", "그랑프리", "올스타", "등급전", "2026시즌"],
    readTime: "10분",
    image: "/images/blog/sg-race-timeline-ko.jpg",
  },
  {
    id: "how-to-predict-races",
    title: "경정 예상법 완전 가이드 — 데이터와 AI로 적중률을 높이는 방법",
    description:
      "1만 건 이상의 레이스 데이터로 알아보는 경정 예상의 6가지 핵심 요소. 선수 승률・모터・코스・ST・전시 항주・날씨를 읽는 법부터 AI 예상 활용법까지 초보자도 쉽게 배우는 가이드.",
    category: "초보자용",
    tags: ["예상법", "적중률", "초보자", "AI예상", "데이터분석"],
    readTime: "12분",
    image: "/images/blog/predict-steps-flow-ko.jpg",
  },
  {
    id: "trifecta-betting-guide",
    title: "삼쌍승 구매법 완전 공략 — 구매 조합 압축부터 자금 배분까지",
    description:
      "삼쌍승 회수율을 높이는 방법을 소개합니다. 축 선정법, 포메이션과 박스 구매의 차이, 구매 조합 수별 회수율 데이터, 자금 배분 노하우까지 실전 위주로 해설합니다.",
    category: "전략",
    tags: ["삼쌍승", "구매법", "포메이션", "자금관리", "마권"],
    readTime: "10분",
    image: "/images/blog/trifecta-formation-matrix-ko.jpg",
  },
  {
    id: "improve-recovery-rate",
    title:
      "경정 회수율을 100% 이상으로 끌어올리는 방법 — 1만 경주 데이터가 보여주는 현실",
    description:
      "공제율 25%의 벽을 넘어서기 위한 5가지 데이터 기반 전략 — 레이스 선별, 마권 종류 선택, 조합 관리, 자금 관리, AI 활용을 소개합니다.",
    category: "전략",
    tags: ["회수율", "승리법", "자금관리", "데이터분석", "공제율"],
    readTime: "10분",
    image: "/images/blog/improve-recovery-rate-hitrate-ko.jpg",
  },
  {
    id: "beginners-start-guide",
    title: "경정 초보자 가이드 — 마권 구매법부터 AI 예측 활용법까지",
    description:
      "경정을 처음 시작하는 분을 위한 완벽 가이드. 기본 규칙부터 7종류 마권 해설, 텔레보트(TELEBOAT) 등록 방법, 초보자에게 맞는 구매법과 예산 관리법까지 소개합니다.",
    category: "초보자용",
    tags: ["초보자", "시작하기", "마권구매", "텔레보트", "입문"],
    readTime: "10분",
    image: "/images/blog/beginners-bet-types-ko.jpg",
  },
  {
    id: "picks-performance-report",
    title: '"오늘의 추천" 회수율 104% 달성 — 2,577경주 실적 데이터',
    description:
      'BoatAI의 "오늘의 추천" 기능이 2,577경주에서 회수율 104%를 기록했습니다. 25%의 공제율을 넘어 플러스 수익을 유지하는 원리와 한계를 솔직하게 공개합니다.',
    category: "실적 분석",
    tags: ["오늘의추천", "회수율", "데이터마이닝", "실적공개"],
    readTime: "7분",
    image: "/images/blog/picks-performance-funnel-ko.jpg",
  },
  {
    id: "venue-visit-guide",
    title: "경정장 완전 정복 가이드 — 첫 방문에서 120% 즐기는 법",
    description:
      "경정장은 마권을 사는 곳만이 아닙니다. 입장료 100엔, 경기장 별미, 나이터 레이스, 데이트 코스로도 손색없는 매력까지. 준비물, 예산 짜기, 초보자를 위한 팁까지 현장에서 120% 즐기는 법을 담은 완전 가이드입니다.",
    category: "초보자용",
    tags: ["경정장", "즐기는법", "초보자", "먹거리", "나이터", "관전가이드"],
    readTime: "12분",
    image: "/images/blog/venue-visit-timeline-ko.jpg",
  },
  {
    id: "picks-guide",
    title:
      '"오늘의 추천" 기능 사용법 — 데이터 마이닝이 선별하는 고회수율 레이스',
    description:
      'BoatAI의 "오늘의 추천" 기능을 완전 분석합니다. 15개 경정장·34개 패턴에 걸친 데이터 마이닝이 회수율 100% 이상 레이스를 자동으로 찾아내는 원리, 화면 보는 법, 베팅 방식별 활용법까지 소개합니다.',
    category: "사용법",
    tags: ["오늘의추천", "데이터마이닝", "회수율", "사용법", "패턴매칭"],
    readTime: "8분",
    image: "/images/blog/picks-compare-table-ko.jpg",
  },
  {
    id: "10000-races-analysis",
    title: "BoatAI 1만 경주 돌파 - 데이터로 보는 AI 예측의 실력과 한계",
    description:
      "BoatAI의 누적 분석 경주 수가 1만 건을 돌파했습니다. 12,324경주의 데이터가 보여주는 단승 적중률 47.4%, 삼복승 적중률 18.0%, 그리고 회수율의 실제 과제를 솔직하게 짚어봅니다.",
    category: "실적 분석",
    tags: ["1만경주", "실적분석", "적중률", "회수율", "삼복승", "데이터공개"],
    readTime: "10분",
    image: "/images/blog/10000-races-hitrate-ko.jpg",
  },
  {
    id: "sg-g1-race-strategy",
    title: "SG・G1 경주에서 승리하는 전략 【그레이드 경주 공략】",
    description:
      "SG・G1 등급전은 일반전과는 완전히 다른 승부다. 예선과 결승에서 배팅 방식을 달리하는 법, 득점율 활용법, 드림전을 노리는 방법까지 정리했다.",
    category: "상급자용",
    tags: ["SG", "G1", "그레이드경주", "전략", "득점율"],
    readTime: "12분",
    image: "/images/blog/sg-grade-tiers-ko.jpg",
  },
  {
    id: "special-planned-races",
    title:
      '"기획 레이스"란? 초보자에게 추천하는 이유【안정적인 레이스 찾는 법】',
    description:
      "1호정 A급 고정처럼 편성 자체가 안정적인 기획 레이스는 초보자도 예상하기 쉽습니다. 기획 레이스의 종류, 찾는 법, 구매 전략까지 상세히 안내합니다.",
    category: "초보자용",
    tags: ["기획레이스", "초보자", "1호정", "A급고정", "안정적인레이스"],
    readTime: "9분",
    image: "/images/blog/planned-race-types-ko.jpg",
  },
  {
    id: "venue-ashiya",
    title: "아시야 경정장 공략 가이드 — 일본 최고 수준의 인코스 강세 경기장",
    description:
      "BoatAI 실적 데이터로 살펴보는 아시야 경정장의 특징과 공략법. 일본에서 손꼽히는 인코스 강세 경기장입니다.",
    category: "경기장별 공략",
    tags: ["아시야", "경정장", "공략법", "인코스강세"],
    readTime: "5분",
  },
  {
    id: "how-we-measure-accuracy",
    title: "BoatAI의 실적은 진짜일까? 계측 방법과 투명성을 철저히 해설",
    description:
      "BoatAI는 적중률과 회수율을 실제로 어떻게 계측할까요? 왜 모든 데이터를 공개할까요? BoatAI 실적의 신뢰성과 투명성을 철저히 해설합니다.",
    category: "데이터 분석",
    tags: ["실적", "적중률", "회수율", "투명성", "계측방법"],
    readTime: "12분",
    image: "/images/blog/return-rate-ledger-ko.jpg",
  },
  {
    id: "ai-vs-human",
    title: "AI 예측 vs 인간 예측, 1개월 실전 대결 검증 결과【데이터 공개】",
    description:
      "AI가 고른 조합과 인간이 고른 조합, 어느 쪽이 더 잘 맞을까? 2025년 12월 한 달간 실시한 실전 대결 검증 데이터를 공개합니다.",
    category: "데이터 분석",
    tags: ["AI예측", "검증", "데이터", "비교"],
    readTime: "11분",
    image: "/images/blog/ai-vs-human-comparison-ko.jpg",
  },
  {
    id: "rough-race-signals",
    title:
      "이변이 발생하는 레이스를 예측하는 5가지 신호 — AI가 1,899경기에서 발견",
    description:
      "이변 레이스를 미리 감지할 수 있다면 마권 전략이 달라집니다. BoatAI가 1,899경기를 분석해 이변 레이스에 공통된 5가지 신호를 찾아냈습니다.",
    category: "초보자용",
    tags: ["이변레이스", "예측", "신호", "판별법", "마권전략"],
    readTime: "10분",
    image: "/images/blog/signals-probability-ko.jpg",
  },
  {
    id: "stadium-strategy-guide",
    title: "회장별 공략 가이드 — 24개 경정장의 특징과 노려야 할 포인트",
    description:
      "승리 패턴은 회장마다 완전히 다릅니다. 전국 24개 경정장의 특징, 1번정 승률, 인코스와 아웃코스 중 어느 쪽이 유리한지를 총정리한 완전 가이드.",
    category: "전략",
    tags: ["경정장", "공략법", "회장특징", "1번정승률"],
    readTime: "15분",
  },
  {
    id: "monthly-50k-roadmap",
    title: "경정으로 월 5만 엔 부수입 버는 로드맵 [재현성 중시]",
    description:
      "월 5만 엔을 목표로 하는 자금 관리법과 BoatAI 데이터 분석을 베팅에 활용하는 방법을 소개합니다.",
    category: "전략",
    tags: ["경정", "자금관리", "월5만엔", "데이터활용"],
    readTime: "12분",
    image: "/images/blog/roadmap-steps-ko.jpg",
  },
  {
    id: "why-you-lose",
    title: "경정에서 이기지 못하는 사람들의 5가지 공통점과 AI예측의 해결책",
    description:
      "경정에서 왜 이기지 못할까? 1,899경기 분석으로 밝혀진 패배 패턴과 AI예측이 이를 해결하는 방법을 소개합니다.",
    category: "초보자용",
    tags: ["경정", "AI예측", "이기지못함", "패배패턴"],
    readTime: "10분",
  },
  {
    id: "odds-expected-value-guide",
    title: "경정 배당률 보는 법 — 기대값으로 마권을 고르는 방법",
    description:
      "경정 배당률의 구조와 기대값 사고법을 데이터로 해설. 과잉 인기의 함정, 배당률 왜곡을 노리는 법, 마권 종류별 손익분기 배당률까지 다룹니다.",
    category: "데이터 분석",
    tags: ["배당률", "기대값", "과잉인기", "마권전략", "데이터분석"],
    readTime: "9분",
    image: "/images/blog/odds-expected-value-matrix-ko.jpg",
  },
];

export function getKoreanOverride(id) {
  return blogPostsKo.find((post) => post.id === id);
}

export function isKoreanAvailable(id) {
  return blogPostsKo.some((post) => post.id === id);
}
