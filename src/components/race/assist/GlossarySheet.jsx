import BottomSheet from "./BottomSheet";
import ClassLineup from "./ClassLineup";
import { SCORE_POINTS } from "../seriesPoints";
import { ASSIST_COPY as C, GLOSSARY } from "../../../data/thinkingAssistCopy";

/** 今節の平均着順点の配点の表（着 → 点）。F・L・失格は0点 */
function PointsTable() {
  return (
    <div className="ta-scroll">
      <table className="ta-table">
        <thead>
          <tr>
            <th scope="col">着</th>
            {[1, 2, 3, 4, 5, 6].map((f) => (
              <th key={f} scope="col">
                {f}
              </th>
            ))}
            <th scope="col">F・L・失格</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">点</th>
            {[1, 2, 3, 4, 5, 6].map((f) => (
              <td key={f} className="ta-num">
                {SCORE_POINTS[f]}
              </td>
            ))}
            <td className="ta-num">0</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** 平均ST の目盛り（0に近いほど早い） */
function StScale() {
  return (
    <div className="ta-gl-st" aria-hidden="true">
      <span className="ta-num">.00</span>
      <span className="ta-gl-st-bar" />
      <span className="ta-num">.25</span>
      <span />
      <span className="ta-gl-st-dir">{C.stScaleDir}</span>
      <span />
    </div>
  );
}

/**
 * 用語のシート（D-8・D-15・D-32）。「?」から開く。用語の意味だけで、過去レースの傾向は出さない（それはセオリーカード）。
 * 長い説明は箇条書き・表・絵にする
 * @param {{term: string, lineup: object[]|null, classNote: string|null, finalRound: boolean, onClose: () => void}} props
 *   lineup・classNote は「全国・級の並びが同じ」の今日の値の絵と注記（D-42）
 */
export default function GlossarySheet({
  term,
  lineup,
  classNote,
  finalRound,
  onClose,
}) {
  const g = GLOSSARY[term];
  return (
    <BottomSheet title={term} onClose={onClose}>
      {g ? (
        <div className="ta-gl">
          {/* 定義 → 絵 → 注記の順（デザイナーのレビュー P2-7） */}
          <p className="ta-gl-lead">{g.lead}</p>
          {g.classes && lineup && <ClassLineup lineup={lineup} />}
          {g.classes && classNote && <p className="ta-note">{classNote}</p>}
          {g.stScale && <StScale />}
          {g.points && <PointsTable />}
          {g.points && finalRound && (
            <p className="ta-note">{C.theoryFactFinalOff}</p>
          )}
          {g.items && (
            <ul className="ta-list">
              {g.items.map((it) => (
                <li key={it}>{it}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="ta-note">{C.noRunsData}</p>
      )}
    </BottomSheet>
  );
}
