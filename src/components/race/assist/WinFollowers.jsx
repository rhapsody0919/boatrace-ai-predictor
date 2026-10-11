import { useRef } from "react";
import { Link } from "react-router-dom";
import BoatBadge from "../BoatBadge";
import { ASSIST_COPY as C } from "../../../data/thinkingAssistCopy";

const pct = (k, n) => Math.round((k / n) * 100);

/** よく出た組の並び。組と件数は改行で分けない（ファン評価 1周目 指摘6） */
export function ComboList({ rows }) {
  return rows.map(([x, k], i) => (
    <span key={x.join("-")}>
      {i > 0 && "　"}
      <span className="ta-nowrap">{C.trifectaCount(x.join("-"), k)}</span>
    </span>
  ));
}

/**
 * 軸の艇を選ぶ1本の帯（BOA-845、承認モック v3）。「軸（1着）」の札＋6つ（丸と「軸」の2段）。選んだ艇は塗り。
 * 図の艇の丸（押すと深掘り）と見た目を分ける。radiogroup なので左右の矢印でも選べる
 */
function AxisPicker({ axis, onAxis }) {
  const refs = useRef([]);
  const move = (e, b) => {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    const next = ((b - 1 + step + 6) % 6) + 1;
    onAxis(next);
    refs.current[next - 1]?.focus();
  };
  return (
    <div className="ta-axis-pick-row">
      <span className="ta-axis-pick-lbl">{C.followAxisLabel}</span>
      <div
        className="ta-axis-pick"
        role="radiogroup"
        aria-label={C.followAxisGroup}
      >
        {[1, 2, 3, 4, 5, 6].map((b) => (
          <button
            key={b}
            ref={(el) => (refs.current[b - 1] = el)}
            type="button"
            role="radio"
            aria-checked={b === axis}
            aria-label={`${b}号艇を${C.followAxisBtn}`}
            tabIndex={b === axis ? 0 : -1}
            onClick={() => b !== axis && onAxis(b)}
            onKeyDown={(e) => move(e, b)}
          >
            <BoatBadge n={b} size="sm" />
            <span aria-hidden="true">{C.followAxisBtn}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 「{X}号艇を軸にしたときの2着」（BOA-845、spec D-48、承認モック v3）。範囲は全艇とも会場の全レース（scenario の VA）。
 * 6行固定（軸の艇は「軸（1着）」）。棒は軸のときの2着、縦線と「問わずq%」は軸を問わない2着（1行の数字は2個）。
 * 3着は軸の艇で変わらない（boa845-axis-place.md）ので出さない。30件未満は割合を出さず件数だけ
 * @param {{f: ReturnType<typeof import("../../../utils/assistSummary").winFollowers>|null,
 *   any: ReturnType<typeof import("../../../utils/assistSummary").secondAny>|null, axis: number, venue: string|null,
 *   onAxis: (boat: number) => void, auto: boolean, raceId: string}} props auto は1着の候補に合わせて選んだとき
 */
export default function WinFollowers({ f, any, axis, venue, onAxis, auto, raceId }) {
  const q = (b) => (any ? pct(any.second[b - 1], any.n) : null);
  const others = [1, 2, 3, 4, 5, 6].filter((b) => b !== axis);
  const topBoat =
    f && !f.few
      ? others.reduce((a, b) => (f.second[b - 1] > f.second[a - 1] ? b : a))
      : null;
  const concl =
    topBoat && any
      ? C.followConcl(axis, topBoat, pct(f.second[topBoat - 1], f.n), q(topBoat))
      : null;
  return (
    <section className="ta-box">
      <AxisPicker axis={axis} onAxis={onAxis} />
      {/* 見出しの丸は艇番の数字なので、読み上げは「{X}号艇を軸にしたときの2着」の1つにまとめる */}
      <h3 className="ta-follow-h" aria-label={C.followHeading(axis)}>
        <BoatBadge n={axis} size="sm" />
        {C.followHeading(axis).replace(/^\d+/, "")}
      </h3>
      {auto && <p className="ta-note">{C.followAuto(axis)}</p>}
      {concl && (
        <p className="ta-follow-concl ta-num">
          {concl[0]}
          <b>{concl[1]}</b>
          {concl[2]}
        </p>
      )}
      <p className="ta-note">{C.followNoThird}</p>
      {f ? (
        <>
          <span className="ta-scopechip ta-num">
            {C.followScope(C.followVenueAll(venue), axis, f.n)}
          </span>
          {f.few ? (
            <p className="ta-note">{C.flowFew}</p>
          ) : (
            <div className="ta-follow-legend" aria-hidden="true">
              <span>
                <i className="ta-follow-lf" />
                {C.followLegendAxis(axis)}
              </span>
              {any && (
                <span>
                  <i className="ta-follow-lb" />
                  {C.followLegendAny}
                </span>
              )}
            </div>
          )}
          <table className="ta-follow ta-num">
            <tbody>
              {[1, 2, 3, 4, 5, 6].map((b) => (
                <tr key={b}>
                  <th scope="row">
                    {/* 読み上げは「{n}号艇」の1回だけ（丸の数字と重ねない） */}
                    <span aria-hidden="true">
                      <BoatBadge n={b} size="sm" />
                    </span>
                    <span className="ta-sr">{`${b}号艇`}</span>
                  </th>
                  {b === axis ? (
                    <td colSpan={3} className="ta-follow-axis">
                      {C.followAxisLabel}
                    </td>
                  ) : f.few ? (
                    <td colSpan={3}>{C.followCount(f.second[b - 1])}</td>
                  ) : (
                    <>
                      <td className="ta-follow-bar">
                        <span className="ta-follow-track" aria-hidden="true">
                          <span
                            className="ta-follow-fill"
                            style={{ width: `${(f.second[b - 1] / f.n) * 100}%` }}
                          />
                          {any && (
                            <span
                              className="ta-follow-base"
                              style={{ left: `${q(b)}%` }}
                            />
                          )}
                        </span>
                      </td>
                      <td className="ta-follow-p">
                        <b>{pct(f.second[b - 1], f.n)}%</b>
                      </td>
                      <td className="ta-follow-u">
                        {any ? C.followAny(q(b)) : ""}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {f.topTrifecta.length > 0 && (
            <p className="ta-note ta-num">
              {C.flowTopTrifecta}: <ComboList rows={f.topTrifecta} />
            </p>
          )}
        </>
      ) : (
        <p className="ta-note">{C.followNone(axis)}</p>
      )}
      {/* 龍神ソナーの着順の流れ（サンキー図）へ。軸を選んだ状態で開く URL は BOA-847 */}
      <Link
        className="ta-follow-sonar"
        to={`/race/${raceId}?tab=sonar&sonar=scenario`}
      >
        <span>
          <b>{C.followSonar}</b>
          <span className="ta-follow-sonar-sub">{C.followSonarSub(axis)}</span>
        </span>
        <span aria-hidden="true">›</span>
      </Link>
    </section>
  );
}
