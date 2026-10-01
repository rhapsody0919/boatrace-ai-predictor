// サイト共通フッターのリンク一覧。App本体と、App外で描画される各言語ガイド（/en/guide 等）で共有する
export function getSiteFooterLinks(t) {
  return [
    { to: "/blog", label: t("footer.blog") },
    { to: "/about", label: "About" },
    { to: "/profile", label: t("footer.operator") },
    { to: "/faq", label: "FAQ" },
    { to: "/privacy", label: t("footer.privacy") },
    { to: "/terms", label: t("footer.terms") },
    { to: "/contact", label: t("footer.contact") },
    { to: "/responsible-gambling", label: t("footer.responsibleGambling") },
  ];
}
