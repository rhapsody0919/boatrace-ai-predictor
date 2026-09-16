import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { GRADE_LABELS } from "./raceGradeLabels";
import { formatPayout } from "../../utils/formatters";
import "./RaceHistoryTable.css";

/**
 * レース一覧テーブル（日付/会場/R/レース名/グレード/レース種別/枠番/ST/着順/
 * 決まり手/単勝配当）。選手個人ページの「レース一覧」（BOA-159、
 * RacerPerformanceStats.jsx）とレース詳細ページ基本情報タブの「直近5走」
 * （BOA-333、RaceBasicInfoTab.jsx）で同じ見た目を使うために共通化した
 * （2026-09-16、ユーザーフィードバックで両者の表示形式を揃えることに）。
 *
 * ページングは持たない（呼び出し側の責務）。RacerPerformanceStats.jsxは
 * 現在ページ分のrowsだけを渡し、ページャーは呼び出し側で別途描画する。
 * RaceBasicInfoTab.jsxは直近5走（固定件数）をそのまま渡す。
 *
 * 各行はgetRacerRaceHistory()由来のmatchedRaces（aggregateRacerVenueBoatStats）
 * と同じフィールド名に統一している。raceTitle/raceStage/winningTechnique/
 * payoutWinはgetRacerScopedRaceStats（RaceBasicInfoTab.jsx側のデータソース）
 * では取得していないため、その場合はnullのまま渡され「-」表示になる
 * （直近5走のためだけに追加クエリを増やすことは避けた、意図的な範囲限定）
 *
 * @param {Array} rows - {raceId, date, venueCode, raceNo, raceTitle, raceGrade,
 *   raceStage, boatNumber, startTiming, finishRank, winningTechnique, payoutWin}[]
 * @param {(raceId: string) => string} [buildRaceHref] - 日付セルのリンク先を
 *   決めるオプション関数。デフォルトは`/race/{raceId}`そのまま
 *   （RacerPerformanceStats.jsxが動くページ`/racer/:id`はja専用パスのため
 *   これで挙動が変わらない）。RaceBasicInfoTab.jsxは`/race`が翻訳対象パスの
 *   ため、`useLocalizedPath`で言語プレフィックスを保つ関数を渡す
 *
 * 2026-09-16レビュー指摘: `/race`はsrc/config/languages.jsのTRANSLATED_PATHSに
 * 登録済みの翻訳対象パスのため、列見出し・グレードラベルをt()経由に修正
 * （4言語分のi18nキーをraceHistoryTable名前空間に追加）。GRADE_LABELS
 * （raceGradeLabels.js）はRacerPerformanceStats.jsxのフィルタUI等、ja専用の
 * `/racer`ページでの直接参照向けに残しつつ、このテーブルではt()の
 * デフォルト値として使う（未知のグレードコードのフォールバック表示用）
 */
function RaceHistoryTable({
  rows,
  buildRaceHref = (raceId) => `/race/${raceId}`,
}) {
  const { t } = useTranslation();

  return (
    <div className="race-history-table-wrapper">
      <table className="race-history-table">
        <thead>
          <tr>
            <th>{t("raceHistoryTable.date")}</th>
            <th>{t("raceHistoryTable.venue")}</th>
            <th>{t("raceHistoryTable.raceNo")}</th>
            <th>{t("raceHistoryTable.raceTitle")}</th>
            <th>{t("raceHistoryTable.grade")}</th>
            <th>{t("raceHistoryTable.stage")}</th>
            <th>{t("raceHistoryTable.boatNumber")}</th>
            <th>{t("raceHistoryTable.startTiming")}</th>
            <th>{t("raceHistoryTable.finish")}</th>
            <th>{t("raceHistoryTable.technique")}</th>
            <th>{t("raceHistoryTable.payout")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((race) => (
            <tr key={race.raceId}>
              <td>
                <Link
                  className="race-history-table-link"
                  to={buildRaceHref(race.raceId)}
                >
                  {race.date}
                </Link>
              </td>
              <td>{t(`venues.${race.venueCode}`, race.venueCode)}</td>
              <td>{race.raceNo !== null ? `${race.raceNo}R` : "-"}</td>
              <td>{race.raceTitle ?? "-"}</td>
              <td>
                {race.raceGrade
                  ? t(
                      `raceHistoryTable.grades.${race.raceGrade}`,
                      GRADE_LABELS[race.raceGrade] ?? race.raceGrade,
                    )
                  : "-"}
              </td>
              <td>{race.raceStage ?? "-"}</td>
              <td>{race.boatNumber}</td>
              <td>
                {race.startTiming !== null
                  ? Number(race.startTiming).toFixed(2)
                  : "-"}
              </td>
              <td>{race.finishRank ?? t("basicInfo.finishUnknown")}</td>
              <td>
                {race.finishRank === 1 ? (race.winningTechnique ?? "-") : "-"}
              </td>
              <td>
                {race.finishRank === 1 && race.payoutWin
                  ? formatPayout(race.payoutWin)
                  : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default RaceHistoryTable;
