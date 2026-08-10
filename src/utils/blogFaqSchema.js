function stripMarkdown(text) {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

/**
 * ブログ記事本文の「## よくある質問」（英語版は「## FAQ」）セクションからQ&Aを抽出する。
 * セクションが無い記事（大半の旧記事）は空配列を返す。
 */
export function extractFaqItems(markdown) {
  const headingMatch = markdown.match(/^##\s*(よくある質問|FAQ)\s*$/m);
  if (!headingMatch) return [];

  const afterHeading = markdown.slice(
    headingMatch.index + headingMatch[0].length,
  );
  const nextHeadingMatch = afterHeading.match(/\n##\s/);
  const sectionText = nextHeadingMatch
    ? afterHeading.slice(0, nextHeadingMatch.index)
    : afterHeading;

  const blocks = sectionText.split(/\n###\s+/).slice(1);
  return blocks
    .map((block) => {
      const newlineIndex = block.indexOf("\n");
      const question =
        newlineIndex === -1 ? block : block.slice(0, newlineIndex);
      const rawAnswer =
        newlineIndex === -1 ? "" : block.slice(newlineIndex + 1);
      const answer = rawAnswer.replace(/\n+---[\s\S]*$/, "").trim();
      return {
        question: stripMarkdown(question),
        answer: stripMarkdown(answer),
      };
    })
    .filter((item) => item.question && item.answer);
}

export function buildFaqPageSchema(faqItems) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}
