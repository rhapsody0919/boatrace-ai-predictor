import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { parseLangFromPath } from "../../config/languages";
import { SITE_UPDATES } from "../../data/siteUpdates.js";
import { pickBannerItem } from "../../pure/siteUpdates.js";
import { trackEvent } from "../../utils/analytics.js";
import "./SiteUpdatesBanner.css";

// i18n-allow-file: ja のトップでだけ描く（遷移先の /updates が ja 専用）
// ja のトップの「更新のお知らせ」の1行の帯（docs/design/site-updates/ spec R5）。
// 閉じた件の id を端末に1つ覚える。boatai-user: はキャッシュの全削除（boatai:*）で消えない名前空間
const DISMISSED_KEY = "boatai-user:site-updates-dismissed";

// 読めないとき（プライベートの窓・保存の拒否）は「閉じていない」とみなし、帯を出す側に倒す
const readDismissed = () => {
  try {
    return window.localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
};

const writeDismissed = (id) => {
  try {
    window.localStorage.setItem(DISMISSED_KEY, id);
  } catch {
    // 保存できなくても、この表示の間は閉じる（次の読み込みでまた出る。spec の状態の表）
  }
};

// /updates と同じ「MM/DD」
const shortDate = (date) => `${date.slice(5, 7)}/${date.slice(8, 10)}`;

export default function SiteUpdatesBanner() {
  // 言語は Header と同じく URL から決める（i18n の切り替えは描画の後なので、/en の初回に一瞬出さない）
  const isJa = parseLangFromPath(useLocation().pathname).lng === "ja";
  // 閉じた記録は最初の描画の前に同期で読む（後から消すと下の中身が動く）
  const [dismissedId, setDismissedId] = useState(readDismissed);
  const item = isJa ? pickBannerItem(SITE_UPDATES, new Date(), dismissedId) : null;
  const itemId = item?.id;

  useEffect(() => {
    if (itemId) trackEvent("site_updates_banner_view", { update_id: itemId });
  }, [itemId]);

  if (!item) return null;

  const dismiss = () => {
    writeDismissed(item.id);
    setDismissedId(item.id);
    trackEvent("site_updates_banner_dismiss", { update_id: item.id });
  };

  return (
    <aside className="site-updates-banner" aria-label="更新のお知らせ">
      <Link
        to="/updates"
        className="site-updates-banner-link"
        onClick={() =>
          trackEvent("site_updates_banner_click", { update_id: item.id })
        }
      >
        <span className="site-updates-banner-meta">
          <span className="site-updates-new">NEW</span>
          <time dateTime={item.date}>{shortDate(item.date)}</time>
        </span>
        <strong className="site-updates-banner-title">{item.title}</strong>
        <span className="site-updates-banner-go">更新のお知らせを見る →</span>
      </Link>
      <button
        type="button"
        className="site-updates-banner-close"
        aria-label="このお知らせを閉じる"
        onClick={dismiss}
      >
        ×
      </button>
    </aside>
  );
}
