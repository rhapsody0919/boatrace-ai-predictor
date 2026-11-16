import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import {
  computeFrameEntryDistribution,
  SMALL_SAMPLE_THRESHOLD,
} from "./basicInfoStats";

// 前づけ%を目立たせる下限。これ未満は「たまに動く」程度として通常表示にする
const MOVED_IN_EMPHASIS_RATE = 10;
// 棒の中にコース番号を書く最小幅（%）。狭い区間に数字を詰めると潰れる
const SEGMENT_LABEL_MIN_RATE = 12;

function EntryCourseDistributionBar({ loading, dist }) {
  const { t } = useTranslation();
  if (loading) {
    return <span className="drt-skeleton ecd-bar" aria-hidden="true" />;
  }
  if (dist && dist.n > 0) {
    return (
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
    );
  }
  return (
    <span className="ecd-bar ecd-bar-empty">
      {/* 取得失敗・選手ID不明は「—」。取得できて0走のときだけ
          「出走なし」と言う（失敗を「データなし」に化けさせない） */}
      {dist ? t("beforeInfo.entryDistNoRuns") : "—"}
    </span>
  );
}

function EntryCourseDistributionSummary({ dist, number, smallSample }) {
  const { t } = useTranslation();
  if (!(dist && dist.n > 0)) return <span className="ecd-summary" />;
  const movedInEmphasis =
    dist?.inwardRate !== null &&
    dist?.inwardRate !== undefined &&
    dist.inwardRate >= MOVED_IN_EMPHASIS_RATE;
  return (
    <span className="ecd-summary">
      <span>
        {t("beforeInfo.entryDistWaku", {
          rate: dist.wakuRate.toFixed(0),
        })}
      </span>
      {dist.inwardRate > 0 && (
        <span
          className={movedInEmphasis ? "ecd-moved-in" : "ecd-moved-in-low"}
        >
          {t("beforeInfo.entryDistMovedIn", {
            rate: dist.inwardRate.toFixed(0),
          })}
        </span>
      )}
      <span className={`ecd-runs${smallSample ? " drt-n-small-sample" : ""}`}>
        {t("beforeInfo.entryDistRuns", {
          frame: number,
          n: dist.n,
        })}
      </span>
    </span>
  );
}

function EntryCourseDistributionRow({ raceId, player: p, statsByRacer }) {
  const color = BOAT_COLORS[p.number] || {};
  const records = p.racerId ? statsByRacer[p.racerId] : null;
  // 艇ごとの状態だけで決める（undefined＝取得中 / null＝失敗 / 配列＝取得済み）。
  // レース単位の failed を混ぜると、1艇が先に失敗しただけで取得中の他艇まで
  // 「—」になり、失敗・データなしと見分けがつかなくなる（/code-review 指摘）
  const loading = Boolean(p.racerId) && records === undefined;
  const dist = records
    ? computeFrameEntryDistribution(records, p.number, raceId)
    : null;
  const smallSample =
    dist !== null && dist.n > 0 && dist.n < SMALL_SAMPLE_THRESHOLD;
  return (
    <li
      className={`ecd-row${smallSample ? " ecd-small-sample" : ""}`}
      data-testid={`entry-course-dist-${p.number}`}
    >
      <span
        className="ecd-badge"
        style={{ background: color.bg, color: color.text }}
      >
        {p.number}
      </span>
      <EntryCourseDistributionBar loading={loading} dist={dist} />
      <EntryCourseDistributionSummary
        dist={dist}
        number={p.number}
        smallSample={smallSample}
      />
    </li>
  );
}

export default EntryCourseDistributionRow;
