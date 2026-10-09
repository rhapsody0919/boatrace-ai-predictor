import BaseBar from "./BaseBar";
import BottomSheet from "./BottomSheet";
import BoatBadge from "../BoatBadge";
import { ASSIST_COPY as C } from "../../../data/thinkingAssistCopy";

const f1 = (v) => (v == null ? "—" : v.toFixed(1));

/** 今日（当てはまる／当てはまらない／展示の後に分かる）。色だけに頼らず文で書き分ける */
function Today({ today }) {
  if (!today) return null;
  const text =
    today.state === "hit"
      ? C.theoryTodayHit(today.text)
      : today.state === "miss"
        ? C.theoryTodayMiss(today.text)
        : C.theoryTodayPending(today.text);
  return (
    <p
      className={`ta-th-today${today.state === "hit" ? " ta-th-today-hit" : ""}`}
    >
      {text}
    </p>
  );
}

/** 過去レースの傾向（実測）。無いカードは「準備中」で数値を出さない（FR-6 受入基準） */
function Measured({ card }) {
  const m = card.meas;
  if (!m)
    return (
      <p className="ta-th-prep">
        {C.theoryPrep}
        {card.prepNote && (
          <>
            <br />
            {card.prepNote}
          </>
        )}
      </p>
    );
  return (
    <div className="ta-th-meas">
      <h3>{C.theoryPast}</h3>
      {(m.scope || m.tag) && (
        <div className="ta-legend">
          {m.scope && <span className="ta-scopechip ta-num">{m.scope}</span>}
          {m.tag && <span className="ta-tag">{m.tag}</span>}
        </div>
      )}
      {m.bars.map((b) => (
        <BaseBar key={b.label} label={b.label} k={b.k} n={b.n} />
      ))}
      {m.table && (
        <div className="ta-scroll">
          <table className="ta-table">
            <thead>
              <tr>
                {C.theoryWindCols.map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.table.map((r) => (
                <tr key={r.boat}>
                  <td>
                    <BoatBadge n={r.boat} size="sm" />
                  </td>
                  <td className="ta-num">{f1(r.p)}%</td>
                  <td className="ta-num">{f1(r.base)}%</td>
                  <td className="ta-num">
                    {r.p == null || r.base == null
                      ? "—"
                      : `${r.p - r.base >= 0 ? "+" : ""}${f1(r.p - r.base)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {m.notes.map((n) => (
        <p key={n} className="ta-note">
          {n}
        </p>
      ))}
    </div>
  );
}

function CardBody({ card }) {
  return (
    <>
      <dl className="ta-th-rows">
        <dt>{C.theoryCond}</dt>
        <dd>
          <b>{card.cond}</b>
        </dd>
        <dt>{C.theoryLikely}</dt>
        <dd>{card.likely}</dd>
      </dl>
      <Today today={card.today} />
      <Measured card={card} />
      {card.related && <p className="ta-th-related">{card.related}</p>}
    </>
  );
}

/**
 * セオリーカード（FR-6、screens S-1b）。条件 → 起きやすいこと → 今日 → 過去レースの傾向（実測 or 準備中）。
 * 同時に当てはまる逆向きのカード（also）は下に並べる
 * @param {{card: ReturnType<import("../../../utils/assistTheory").theoryCard>, onClose: () => void}} props
 */
export default function TheorySheet({ card, onClose }) {
  return (
    <BottomSheet title={card.title} onClose={onClose}>
      <CardBody card={card} />
      {card.also?.length > 0 && (
        <>
          <p className="ta-note">{C.theoryAlso}</p>
          {card.also.map((c) => (
            <section key={c.id} className="ta-th-also" aria-label={c.title}>
              <h3>{c.title}</h3>
              <CardBody card={c} />
            </section>
          ))}
        </>
      )}
      <p className="ta-note">{C.theoryFoot}</p>
    </BottomSheet>
  );
}
