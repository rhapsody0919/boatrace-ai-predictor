import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { buildRaceSummaryRows } from "../../utils/raceSummaryRows";
import { supabaseDataService } from "../../services/supabaseDataService";
import { FINISH_MARKS, normalizeFinishMark } from "../../utils/raceOutcome";
import RacerLink from "./assist/RacerLink";
import BoatBadge from "./BoatBadge";
import "./RaceSummaryTable.css";

/**
 * レース詳細のタブの上に置く6艇の要約（BOA-1189 GS01-c、2026-10-31 オーナー決定）。
 * 1行1艇・艇番の順。確定後だけ着順の列を左端に出す。選手名は /racer/N へのリンク。
 * 展示タイムは秒数と6艇の中の順位（小さいほど速い）。色付けはしない
 *
 * @param {boolean} props.showExhibitionPending 展示前（本日の締切前で展示タイムが無い）なら true。
 *   展示タイムの列は「—」にし、表の下に「展示タイムは締切の約15分前に出る」を出す
 * @param {string} props.raceId 返還艇の記号（F・L・欠）を引くレース
 */
export default function RaceSummaryTable({
  raceId,
  players,
  exhibitionData,
  result,
  showExhibitionPending,
}) {
  const { t } = useTranslation();
  const { rows, hasExhibition, hasResult } = buildRaceSummaryRows(
    players,
    exhibitionData,
    result,
  );
  const hasRefunded = rows.some((r) => r.refunded);
  // 返還艇の記号（F・L・欠）。一覧の取得（/api/predictions の result）には着欄の記号が無いので、
  // 返還艇がいるレースだけ結果タブと同じ race_start_timings を引く。「返還」だけだと F・L・欠場の
  // 区別が消え、結果タブ・節ページの「F」と食い違った（ファン評価1・2周目、同じ指摘の2回目）。
  // 失敗したら「返還」のまま（事実として正しい）にし、結果タブ側が InlineFetchError で失敗を出す
  const [marks, setMarks] = useState(null);
  useEffect(() => {
    if (!hasRefunded || !raceId) return undefined;
    let cancelled = false;
    supabaseDataService
      .getRaceStartTimings(raceId)
      .then((timings) => {
        if (cancelled) return;
        setMarks({
          raceId,
          byBoat: new Map(
            timings.map((st) => [
              st.boatNumber,
              normalizeFinishMark(st.finishMark),
            ]),
          ),
        });
      })
      .catch((err) => {
        if (!cancelled)
          console.error("返還艇の記号（race_start_timings）の取得に失敗:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [hasRefunded, raceId]);

  if (rows.length === 0) return null;
  const pending = !hasExhibition && showExhibitionPending;
  const refundLabel = (boat) => {
    const mark = marks?.raceId === raceId ? marks.byBoat.get(boat) : null;
    const info = mark ? FINISH_MARKS[mark] : null;
    return info?.refund
      ? {
          text: t("raceSummary.finishMarkRefunded", { mark }),
          title: t(`result.mark.${info.key}`),
        }
      : { text: t("raceSummary.finishRefunded"), title: undefined };
  };

  return (
    <section
      className="race-summary-table"
      data-testid="race-summary-table"
      aria-label={t("raceSummary.title")}
    >
      <table className="race-summary-table__table">
        <thead>
          <tr>
            {hasResult && (
              <th scope="col" className="race-summary-table__finish">
                {t("raceSummary.colFinish")}
              </th>
            )}
            <th scope="col" className="race-summary-table__boat">
              {t("raceSummary.colBoat")}
            </th>
            <th scope="col" className="race-summary-table__racer">
              {t("raceSummary.colRacer")}
            </th>
            <th scope="col" className="race-summary-table__grade">
              {t("raceSummary.colGrade")}
            </th>
            <th scope="col" className="race-summary-table__exh">
              {t("raceSummary.colExh")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.number}>
              {hasResult && (
                <td
                  className="race-summary-table__finish"
                  title={
                    row.finish == null && row.refunded
                      ? refundLabel(row.number).title
                      : undefined
                  }
                >
                  {row.finish != null
                    ? // 結果タブと同じ言い方（ja「1着」、en「1st」）。英語で素の数字にすると隣の艇番と紛れた
                      // （ファン評価1周目・3周目、wording-editor で同じ指摘）
                      t(`result.rank${row.finish}`)
                    : row.refunded
                      ? refundLabel(row.number).text
                      : t("raceSummary.noValue")}
                </td>
              )}
              <td className="race-summary-table__boat">
                <BoatBadge n={row.number} size="sm" />
              </td>
              <td className="race-summary-table__racer">
                <RacerLink
                  racerId={row.racerId}
                  className="race-summary-table__racer-link"
                >
                  {row.name}
                </RacerLink>
              </td>
              <td className="race-summary-table__grade" translate="no">
                {row.grade ?? t("raceSummary.noValue")}
              </td>
              <td className="race-summary-table__exh">
                {row.exhTime != null ? (
                  <>
                    <span className="race-summary-table__exh-time">
                      {row.exhTime.toFixed(2)}
                    </span>{" "}
                    <small className="race-summary-table__exh-rank">
                      {t(
                        row.exhTied
                          ? "raceSummary.exhRankTied"
                          : "raceSummary.exhRank",
                        { rank: row.exhRank },
                      )}
                    </small>
                  </>
                ) : (
                  t("raceSummary.noValue")
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hasExhibition && (
        <p className="race-summary-table__note">{t("raceSummary.exhNote")}</p>
      )}
      {/* 展示の前は、案内を表の下の1行に出す。列の中に置くと、375px で選手の列が細くなり名前が途中で
          折れた（ファン評価1周目 指摘3） */}
      {pending && (
        <p className="race-summary-table__note">
          {t("raceSummary.exhPending")}
        </p>
      )}
    </section>
  );
}
