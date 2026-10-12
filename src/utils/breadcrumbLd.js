/**
 * パンくずの BreadcrumbList（構造化データ）を組む。画面の Breadcrumb と、ボット向け HTML（ADR 0089）が同じ値を出す。
 * Node からも import するため、ブラウザ専用の依存を持ち込まない。
 */
const SITE_ORIGIN = "https://www.boat-ai.jp";

/**
 * 名前か URL が欠けた項目があるときは JSON-LD を出さない。壊れた BreadcrumbList（item が ".../undefined"）は
 * Search Console でエラーになる。呼び出し側の渡し方の誤り（{label, path} 等）は e2e で検知する
 *
 * @param {unknown} items
 * @returns {boolean}
 */
export function isValidCrumbs(items) {
  return (
    Array.isArray(items) &&
    items.length > 0 &&
    items.every(
      (item) =>
        typeof item?.name === "string" &&
        item.name !== "" &&
        typeof item?.url === "string" &&
        item.url !== "",
    )
  );
}

/**
 * @param {{name: string, url: string}[]} items - 画面のパンくずと同じ並び。url はサイト内のパス
 */
export function toBreadcrumbListLd(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: new URL(item.url, SITE_ORIGIN).href,
    })),
  };
}
