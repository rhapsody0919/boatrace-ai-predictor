/**
 * EntryCourseDistributionCard - 直前情報タブ「この枠からの進入コース」（BOA-485）
 *
 * 旧「平均進入順」の行（全枠を混ぜた平均。1号艇でも3.16になる）を置き換える。
 * 艇ごとに「今回と同じ枠番で出たとき、本番で何コースに入ったか」を1本の横棒で
 * 出し、右に枠なり%・前づけ%・走数を添える。6艇×セルに棒を詰めると375pxで
 * 読めないため、表の行ではなく表の下のカードにする（ユーザー承認の案A、2026-09-28）。
 *
 * データは直前情報タブが既に取得している getRacerScopedRaceStats の生データを
 * 集計し直すだけで、追加のクエリは無い（BOA-357）。
 */
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import InlineFetchError from "../InlineFetchError";
import EntryCourseDistributionRow from "./EntryCourseDistributionRow";
import TermHintButton from "./TermHintButton";
import "./EntryCourseDistributionCard.css";

function EntryCourseDistributionCard({
  raceId,
  players,
  statsByRacer,
  failed,
  onRetry,
}) {
  const { t } = useTranslation();

  return (
    <section className="rbi-card ecd-card" data-testid="entry-course-dist">
      <h3 className="rbi-heading">
        {t("beforeInfo.entryDistTitle")}
        <TermHintButton termKey="entryCourseDistribution" />
      </h3>
      <p className="ecd-note">{t("beforeInfo.entryDistNote")}</p>
      {failed && <InlineFetchError onRetry={onRetry} />}
      <ul className="ecd-list">
        {players.map((p) => (
          <EntryCourseDistributionRow
            key={p.number}
            raceId={raceId}
            player={p}
            statsByRacer={statsByRacer}
          />
        ))}
      </ul>
      <div className="ecd-legend" aria-hidden="true">
        {[1, 2, 3, 4, 5, 6].map((course) => (
          <span key={course} className="ecd-legend-item">
            <span
              className="ecd-legend-swatch"
              style={{ background: BOAT_COLORS[course]?.bg }}
            />
            {t("dataTable.prevResultCourse", { course })}
          </span>
        ))}
      </div>
    </section>
  );
}

export default EntryCourseDistributionCard;
