import { useState } from "react";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";
import { ROUND_LABEL, restClassCounts } from "../../../utils/assistModel";
import ClassLineup from "./ClassLineup";

const ok = "✓";
const no = "—";

/**
 * 「集めたレースは2通り」の条件の表（D-26・D-32）。冒頭に畳んで1回だけ置く。開くと、行＝そろえた条件、
 * 列＝全国・級の並びが同じ／類似レース。優勝戦・準優勝戦の日はラウンドの行が両方 ✓ になり、
 * NCR を使っているときは「予選も含めると」の1行を足す（D-37）
 * 「2〜6号艇の級」の行の横に級の並びの絵を小さく置く（2026-10-08 ユーザー決定）
 * G1・SG の日は類似レースだけグレード（G1以上）もそろえる（D-20。similar の conditions.grade_g1plus）
 * @param {{scope: object|null, similarN: number|null, similarConditions?: {grade_g1plus?: boolean}|null, classes: string[]|null, lineup: object[]|null}} props
 *   scope は assistModel.sameClassScope の戻り値
 */
export default function ScopeTable({
  scope,
  similarN,
  similarConditions = null,
  classes,
  lineup,
}) {
  const [open, setOpen] = useState(false);
  const round = scope?.round ?? null;
  const ncr = scope?.kind === "NCR";
  const counts = restClassCounts(classes, 1);
  const rows = [
    [`1号艇の級（${classes?.[0] ?? "—"}）`, ok, ok],
    [ASSIST_COPY.scopeRowRest(counts ?? "—"), ok, no, true],
    round ? [`ラウンド（${ROUND_LABEL[round]}）`, ncr ? ok : no, ok] : null,
    similarConditions?.grade_g1plus ? [ASSIST_COPY.scopeGrade, no, ok] : null,
    ["勝率トップの艇・勝率差の段階", no, ok],
  ].filter(Boolean);
  return (
    <div className="ta-scope">
      <button
        type="button"
        className="ta-scope-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {ASSIST_COPY.scopeToggle} ›
      </button>
      {open && (
        <>
          <table>
            <thead>
              <tr>
                {ASSIST_COPY.scopeHead.map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, a, b, pic]) => (
                <tr key={label}>
                  <td>
                    {label}
                    {pic && <ClassLineup lineup={lineup} small />}
                  </td>
                  <td className="ta-c">{a}</td>
                  <td className="ta-c">{b}</td>
                </tr>
              ))}
              <tr>
                <td>{ASSIST_COPY.scopeRefund[0]}</td>
                <td className="ta-c">{ASSIST_COPY.scopeRefund[1]}</td>
                <td className="ta-c">{ASSIST_COPY.scopeRefund[2]}</td>
              </tr>
              <tr>
                <td>{ASSIST_COPY.scopeCount}</td>
                <td className="ta-c ta-num">
                  {scope ? scope.cell.n.toLocaleString("ja-JP") : "—"}
                </td>
                <td className="ta-c ta-num">{similarN ?? "—"}</td>
              </tr>
            </tbody>
          </table>
          {ncr && scope.withoutRound && (
            <p className="ta-note ta-num">
              {ASSIST_COPY.withoutRound(
                Math.round(
                  (scope.withoutRound.b1_win / scope.withoutRound.n) * 100,
                ),
                scope.withoutRound.n.toLocaleString("ja-JP"),
              )}
            </p>
          )}
          <ul>
            {ASSIST_COPY.scopeNotes.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
