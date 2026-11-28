/**
 * 会場×グレードの1着率を、グレードごとの1着の取り分の100%積み上げ棒で出す（部品化 G4 T-09、2026-11-28 オーナーが
 * before/after で承認）。グレードを上下に並べるので、1号艇の取り分がグレードでどう変わるかが一目で分かる。
 * 左にグレードとレース数、棒の中は太い区切りだけ数字、棒の下に6艇の1着率（列の位置は全グレードで同じ）。
 * 表だった頃はレース数・期間が無く、50レース未満を「-」で隠していた（plan.md §14: 母数と期間を出し、少なくても隠さない）。
 * 艇の色は艇の識別で、良し悪しではない。データは props で受け取る（§13）。
 */
import { useTranslation } from "react-i18next";
import BoatBadge from "../race/BoatBadge";
import { BOAT_COLORS } from "../../utils/colors";
import "./VenueGradeWinShare.css";

// 集計の始まりの日。scripts/daily/calculate-venue-grade-stats.js の CLEAN_DATA_SINCE と同じ
// （race_grade の欠損期間の後。一致は scripts/maintenance の verify が見る）
export const VENUE_GRADE_STATS_SINCE = "2026-02-04";
const BOATS = [1, 2, 3, 4, 5, 6];
// 棒の中に数字を書く区切りの下限（%）。細い区切りは棒の下の数字で読む。8〜16% はスマホでは隠す（CSS）
const LABEL_MIN_PCT = 8;
const LABEL_WIDE_PCT = 16;

const sinceLabel = () => {
  const [y, m, d] = VENUE_GRADE_STATS_SINCE.split("-").map(Number);
  return `${y}/${m}/${d}`;
};

function GradeRow({ label, raceCount, shares, t }) {
  return (
    <div className="vgs-row">
      <span className="vgs-grade">
        <span className="vgs-grade-name">{label}</span>
        <span className="vgs-grade-count">
          {t("analysis.venueGrade.raceCount", {
            n: raceCount.toLocaleString(),
          })}
        </span>
      </span>
      <span className="vgs-bar">
        {shares.map(({ boat, pct }) => (
          <span
            key={boat}
            className="vgs-seg"
            style={{
              flexBasis: `${pct}%`,
              background: BOAT_COLORS[boat].bg,
              color: BOAT_COLORS[boat].text,
            }}
          >
            {pct >= LABEL_MIN_PCT && (
              <span
                className={`vgs-seg-label${pct < LABEL_WIDE_PCT ? " vgs-seg-label--narrow" : ""}`}
              >
                {pct.toFixed(1)}%
              </span>
            )}
          </span>
        ))}
      </span>
      <span />
      <span className="vgs-nums">
        {shares.map(({ boat, pct }) => (
          <span key={boat}>{pct.toFixed(1)}</span>
        ))}
      </span>
    </div>
  );
}

export default function VenueGradeWinShare({
  grades,
  byGradeAndBoat,
  gradeLabel,
}) {
  const { t } = useTranslation();
  const rows = grades
    .map((grade) => {
      const raceCount = byGradeAndBoat.get(`${grade}-1`)?.race_count ?? 0;
      const shares = BOATS.map((boat) => {
        const r = byGradeAndBoat.get(`${grade}-${boat}`);
        return {
          boat,
          pct: r && r.race_count > 0 ? (r.wins / r.race_count) * 100 : 0,
        };
      });
      return { grade, raceCount, shares };
    })
    .filter((r) => r.raceCount > 0);
  return (
    <div className="vgs">
      <p className="vgs-title">{t("analysis.venueGrade.winShareTitle")}</p>
      <div className="vgs-row vgs-legend" aria-hidden="true">
        <span className="vgs-legend-label">{t("analysis.laneHeader")} →</span>
        <span className="vgs-nums">
          {BOATS.map((b) => (
            <span key={b}>
              <BoatBadge n={b} size="sm" />
            </span>
          ))}
        </span>
      </div>
      {rows.map((r) => (
        <GradeRow
          key={r.grade}
          label={gradeLabel(r.grade)}
          raceCount={r.raceCount}
          shares={r.shares}
          t={t}
        />
      ))}
      <p className="vgs-note">
        {t("analysis.venueGrade.winShareNote", { since: sinceLabel() })}
      </p>
    </div>
  );
}
