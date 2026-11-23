import { Link } from "react-router-dom";
import Header from "../components/Header";
import { SITE_MAKING, SITE_UPDATES } from "../data/siteUpdates.js";
import { groupUpdatesByMonth, visibleUpdates } from "../pure/siteUpdates.js";
import { trackEvent } from "../utils/analytics.js";
import "./SiteUpdates.css";

// 更新のお知らせ（/updates、ja 専用）。設計: docs/design/site-updates/
const KIND_LABEL = { feature: "新機能", improvement: "改善" };
const CANONICAL = "https://www.boat-ai.jp/updates";
const DESCRIPTION =
  "龍神レーダーで新しく見られるようになったこと・見やすくしたことを、新しい順に並べています。ボートレースのデータ分析の機能の更新のお知らせです。";

const shortDate = (date) => `${date.slice(5, 7)}/${date.slice(8, 10)}`;

const trackLink = (id, link) => () =>
  trackEvent("site_updates_item_click", { update_id: id, link });

function UpdateItem({ item }) {
  return (
    <li className="site-updates-item">
      <time className="site-updates-date" dateTime={item.date}>
        {shortDate(item.date)}
      </time>
      <div className="site-updates-item-main">
        <h3 className="site-updates-item-title">
          <span className={`site-updates-tag site-updates-tag--${item.kind}`}>
            {KIND_LABEL[item.kind]}
          </span>
          {item.title}
        </h3>
        <p className="site-updates-item-body">{item.body}</p>
        {(item.path || item.blogId) && (
          <p className="site-updates-links">
            {item.path && (
              <Link to={item.path} onClick={trackLink(item.id, "try")}>
                見てみる →
              </Link>
            )}
            {item.blogId && (
              <Link
                to={`/blog/${item.blogId}`}
                onClick={trackLink(item.id, "blog")}
              >
                使い方の記事 →
              </Link>
            )}
          </p>
        )}
      </div>
    </li>
  );
}

function MinorList({ items }) {
  if (items.length === 0) return null;
  return (
    <details className="site-updates-minor">
      <summary>ほか細かい改善 {items.length}件</summary>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <time dateTime={item.date}>{shortDate(item.date)}</time>{" "}
            {item.title}
          </li>
        ))}
      </ul>
    </details>
  );
}

function MakingBox() {
  if (SITE_MAKING.length === 0) return null;
  return (
    <section className="site-updates-making" aria-labelledby="site-updates-making-h">
      <h2 id="site-updates-making-h">今つくっている物</h2>
      <ul>
        {SITE_MAKING.map((m) => (
          <li key={m.id}>{m.title}</li>
        ))}
      </ul>
      <p>できあがったら下の一覧に載せます。</p>
    </section>
  );
}

export default function SiteUpdates() {
  const months = groupUpdatesByMonth(visibleUpdates(SITE_UPDATES));
  return (
    <>
      <title>更新のお知らせ｜龍神レーダー</title>
      <meta name="description" content={DESCRIPTION} />
      <link rel="canonical" href={CANONICAL} />
      <Header />
      <main className="site-updates">
        <header className="site-updates-head">
          <h1>更新のお知らせ</h1>
          <p>
            龍神レーダーで新しく見られるようになったこと・見やすくしたことを、新しい順に並べています。
          </p>
        </header>
        <MakingBox />
        {months.length === 0 && <p>まだお知らせはありません。</p>}
        {months.map((m) => (
          <section key={m.month} className="site-updates-month">
            <h2 className="site-updates-month-title">{m.label}</h2>
            <ol className="site-updates-list">
              {m.main.map((item) => (
                <UpdateItem key={item.id} item={item} />
              ))}
            </ol>
            <MinorList items={m.minor} />
          </section>
        ))}
        <p className="site-updates-disclaimer">
          龍神レーダーは過去の実績や公式のデータを並べるもので、結果を保証するものではありません。舟券の投票は、日本国内に住む20歳以上の方だけができます。
        </p>
      </main>
    </>
  );
}
