import BoatBadge from "../BoatBadge";
import { ASSIST_COPY as C } from "../../../data/thinkingAssistCopy";
import { followNoteKind } from "../../../utils/assistSummary";

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
 * 「1号艇が1着のとき、2着・3着に来たのは」（BOA-831 案1b、spec D-44 (3)。承認モック v2）。
 * 2〜6号艇 × 2着・3着の割合を1つの表に並べる（中に切り替えは置かない。軸の着順の切り替えと見分けがつかなくなるため）。
 * 件数は札（1号艇が1着の件数）。件数が少ない（MIN_SCENARIO 未満）ときは割合を出さず件数だけ
 * @param {{f: ReturnType<typeof import("../../../utils/assistSummary").winFollowers>, label: string, axisK: number, axisN: number}} props
 *   axisK・axisN は軸の大きい数字（返還のあったレースを含む）。件数が同じなら「同じレース」と書く
 */
export default function WinFollowers({ f, label, axisK, axisN, target = 1 }) {
  // 上の大きい数字が1着のときだけ「上の 65/119」を指す
  const win = target === 1;
  const note = followNoteKind(f.n, axisK);
  const val = (k) => (f.few ? C.followCount(k) : `${pct(k, f.n)}%`);
  return (
    <section className="ta-box">
      <h3>{C.followHeading(1)}</h3>
      <span className="ta-scopechip ta-num">
        {C.followScope(label, 1, f.n)}
      </span>
      {f.few && <p className="ta-note">{C.flowFew}</p>}
      <table className="ta-follow ta-num">
        <thead>
          <tr>
            <th scope="col">
              <span className="ta-sr">{C.followBoatCol}</span>
            </th>
            <th scope="col">{C.followPos(2)}</th>
            <th scope="col">{C.followPos(3)}</th>
          </tr>
        </thead>
        <tbody>
          {[2, 3, 4, 5, 6].map((b) => (
            <tr key={b}>
              <th scope="row">
                {/* 読み上げは「{n}号艇」の1回だけ（丸の数字と重ねない） */}
                <span aria-hidden="true">
                  <BoatBadge n={b} size="sm" />
                </span>
                <span className="ta-sr">{`${b}号艇`}</span>
              </th>
              {[f.second[b - 1], f.third[b - 1]].map((k, i) => (
                <td key={i}>
                  <div className="ta-follow-cell">
                    <span className="ta-follow-track" aria-hidden="true">
                      <span
                        className="ta-follow-fill"
                        style={{ width: `${(k / f.n) * 100}%` }}
                      />
                    </span>
                    <span>{val(k)}</span>
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {f.topTrifecta.length > 0 && (
        <p className="ta-note ta-num">
          {C.flowTopTrifecta}: <ComboList rows={f.topTrifecta} />
        </p>
      )}
      {note === "same" && (
        <p className="ta-note ta-num">
          {win ? C.followSame(axisK, axisN) : C.followSameAlone(axisK, axisN)}
        </p>
      )}
      {note === "refund" && (
        <p className="ta-note ta-num">
          {win ? C.followRefund(f.n, axisK) : C.followRefundAlone(f.n, axisK)}
        </p>
      )}
    </section>
  );
}
