import { ASSIST_COPY as C } from "../../../data/thinkingAssistCopy";
import WinFollowers from "./WinFollowers";
import { AxisSummary } from "./LensSummaryAxis";
import { FlowSummary } from "./LensSummaryFlow";
import { PowerSummary } from "./LensSummaryPower";
import { BetLensSummary } from "./LensSummaryBet";

export { FlowConclusion } from "./LensSummaryFlow";

/**
 * レンズの要約（FR-4、screens S-1 D）。レースの全体に関わる値をレンズごとに並べる（承認モック v7 の renderSum）。
 * 6艇の値の最良は金枠だけで示す（隠し文字は図の数字の側だけ）
 * @param {{lens: string, axis: object|null, flow: object, power: object, place: object|null, bet: object}} props 各レンズの材料
 */
export default function LensSummary({ lens, axis, flow, power, place, bet }) {
  return (
    <div className="ta-sum">
      {lens === "axis" && axis && <AxisSummary m={axis} />}
      {lens === "flow" && <FlowSummary m={flow} />}
      {lens === "power" && <PowerSummary m={power} />}
      {lens === "place" && place?.ready && (
        // 相手レンズ: {X}号艇を軸にしたときの2着（BOA-845、spec D-48）
        <WinFollowers
          f={place.f}
          marks={place.marks}
          axis={place.axis}
          auto={place.auto}
          venue={place.venue}
          raceId={place.raceId}
          onAxis={place.onAxis}
        />
      )}
      {lens === "place" && place?.failed && (
        <p className="ta-note">{C.partFailed(C.partVenueAll)}</p>
      )}
      {lens === "bet" && <BetLensSummary m={bet} />}
    </div>
  );
}
