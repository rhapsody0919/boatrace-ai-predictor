export const TITLE = "なぜ完全無料？運営者プロフィール | 龍神レーダー";
export const DESCRIPTION =
  "なぜ完全無料で提供しているのか。龍神レーダー運営者「らぷそでぃ」のプロフィール。インフラエンジニアとしての経験を活かし、ボートレースAI予想サービスを開発した経緯と開発の裏話をご紹介します。";
export const SOCIAL_META = {
  title: TITLE,
  description: DESCRIPTION,
  url: "https://www.boat-ai.jp/profile",
  keywords:
    "龍神レーダー,運営者,プロフィール,らぷそでぃ,インフラエンジニア,AI開発",
};

export function buildPersonSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    mainEntity: {
      "@type": "Person",
      name: "らぷそでぃ",
      jobTitle: "インフラエンジニア",
      description: "龍神レーダー開発者",
      url: "https://www.boat-ai.jp/profile",
      sameAs: ["https://x.com/kyouteiboatai"],
    },
  };
}

export function buildBreadcrumbSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "ホーム",
        item: "https://www.boat-ai.jp/",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "運営者プロフィール",
        item: "https://www.boat-ai.jp/profile",
      },
    ],
  };
}
