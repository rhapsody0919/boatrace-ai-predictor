/**
 * トップの「よくある質問」（HomeAiIntro）の問い・答えと FAQPage の JSON-LD を組む純粋な関数。
 * 人の画面（src/components/HomeAiIntro.jsx）とボット向け HTML（src/utils/botPageModel.js の buildTopModel）が
 * 同じ関数を使い、画面の文字列と JSON-LD が食い違わないようにする（ADR 0089 決定3）。
 *
 * 思考アシストの切り替えはレース詳細で ja のときだけ出る（RaceDetailPage の showViewSwitch）ので、
 * 思考アシストに触れる問い・答えは、ja 以外では龍神ソナーだけの言い方（*SonarOnly）に替える。
 */
const FAQ_KEYS = [
  { q: "q1", a: "a1", aSonarOnly: "a1SonarOnly" },
  { q: "q2", a: "a2", aSonarOnly: "a2SonarOnly" },
  { q: "q3", a: "a3", qSonarOnly: "q3SonarOnly", aSonarOnly: "a3SonarOnly" },
  { q: "q4", a: "a4" },
  { q: "q5", a: "a5" },
];

/** 思考アシストのカード・文を出すか（ja だけ。人の画面は i18n.resolvedLanguage を渡す） */
export const isAssistShown = (lang) => lang === "ja";

/**
 * @param {(key: string) => string} t
 * @param {boolean} showAssist - isAssistShown の値
 * @returns {{question: string, answer: string}[]}
 */
export function buildFaqItems(t, showAssist) {
  const pick = (key, sonarOnlyKey) =>
    t(`home.aiIntro.faq.${!showAssist && sonarOnlyKey ? sonarOnlyKey : key}`);
  return FAQ_KEYS.map((k) => ({
    question: pick(k.q, k.qSonarOnly),
    answer: pick(k.a, k.aSonarOnly),
  }));
}

/** @param {{question: string, answer: string}[]} items */
export function toFaqPageLd(items) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
}
