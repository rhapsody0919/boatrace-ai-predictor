import BoatBadge from "../BoatBadge";
import { ASSIST_COPY as C } from "../../../data/thinkingAssistCopy";

const pct = (k, n) => Math.round((k / n) * 100);

/**
 * 「1号艇が1着のとき、2着・3着に来たのは」（BOA-831 案1b、spec D-44 (3)。承認モック v2）。
 * 2〜6号艇 × 2着・3着の割合を1つの表に並べる（中に切り替えは置かない。軸の着順の切り替えと見分けがつかなくなるため）。
 * 件数は札（1号艇が1着の件数）。件数が少ない（MIN_SCENARIO 未満）ときは割合を出さず件数だけ
 * @param {{f: ReturnType<typeof import("../../../utils/assistSummary").winFollowers>, label: string, axisK: number, axisN: number}} props
 *   axisK・axisN は軸の大きい数字（返還のあったレースを含む）。件数が同じなら「同じレース」と書く
 */
export default function WinFollowers({ f, label, axisK, axisN }) {
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
          {C.flowTopTrifecta}:{" "}
          {f.topTrifecta
            .map(([x, k]) => C.trifectaCount(x.join("-"), k))
            .join("　")}
        </p>
      )}
      <p className="ta-note ta-num">
        {f.n === axisK
          ? C.followSame(axisK, axisN)
          : C.followRefund(f.n, axisK)}
      </p>
    </section>
  );
}
