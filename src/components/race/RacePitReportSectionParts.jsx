import { BOAT_COLORS } from "../../utils/colors";
import TermHintButton from "./TermHintButton";
import { formatCapturedAtJst } from "../../utils/formatters";

const CONFIDENCE_MAX = 3;

function ConfidenceStars({ stars, t }) {
  if (!Number.isInteger(stars) || stars < 0 || stars > CONFIDENCE_MAX) {
    return null;
  }
  const filled = "★".repeat(stars);
  const empty = "☆".repeat(CONFIDENCE_MAX - stars);
  return (
    <div className="rpr-confidence">
      <span className="rpr-confidence-label">{t("pitReport.confidence")}</span>
      <TermHintButton termKey="pitConfidence" />
      <span
        className="rpr-stars"
        role="img"
        aria-label={t("pitReport.confidenceAria", {
          n: stars,
          max: CONFIDENCE_MAX,
        })}
      >
        <span className="rpr-stars-filled" aria-hidden="true">
          {filled}
        </span>
        <span className="rpr-stars-empty" aria-hidden="true">
          {empty}
        </span>
      </span>
    </div>
  );
}

function PitCommentCard({ comment, player, t }) {
  const color = BOAT_COLORS[comment.boatNumber] || {};
  return (
    <li className="rpr-comment">
      <div className="rpr-comment-head">
        <span
          className="rpr-boat-chip"
          style={{ background: color.bg, color: color.text }}
        >
          {comment.boatNumber}
        </span>
        {player?.name ? (
          <span className="rpr-racer-name" translate="no">
            {/* 出走表の名前は姓と名の間を全角スペースで詰めてある。結果タブと同じく
                空白を1つにまとめる（「峰\u3000竜太」→「峰 竜太」。BOA-618） */}
            {player.name.replace(/\s+/g, " ").trim()}
          </span>
        ) : (
          <span className="rpr-racer-name" translate="no">
            {comment.racerId ?? "-"}
          </span>
        )}
        {player?.grade && (
          <span className="rpr-racer-rank">{player.grade}</span>
        )}
        {comment.previousRaceNumber != null && (
          <span className="rpr-prev-race">
            {t("pitReport.previousRace", { n: comment.previousRaceNumber })}
          </span>
        )}
      </div>
      <p className="rpr-comment-text" lang="ja">
        {comment.text}
      </p>
      <ConfidenceStars stars={comment.stars} t={t} />
    </li>
  );
}

export function PitReportPublished({
  report,
  players,
  heading,
  officialLink,
  t,
  i18n,
}) {
  const playerByBoat = new Map((players ?? []).map((p) => [p.number, p]));
  const capturedAt = formatCapturedAtJst(report.capturedAt);

  return (
    <section className="rbi-card rpr-card">
      {heading}

      <div className="rpr-source">
        <p className="rpr-source-text">{t("pitReport.source")}</p>
        {capturedAt && (
          <p className="rpr-source-text">
            {t("pitReport.capturedAt", { time: capturedAt })}
            {t("home.jstNote")}
          </p>
        )}
        {officialLink}
      </div>

      <ul className="rpr-comment-list">
        {report.comments.map((comment) => (
          <PitCommentCard
            key={comment.boatNumber}
            comment={comment}
            player={playerByBoat.get(comment.boatNumber)}
            t={t}
          />
        ))}
      </ul>

      <p className="rbi-note">{t("pitReport.note")}</p>
      {i18n.language !== "ja" && (
        <p className="rbi-note">{t("pitReport.originalLanguageNote")}</p>
      )}
    </section>
  );
}
