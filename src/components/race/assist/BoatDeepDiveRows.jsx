import { METRICS, stText } from "../../../utils/assistModel";
import { ASSIST_COPY as C } from "../../../data/thinkingAssistCopy";
import { TheoryButton } from "./SheetButtons";
import { Dt, Val } from "./BoatDeepDiveParts";

/** コース別の勝ちの行 */
export function CourseRow({ course, cw, runs }) {
  return (
    <>
      <dt>{C.kvCourse(course)}</dt>
      <dd>
        {cw ? (
          <span className="ta-num">{C.courseWin(cw.k, cw.n)}</span>
        ) : runs.status === "error" || runs.status === "none" ? (
          C.noRunsData
        ) : (
          C.loading
        )}{" "}
        <span className="ta-scopechip">{C.courseNote}</span>
      </dd>
    </>
  );
}

/** 平均STの行。名前に期間を付ける（BOA-815 方針1）。「?」の用語は「平均ST」のまま */
export function StRow({ racer, today, cst, i, venue, onMetric }) {
  return (
    <>
      <Dt term={C.kvSt}>{C.kvStLabel}</Dt>
      <dd>
        {today ? (
          <Val metric="st_mean30" racer={racer} onMetric={onMetric} />
        ) : (
          // v16 の保存が無いレースは、記録が無いのではなくデータが無い（ファン評価 PR4 1周目 指摘5）
          C.noRunsData
        )}{" "}
        {racer.stCourse != null && (
          // 図・6艇比較と同じ補った値（course_filled）と走数（BOA-815 方針4）
          <span className="ta-scopechip ta-num">
            {C.stCourseChip(
              stText(racer.stCourse),
              racer.stCourseN,
              racer.stCourseFilled,
            )}
          </span>
        )}{" "}
        {cst?.venue?.[i] != null && venue && (
          <span className="ta-scopechip ta-num">
            {C.stVenueChip(venue, stText(cst.venue[i]))}
          </span>
        )}
      </dd>
    </>
  );
}

/** 展示前テストの行 */
export function PretestRow({ pretest }) {
  if (pretest?.pretest_time == null) return null;
  return (
    <>
      <Dt term={C.kvPretest} />
      <dd className="ta-num">
        {C.pretest(
          Number(pretest.pretest_time).toFixed(2),
          pretest.pretest_rank,
        )}
      </dd>
    </>
  );
}

/** 決まり手の行 */
export function TechniqueRow({ technique }) {
  if (!technique) return null;
  const techTotal = technique.win_count ?? 0;
  return (
    <>
      <Dt term={C.kvTech} />
      <dd className="ta-num">
        {techTotal > 0
          ? C.techLine(techTotal) +
            technique.techniques
              .map((t) => C.techItem(t.technique, t.count))
              .join("・")
          : C.techNone}{" "}
        <span className="ta-scopechip">{C.techPeriod}</span>
      </dd>
    </>
  );
}

/** 展示の行（展示タイム・展示ST・チルト）。展示後だけ */
export function ExhRow({ post, racer, onMetric }) {
  if (!post) return null;
  return (
    <>
      <dt>{C.colExh}</dt>
      <dd>
        <Val metric="exh_time" racer={racer} onMetric={onMetric} />{" "}
        {racer.exhSt != null && (
          <span className="ta-scopechip ta-num">
            {C.exhStChip(METRICS.exh_st.text(racer.exhSt, racer))}
          </span>
        )}{" "}
        {racer.tilt != null && (
          <span className="ta-scopechip ta-num">{C.tiltChip(racer.tilt)}</span>
        )}
      </dd>
    </>
  );
}

/** Fの行 */
export function FlyingRow({ racer, boat }) {
  if (!(racer.fCount > 0)) return null;
  return (
    <>
      <Dt term="F" />
      <dd>
        <TheoryButton
          id="TC-T4"
          name={C.markName(`F${racer.fCount}`, boat)}
          boat={boat}
          className="ta-tag ta-tag-warn"
        >
          F{racer.fCount} ›
        </TheoryButton>
      </dd>
    </>
  );
}
