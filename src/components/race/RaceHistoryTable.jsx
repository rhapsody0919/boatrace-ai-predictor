import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { GRADE_LABELS } from "./raceGradeLabels";
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
            <th>日付</th>
            <th>会場</th>
            <th>R</th>
            <th>レース名</th>
            <th>グレード</th>
            <th>レース種別</th>
            <th>枠番</th>
            <th>ST</th>
            <th>着順</th>
            <th>決まり手</th>
            <th>単勝配当</th>
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
              <td>{race.raceNo}R</td>
              <td>{race.raceTitle ?? "-"}</td>
              <td>
                {race.raceGrade
                  ? (GRADE_LABELS[race.raceGrade] ?? race.raceGrade)
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
                  ? `${race.payoutWin}円`
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
