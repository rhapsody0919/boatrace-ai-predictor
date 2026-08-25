import "./RacerNewsList.css";

/**
 * 選手個別ページのニュース一覧
 * 出典リンク付き・要約のみ表示（全文転載しない、著作権配慮）
 */
export default function RacerNewsList({ news }) {
  if (!news || news.length === 0) {
    return (
      <div className="racer-news-list racer-news-list-empty">
        <h2>ニュース</h2>
        <p>まだニュースはありません。</p>
      </div>
    );
  }

  return (
    <div className="racer-news-list">
      <h2>ニュース</h2>
      {news.map((item) => (
        <article className="racer-news-item" key={item.id}>
          <h3>{item.title}</h3>
          <p>{item.summary}</p>
          <a
            href={item.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="racer-news-source"
          >
            {item.source_name || "出典を見る"} →
          </a>
        </article>
      ))}
    </div>
  );
}
