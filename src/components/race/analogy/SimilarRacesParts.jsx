import { useTranslation } from "react-i18next";
import NoteList from "./NoteList";
import BoatBadge from "../BoatBadge";
import FinishSankey from "./FinishSankey";
import AnalogySplit from "./AnalogySplit";
import TrifectaList from "./TrifectaList";
import { describeAnalogyLayer, layerKind } from "../../../utils/analogyLayer";
import { fmtCount } from "../../../utils/analogyFormat";
import { wilsonInterval } from "../../../utils/wilson";

const k = "aiPredictionTab.analogy.similar";

/** ソナーの図の見方を絵の凡例で（承認モック sonar-tab v3。以前は3行の箇条書き） */
function SonarLegend() {
  const { t } = useTranslation();
  const icon = (d) => (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      {d}
    </svg>
  );
  return (
    <div
      className="af-legend af-sonar-legend"
      data-testid="analogy-sonar-legend"
    >
      <span>
        {icon(
          <>
            <circle cx="9" cy="9" r="7" fill="none" stroke="#c9a227" />
            <circle cx="9" cy="9" r="2.5" fill="#c9a227" />
          </>,
        )}
        {t(`${k}.legendCenter`)}
      </span>
      <span>
        {icon(
          <path
            d="M9,9 L9,1 A8,8 0 0 1 16,5 Z"
            fill="#c9a227"
            fillOpacity=".5"
          />,
        )}
        {t(`${k}.legendSector`)}
      </span>
      <span>
        {icon(
          <>
            <circle
              cx="9"
              cy="9"
              r="7.5"
              fill="none"
              stroke="#c9a227"
              strokeDasharray="2 2"
            />
            <circle cx="9" cy="9" r="1.8" fill="#c9a227" />
          </>,
        )}
        {t(`${k}.legendTap`)}
      </span>
      <span>
        {icon(
          <>
            <rect
              x="2"
              y="2"
              width="14"
              height="9"
              rx="2"
              fill="none"
              stroke="#c9a227"
            />
            <circle cx="9" cy="15" r="2" fill="#c9a227" />
          </>,
        )}
        {t(`${k}.legendHold`)}
      </span>
    </div>
  );
}

/** その艇が勝ったとき、ほかの艇は？（承認版モックの renderOther） */
function OtherBoats({ neighbors, boat }) {
  const { t } = useTranslation();
  if (!boat) return <p className="af-card-note">{t(`${k}.otherHint`)}</p>;
  const ok = neighbors.filter((x) => x.finish?.length >= 3 && x.finish[0] >= 1);
  const hit = ok.filter((x) => x.finish[0] === boat);
  const base =
    boat === 1
      ? ok.filter((x) => x.finish[0] !== 1)
      : ok.filter((x) => x.finish[0] !== 1 && x.finish[0] !== boat);
  const course = (x, b) => x.course_by_boat?.[b - 1] ?? null;
  const st = (x, b) => {
    const c = course(x, b);
    return c ? (x.st_by_course?.[c - 1] ?? null) : null;
  };
  const stRank = (x, b) => {
    const v = st(x, b);
    if (v === null) return null;
    return (
      1 +
      [1, 2, 3, 4, 5, 6].filter((o) => st(x, o) !== null && st(x, o) < v).length
    );
  };
  const F = {
    b1d: (x) => !x.finish.slice(0, 3).includes(1),
    b1s: (x) => (stRank(x, 1) ?? 0) >= 4,
    st1: (x) => stRank(x, boat) === 1,
    md: (x) => (course(x, boat) ?? boat) < boat,
  };
  const keys = boat === 1 ? ["st1"] : ["b1d", "b1s", "st1", "md"];
  const pair = (rows, f, cls) => {
    const x = rows.filter(f).length;
    const n = rows.length;
    const ci = n ? wilsonInterval(x, n) : null;
    return (
      <div className="af-pr">
        <span className="af-trk" style={{ height: 9 }}>
          <span
            className={`af-trk-f ${cls}`}
            style={{ width: `${n ? (x / n) * 100 : 0}%` }}
          />
          {ci && (
            <span
              className="af-trk-w"
              style={{
                left: `${ci[0] * 100}%`,
                width: `${(ci[1] - ci[0]) * 100}%`,
              }}
            />
          )}
        </span>
        <span className="af-num">{`${x}/${n}`}</span>
      </div>
    );
  };
  return (
    <div className="af-other">
      <h4 className="af-h4">
        <BoatBadge n={boat} size="sm" />{" "}
        {t(`${k}.otherTitle`, { b: boat, n: hit.length })}
      </h4>
      <div className="af-key">
        <span>
          <i className="is-hit" />
          {t(`${k}.otherHit`, { b: boat })}
        </span>
        <span>
          <i className="is-base" />
          {t(`${k}.otherBase`, {
            name:
              boat === 1
                ? t(`${k}.otherBase1`)
                : t(`${k}.otherBaseK`, { b: boat }),
            n: base.length,
          })}
        </span>
      </div>
      {!hit.length ? (
        <p className="af-warn">
          {t(`${k}.otherNone`, { n: neighbors.length, b: boat })}
        </p>
      ) : (
        keys.map((q) => (
          <div key={q} className="af-ind">
            <span>{t(`${k}.other.${q}`, { b: boat })}</span>
            <div className="af-pair-bars">
              {pair(hit, F[q], "is-hit")}
              {pair(base, F[q], "is-base")}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/** 見出しの下の並べ方の1行と、全文の折りたたみ */
function SimilarLede({ sim, count }) {
  const { t } = useTranslation();
  return (
    <>
      {/* 並べ方は1行に縮め、全文は折りたたみに（承認モック sonar-tab v3） */}
      <p className="af-sub">
        {layerKind(sim.conditions, t)
          ? t(`${k}.ledeShortKind`, {
              kind: layerKind(sim.conditions, t),
              n: fmtCount(count),
            })
          : t(`${k}.ledeShort`, { n: fmtCount(count) })}
      </p>
      <details className="af-details">
        <summary>{t(`${k}.ledeFull`)}</summary>
        <NoteList
          className="is-lede"
          texts={[
            `${describeAnalogyLayer(sim.conditions, t, { count: sim.n_layer })}${t(`${k}.ledeTail`)}`,
          ]}
        />
      </details>
    </>
  );
}

/** 件数のスライダー（ソナーの図の上） */
function SimilarSlider({ N, steps, idx, farC, onStep }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="af-slider">
        <div className="af-ctl-row af-between">
          <label className="af-lbl" htmlFor="af-sim-slider">
            {t(`${k}.sliderLabel`)}
          </label>
          <span className="af-sv">
            <b>{t("aiPredictionTab.analogy.count", { n: fmtCount(N) })}</b>
          </span>
        </div>
        <p className="af-foot">{t(`${k}.outerIs`, { n: fmtCount(N) })}</p>
        <input
          id="af-sim-slider"
          data-af-control="similar_range"
          type="range"
          min={0}
          max={steps.length - 1}
          step={1}
          value={idx}
          aria-valuetext={t("aiPredictionTab.analogy.count", {
            n: fmtCount(N),
          })}
          onChange={(e) => onStep(Number(e.target.value))}
        />
        <div className="af-ctl-row af-between">
          <span className="af-foot">{t(`${k}.fewer`)}</span>
          <span className="af-foot">{t(`${k}.more`)}</span>
        </div>
        <p className="af-foot">{t(`${k}.sliderZoom`)}</p>
        {farC && (
          <p className="af-foot">
            {t(`${k}.farthest`, {
              n: N,
              total: farC.total,
              same: farC.same,
              near: farC.near,
            })}
          </p>
        )}
      </div>
    </>
  );
}

/** 着順の流れ（左）とよく出た3連単（右）。PC では横並び（BOA-813） */
function SimilarFlow({ ag, ctl }) {
  const { t } = useTranslation();
  return (
    <AnalogySplit
      fig={
        <>
          <h4 className="af-h4">{t("aiPredictionTab.analogy.flow.heading")}</h4>
          <FinishSankey
            tri={ag.tri}
            first={ctl.boat}
            onFirst={ctl.setBoat}
            not1={ctl.not1}
            onNot1={ctl.setNot1}
            band={ctl.band}
            onBand={ctl.setBand}
          />
        </>
      }
    >
      <h4 className="af-h4">{t(`${k}.triHeading`)}</h4>
      <TrifectaList
        tri={ag.tri}
        first={ctl.boat}
        not1={ctl.not1}
        band={ctl.band}
      />
    </AnalogySplit>
  );
}

export { SonarLegend, OtherBoats, SimilarLede, SimilarSlider, SimilarFlow };
