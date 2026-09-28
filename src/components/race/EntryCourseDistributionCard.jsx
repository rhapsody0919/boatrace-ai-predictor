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
import {
  computeFrameEntryDistribution,
  SMALL_SAMPLE_THRESHOLD,
} from "./basicInfoStats";
import InlineFetchError from "../InlineFetchError";
import TermHintButton from "./TermHintButton";
import "./EntryCourseDistributionCard.css";

// 前づけ%を目立たせる下限。これ未満は「たまに動く」程度として通常表示にする
const MOVED_IN_EMPHASIS_RATE = 10;
// 棒の中にコース番号を書く最小幅（%）。狭い区間に数字を詰めると潰れる
const SEGMENT_LABEL_MIN_RATE = 12;

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
        {players.map((p) => {
          const color = BOAT_COLORS[p.number] || {};
          const records = p.racerId ? statsByRacer[p.racerId] : null;
          const loading = p.racerId && records === undefined && !failed;
          const dist = records
            ? computeFrameEntryDistribution(records, p.number, raceId)
            : null;
          const smallSample =
            dist !== null && dist.n > 0 && dist.n < SMALL_SAMPLE_THRESHOLD;
          const movedInEmphasis =
            dist?.inwardRate !== null &&
            dist?.inwardRate !== undefined &&
            dist.inwardRate >= MOVED_IN_EMPHASIS_RATE;
          return (
            <li
              key={p.number}
              className={`ecd-row${smallSample ? " ecd-small-sample" : ""}`}
              data-testid={`entry-course-dist-${p.number}`}
            >
              <span
                className="ecd-badge"
                style={{ background: color.bg, color: color.text }}
              >
                {p.number}
              </span>
              {loading ? (
                <span className="drt-skeleton ecd-bar" aria-hidden="true" />
              ) : dist && dist.n > 0 ? (
                <span
                  className="ecd-bar"
                  role="img"
                  aria-label={dist.counts
                    .map((count, i) =>
                      count > 0
                        ? t("beforeInfo.entryDistSegmentAria", {
                            course: i + 1,
                            count,
                          })
                        : null,
                    )
                    .filter(Boolean)
                    .join(", ")}
                >
                  {dist.counts.map((count, i) => {
                    if (count === 0) return null;
                    const course = i + 1;
                    const rate = (count / dist.n) * 100;
                    const segColor = BOAT_COLORS[course] || {};
                    return (
                      <span
                        key={course}
                        className="ecd-seg"
                        style={{
                          width: `${rate}%`,
                          background: segColor.bg,
                          color: segColor.text,
                        }}
                      >
                        {rate >= SEGMENT_LABEL_MIN_RATE ? course : ""}
                      </span>
                    );
                  })}
                </span>
              ) : (
                <span className="ecd-bar ecd-bar-empty">
                  {/* 取得失敗・選手ID不明は「—」。取得できて0走のときだけ
                      「出走なし」と言う（失敗を「データなし」に化けさせない） */}
                  {dist ? t("beforeInfo.entryDistNoRuns") : "—"}
                </span>
              )}
              <span className="ecd-summary">
                {dist && dist.n > 0 && (
                  <>
                    <span>
                      {t("beforeInfo.entryDistWaku", {
                        rate: dist.wakuRate.toFixed(0),
                      })}
                    </span>
                    {dist.inwardRate > 0 && (
                      <span
                        className={
                          movedInEmphasis ? "ecd-moved-in" : "ecd-moved-in-low"
                        }
                      >
                        {t("beforeInfo.entryDistMovedIn", {
                          rate: dist.inwardRate.toFixed(0),
                        })}
                      </span>
                    )}
                    <span
                      className={`ecd-runs${smallSample ? " drt-n-small-sample" : ""}`}
                    >
                      {t("beforeInfo.entryDistRuns", {
                        frame: p.number,
                        n: dist.n,
                      })}
                    </span>
                  </>
                )}
              </span>
            </li>
          );
        })}
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
