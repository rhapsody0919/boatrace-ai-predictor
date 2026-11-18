import { getLatestPosts } from "./data/blogPosts";
import { formatDateLongLocalized } from "./utils/formatters";

// リトライ機能付きfetch関数（HitRacesが使用）
export const fetchWithRetry = async (url, maxRetries = 3, retryDelay = 2000) => {
  let lastError;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      console.warn(`取得失敗 (${i + 1}/${maxRetries}):`, error.message);

      if (i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }

  throw lastError;
};

function getBlogUpdatedText(t, i18n) {
  const latestPost = getLatestPosts(1, i18n.resolvedLanguage)[0];
  return latestPost
    ? t("home.blogLastUpdated", {
        date: formatDateLongLocalized(latestPost.date, i18n.resolvedLanguage),
      })
    : "";
}

export function renderFooterExtra(t, i18n) {
  return (
    <>
      <p>{t("home.disclaimer")}</p>
      <p className="site-footer-updated">{getBlogUpdatedText(t, i18n)}</p>
    </>
  );
}
