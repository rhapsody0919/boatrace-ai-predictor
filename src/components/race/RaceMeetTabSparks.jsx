/**
 * RaceMeetTab 詳細の、今節の走順に並べた小さな線（ST・展示）。数字の羅列だと8走ぶんの上下を
 * 頭の中で組み立てることになる（2026-09-27、ファン視点の議論）。
 * 判定文は出さず、形と基準線を見せて読み手に委ねる。
 */
import { meetStVerdictTone, MEET_ST_DIFF_THRESHOLD } from "./basicInfoStats";
import MeetSparkline from "./MeetSparkline";

// 通常より早い＝緑、遅い＝赤（R2）。差の数字に −/+ が付く。
// 小さな差・走数の少ないときは色を付けない（meetStVerdictTone）
function StVerdict({ m }) {
  const { t, st } = m;
  return (
    <span
      className={`rmt-verdict${
        {
          good: " ind-good",
          bad: " ind-bad",
        }[meetStVerdictTone(st.diff, st.meetN)] ?? ""
      }`}
    >
      {st.diff <= -MEET_ST_DIFF_THRESHOLD
        ? t("basicInfo.meetTrendStPush", {
            diff: Math.abs(st.diff).toFixed(2),
          })
        : st.diff >= MEET_ST_DIFF_THRESHOLD
          ? t("basicInfo.meetTrendStCareful", {
              diff: st.diff.toFixed(2),
            })
          : t("basicInfo.meetTrendStFlat")}
    </span>
  );
}

function StHead({ m }) {
  const { t, st } = m;
  return (
    <div className="rmt-spark-head">
      <span className="rmt-spark-title">{t("meetTab.sparkStTitle")}</span>
      {st.diff !== null && (
        <span className="rmt-spark-base">
          {t("meetTab.sparkStMeta", {
            avg: st.meetAvg.toFixed(2),
            n: st.meetN,
            base: st.baseAvg === null ? "—" : st.baseAvg.toFixed(2),
          })}{" "}
          <StVerdict m={m} />
        </span>
      )}
    </div>
  );
}

function SparkFoot({ m, last }) {
  const { t, firstMeetDate } = m;
  return (
    <div className="rmt-spark-foot">
      <span>{firstMeetDate}</span>
      <span>
        {last === null
          ? "—"
          : t("meetTab.sparkLast", { value: last.mark ?? last.value.toFixed(2) })}
      </span>
    </div>
  );
}

function StSpark({ m }) {
  const { meetRows, sparkLabel, stRankByRace, st, lastSt } = m;
  return (
    <div className="rmt-spark">
      <StHead m={m} />
      <MeetSparkline
        points={meetRows.map((r) => ({
          value: r.startTiming ?? null,
          label: sparkLabel(
            r,
            "meetTab.compareTrendSt",
            r.startTiming,
            stRankByRace[r.raceId] ?? null,
          ),
        }))}
        baseline={st.baseAvg}
        // 金は「6艇で最良」の印。ダークでは5号艇の線と同じ色にも見えた（BOA-757）
        color="var(--text-primary)"
        markLast={!lastSt?.mark}
      />
      <SparkFoot m={m} last={lastSt} />
    </div>
  );
}

function ExHead({ m }) {
  const { t, pre } = m;
  return (
    <div className="rmt-spark-head">
      <span className="rmt-spark-title">{t("meetTab.sparkExTitle")}</span>
      {pre?.pretest_time !== null && pre?.pretest_time !== undefined && (
        <span className="rmt-spark-base">
          {pre.pretest_rank
            ? t("meetTab.sparkExMetaRank", {
                value: Number(pre.pretest_time).toFixed(2),
                rank: pre.pretest_rank,
              })
            : t("meetTab.sparkBaselinePretest", {
                value: Number(pre.pretest_time).toFixed(2),
              })}
        </span>
      )}
    </div>
  );
}

function ExSpark({ m }) {
  const { meetRows, sparkLabel, venueDailyExhibitionAvg, lastExhibition } = m;
  return (
    <div className="rmt-spark">
      <ExHead m={m} />
      <MeetSparkline
        points={meetRows.map((r) => ({
          value: r.exhibitionTime ?? null,
          label: sparkLabel(
            r,
            "meetTab.compareTrendEx",
            r.exhibitionTime,
            r.exhibitionRank ?? null,
          ),
        }))}
        // 基準は「その日の会場全体の展示平均」。水面は日ごとに
        // 0.08秒動くため（若松2026-09-22〜27の実測で6.829〜6.907）、
        // 生タイムだけでは重い日の6.90と軽い日の6.90を同じに読む
        referenceSeries={meetRows.map(
          (r) => venueDailyExhibitionAvg[r.date] ?? null,
        )}
        color="var(--color-info-text)"
      />
      <SparkFoot
        m={m}
        last={lastExhibition === null ? null : { value: lastExhibition }}
      />
    </div>
  );
}

export default function RaceMeetTabSparks({ m }) {
  const { t } = m;
  return (
    <div className="rmt-sparks">
      <StSpark m={m} />
      <ExSpark m={m} />
      <p className="rmt-spark-note">{t("meetTab.sparkNote")}</p>
    </div>
  );
}
