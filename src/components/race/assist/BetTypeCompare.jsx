import { compositeText } from "../../../utils/assistModel";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

/**
 * 「券種で比べる（同じ候補）」の小表（BOA-990、承認モック 画面1）。同じ候補での組・点数・合成オッズを券種ごとに1行。
 * 券種の名前を押すとその券種に切り替わる。今の券種の行を強調する
 * @param {{rows: Array<{id: string, form: string, points: number, composite: number|null}>, betType: string, onBetType: (id: string) => void}} props
 */
export default function BetTypeCompare({ rows, betType, onBetType }) {
  return (
    <section className="ta-box" aria-label={ASSIST_COPY.compareHeading}>
      <h3 className="ta-h3-row">{ASSIST_COPY.compareHeading}</h3>
      <table className="ta-table ta-bettype-cmp">
        <thead>
          <tr>
            <th scope="col">{ASSIST_COPY.colBetType}</th>
            <th scope="col">{ASSIST_COPY.colTicket}</th>
            <th scope="col">{ASSIST_COPY.colBetPoints}</th>
            <th scope="col">{ASSIST_COPY.colComposite}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const current = r.id === betType;
            return (
              <tr key={r.id} className={current ? "is-current" : undefined}>
                <td>
                  <button
                    type="button"
                    aria-pressed={current}
                    onClick={() => onBetType(r.id)}
                  >
                    {ASSIST_COPY.betTypeLabels[r.id]}
                  </button>
                </td>
                <td className="ta-num">{r.form}</td>
                <td className="ta-num">{ASSIST_COPY.pointsCell(r.points)}</td>
                <td className="ta-num">{compositeText(r.composite) ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="ta-note">{ASSIST_COPY.compareNote}</p>
    </section>
  );
}
