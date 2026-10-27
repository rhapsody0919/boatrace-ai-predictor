import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";
import { ASSIST_BET_TYPES } from "../../../utils/assistModel";

/**
 * 買い目の券種のタブ（BOA-990、承認モック 画面1〜3）。1つずつ切り替える。候補の段は券種をまたいで共有（状態は親）
 * @param {{betType: string, onBetType: (id: string) => void}} props
 */
export default function BetTypeTabs({ betType, onBetType }) {
  return (
    <div
      className="ta-bettype"
      role="group"
      aria-label={ASSIST_COPY.betTypeGroup}
      style={{ "--ta-bettype-n": ASSIST_BET_TYPES.length }}
    >
      {ASSIST_BET_TYPES.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={betType === t.id}
          onClick={() => onBetType(t.id)}
        >
          {ASSIST_COPY.betTypeLabels[t.id]}
        </button>
      ))}
    </div>
  );
}
