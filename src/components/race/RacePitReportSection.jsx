/**
 * RacePitReportSection - ピットレポート（選手コメント）セクション（BOA-379）
 *
 * 公式のピットレポート（SG全レース・G1/G2の7R以降）のコメントを、要約・改変せず
 * そのまま表示する。設計・決定事項は docs/design/pit-comments/screens.md
 * （§3 構成・§4 状態・§8 モックでの確認結果）。
 *
 * 決定（2026-09-23、モック承認）:
 * - 直前情報タブの「詳細テーブル」カードの直後に置く（案A）
 * - 出典はセクション上部に1回だけ。レポーター名は表示しない（DBには保存を続ける）
 * - コメント自信度（★）は公式の表記のまま出し、★の意味は説明しない
 *   （公式ページに定義が無いため。ヒントにもその旨だけを書く）
 * - 公開待ちのカードは表示する
 *
 * 対象外（G3・一般戦・G1/G2の1R〜6R）と、匿名にSELECT権限が無い場合
 * （マイグレーション086が未適用）は、セクションごと描画しない（nullを返す）。
 * 取得エラーは「対象外」「未公開」に化けさせず、再読み込みボタンを出す（BOA-359）。
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import { supabaseDataService } from "../../services/supabaseDataService";
import { parseRaceId } from "../../utils/raceId";
import {
  buildPitReportUrl,
  isPitReportCandidate,
} from "../../utils/pitReportUrl";
import { trackEvent } from "../../utils/analytics";
import TermHintButton from "./TermHintButton";
import "./RacePitReportSection.css";

const CONFIDENCE_MAX = 3;

// ロケールによる並び順・桁揃えの差を受けないよう、部品で取り出してから組み立てる
// （month/dayに"numeric"を指定しても、hourと組み合わせると2桁に揃うロケールがある）
const JST_DATETIME_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** 取得時刻（ISO文字列）を「9/18 15:42」（JST）にする。読めなければnull */
function formatCapturedAt(capturedAt) {
  if (!capturedAt) return null;
  const date = new Date(capturedAt);
  if (Number.isNaN(date.getTime())) return null;
  const parts = JST_DATETIME_FORMAT.formatToParts(date);
  const pick = (type) => parts.find((p) => p.type === type)?.value ?? "";
  const month = Number(pick("month"));
  const day = Number(pick("day"));
  if (!month || !day) return null;
  return `${month}/${day} ${pick("hour")}:${pick("minute")}`;
}

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
            {player.name}
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

function RacePitReportSection({ raceId, raceGrade, players }) {
  const { t, i18n } = useTranslation();
  const parsed = parseRaceId(raceId);
  const isCandidate =
    Boolean(parsed) &&
    isPitReportCandidate({ raceGrade, raceNumber: parsed.raceNo });

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isCandidate) {
      setReport(null);
      setLoading(false);
      setFailed(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    supabaseDataService
      .getRacePitReport(raceId)
      .then((data) => {
        if (cancelled) return;
        setReport(data);
        setLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("ピットレポート取得エラー:", error);
        setFailed(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [raceId, isCandidate, reloadKey]);

  const officialUrl = buildPitReportUrl(raceId);
  const handleSourceClick = useCallback(() => {
    trackEvent("pit_report_source_click", { race_id: raceId });
  }, [raceId]);

  if (!isCandidate) return null;
  // 086（匿名へのSELECT公開）が未適用の間、および公式が「対象外」と答えたレースは、
  // セクションごと出さない（空のカードも「対象外です」の文言も出さない）
  if (report?.state === "forbidden" || report?.state === "not_target") {
    return null;
  }

  const heading = <h3 className="rbi-heading">{t("pitReport.title")}</h3>;

  const officialLink = officialUrl && (
    <a
      className="rpr-source-link"
      href={officialUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleSourceClick}
    >
      {t("pitReport.officialLink")} ↗
    </a>
  );

  if (loading) {
    return (
      <section className="rbi-card rpr-card">
        {heading}
        <span className="drt-loading-chip">{t("dataTable.loading")}</span>
      </section>
    );
  }

  if (failed) {
    return (
      <section className="rbi-card rpr-card">
        {heading}
        <p className="rpr-error">{t("pitReport.error")}</p>
        <button
          type="button"
          className="rpr-retry"
          onClick={() => setReloadKey((n) => n + 1)}
        >
          {t("pitReport.retry")}
        </button>
      </section>
    );
  }

  if (report?.state === "pending") {
    return (
      <section className="rbi-card rpr-card">
        {heading}
        <p className="rpr-pending">{t("pitReport.pending")}</p>
        {officialLink}
      </section>
    );
  }

  if (report?.state !== "published" || report.comments.length === 0) {
    return null;
  }

  const playerByBoat = new Map((players ?? []).map((p) => [p.number, p]));
  const capturedAt = formatCapturedAt(report.capturedAt);

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

export default RacePitReportSection;
