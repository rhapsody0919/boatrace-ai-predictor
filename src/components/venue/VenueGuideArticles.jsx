// i18n-allow-file: ja のときだけ描画する部品（ja 以外では何も出さない。記事の題は ja のメタデータ、BOA-1692）
/**
 * VenueGuideArticles - 会場ページの「<会場>の攻略記事」の節（BOA-1692 GS02 V2）
 *
 * V1 のコース別の節（VenueCourseSection）の直後に、その会場の場別攻略の記事を最大3本出す。
 * 選び方は src/pure/venueGuideArticles.js。1本も無い会場・ja 以外では節を DOM に置かない。
 * 新しい DB の読みは無い（記事のメタデータは静的）
 */
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { blogPosts } from "../../data/blogPosts";
import {
  selectVenueGuideArticles,
  venueGuideTitle,
} from "../../pure/venueGuideArticles";
import "./VenueGuideArticles.css";

export default function VenueGuideArticles({ venueCode }) {
  const { t, i18n } = useTranslation();
  if (i18n.language !== "ja") return null;
  const venueName = t(`venues.${venueCode}`);
  const posts = selectVenueGuideArticles(blogPosts, venueName);
  if (posts.length === 0) return null;
  return (
    <section
      className="venue-guide-articles"
      data-testid="venue-guide-articles"
      aria-labelledby="venue-guide-articles-title"
    >
      <h2 id="venue-guide-articles-title">{venueName}の攻略記事</h2>
      <ul className="venue-guide-articles__list">
        {posts.map((post) => (
          <li key={post.id}>
            <Link
              to={`/blog/${post.id}`}
              className="venue-guide-articles__card"
              data-testid="venue-guide-article"
            >
              <span className="venue-guide-articles__badge">
                {post.category}
              </span>
              <span className="venue-guide-articles__title">
                {venueGuideTitle(post.title)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
