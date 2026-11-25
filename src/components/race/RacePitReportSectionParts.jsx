import BoatBadge from "./BoatBadge";
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

function PitCommentCard({ comment, player, selected, t }) {
  return (
    <li
      className={selected ? "rpr-comment is-selected" : "rpr-comment"}
      data-boat={comment.boatNumber}
      aria-current={selected ? "true" : undefined}
    >
      <div className="rpr-comment-head">
        <BoatBadge n={comment.boatNumber} />
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
  focusedBoat,
  heading,
  officialLink,
  t,
  i18n,
}) {
  const playerByBoat = new Map((players ?? []).map((p) => [p.number, p]));
  const capturedAt = formatCapturedAtJst(report.capturedAt);
  // 選んだ艇にコメントが無いとき、行が無い理由を注記の末尾に書く（行は足さない）
  const focusedWithoutComment =
    focusedBoat != null &&
    !report.comments.some((c) => c.boatNumber === focusedBoat);

  return (
    <section className="rbi-card rpr-card">
      {heading}

      {/* 副題と出典。出典（名前・取得時刻・公式へのリンク）はカード上部に1回
          （ADR-0067 のピットレポートの追記）。語の途中で折れないよう塊ごとに分ける */}
      <p className="rpr-subtitle">{t("pitReport.subtitle")}</p>
      <p className="rpr-source">
        <span className="rpr-source-part">{t("pitReport.source")}</span>
        {officialLink}
        {capturedAt && (
          <span className="rpr-source-part">
            {t("pitReport.capturedAt", { time: capturedAt })}
            {t("home.jstNote")}
          </span>
        )}
      </p>

      <ul className="rpr-comment-list">
        {report.comments.map((comment) => (
          <PitCommentCard
            key={comment.boatNumber}
            comment={comment}
            player={playerByBoat.get(comment.boatNumber)}
            selected={comment.boatNumber === focusedBoat}
            t={t}
          />
        ))}
      </ul>

      <p className="rbi-note">
        💡 {t("pitReport.cardNote")}
        {focusedWithoutComment && (
          <>
            {" "}
            <strong className="rpr-no-comment">
              {t("pitReport.noCommentForBoat", { n: focusedBoat })}
            </strong>
          </>
        )}
      </p>
      {i18n.language !== "ja" && (
        <p className="rbi-note">{t("pitReport.originalLanguageNote")}</p>
      )}
    </section>
  );
}
