/**
 * RacePitReportSection - 選手コメント（公式のピットレポート）の部品（BOA-379）
 *
 * 公式のピットレポート（SG全レース・G1/G2の7R以降）のコメントを、要約・改変せず
 * そのまま表示する。設計・決定事項は docs/design/pit-comments/screens.md
 * （§3 構成・§4 状態・§8 モックでの確認結果）。
 *
 * 形は design-system「表とグラフ」1（題・副題 → 本体 → 💡注記）。2026-11-24 部品化:
 * - 出典はカード上部（副題の下）に1回だけ。レポーター名は表示しない（DBには保存を続ける）
 * - コメント自信度（★）は公式の表記のまま出し、★の意味は説明しない
 * - 公開待ちのカードは表示する
 * - 対象外（G3・一般戦・G1/G2の1R〜6R、公式が対象外と答えたレース）も注記の1行を出す
 *   （9/23 の「セクションごと出さない」を変えた。コメントが「取れていない」のか
 *   「そもそも無い」のかを見分けられるようにする。オーナー 11/24「選手コメントが
 *   取得できていない、もしくは表示できていない」）
 *
 * 匿名にSELECT権限が無い場合（マイグレーション086が未適用）だけは、カードごと描画しない。
 * 取得エラーは「対象外」「未公開」に化けさせず、再読み込みボタンを出す（BOA-359）。
 */
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { parseRaceId } from "../../utils/raceId";
import {
  buildPitReportUrl,
  isPitReportCandidate,
  PIT_REPORT_GRADES,
} from "../../utils/pitReportUrl";
import { trackEvent } from "../../utils/analytics";
import { PitReportPublished } from "./RacePitReportSectionParts";
import { usePitReportFetch } from "./RacePitReportSectionFetch";
import "./RacePitReportSection.css";

// G1・G2（SG 以外の対象グレード）。この2つで候補から外れるのは1R〜6Rだけ
const isNonSgCandidateGrade = (grade) =>
  grade !== "SG" && PIT_REPORT_GRADES.includes(grade);

// 対象外の理由（null は対象）。グレードの規則で外れたか、公式ページが対象外と答えたか
function notTargetReason({ isCandidate, raceGrade, report }) {
  if (!isCandidate)
    return isNonSgCandidateGrade(raceGrade) ? "earlyRace" : "grade";
  return report?.state === "not_target" ? "official" : null;
}

function RacePitReportSection({ raceId, raceGrade, players }) {
  const { t, i18n } = useTranslation();
  const parsed = parseRaceId(raceId);
  const isCandidate =
    Boolean(parsed) &&
    isPitReportCandidate({ raceGrade, raceNumber: parsed.raceNo });
  const { report, failed, loading, retry } = usePitReportFetch(
    raceId,
    isCandidate,
  );

  const officialUrl = buildPitReportUrl(raceId);
  const handleSourceClick = useCallback(() => {
    trackEvent("pit_report_source_click", { race_id: raceId });
  }, [raceId]);

  if (!parsed) return null;
  // 086（匿名へのSELECT公開）が未適用の間は、カードごと出さない（本番の公開順序の保険）
  if (report?.state === "forbidden") return null;

  const heading = <h3 className="rbi-heading">{t("pitReport.heading")}</h3>;

  // 対象外: カードにせず注記の大きさの1行だけ出す（無いのか取れていないのかを見分けるため。
  // 一般戦の大半のレースに空のカードを置かない。2026-11-24 visual-designer の判定）。
  // 文は出ない理由ごとに分ける。取得エラー・公開待ちはここに来ない（化けさせない）
  const outReason = notTargetReason({ isCandidate, raceGrade, report });
  if (outReason) {
    return (
      <p className="rbi-note rpr-out" data-state={`not-target-${outReason}`}>
        {t(`pitReport.notTarget.${outReason}`)}
      </p>
    );
  }

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
        <button type="button" className="rpr-retry" onClick={retry}>
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

  return (
    <PitReportPublished
      report={report}
      players={players}
      heading={heading}
      officialLink={officialLink}
      t={t}
      i18n={i18n}
    />
  );
}

export default RacePitReportSection;
