import { Link } from "react-router-dom";
import { SONAR_RACE_TAB } from "../../../utils/raceUrlState";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";
import AssistHeaderRow from "./AssistHeaderRow";
import AssistHeaderSub from "./AssistHeaderSub";

function oddsText(oddsFinal, oddsAt) {
  if (oddsFinal) return ASSIST_COPY.oddsAtFinal;
  return oddsAt ? ASSIST_COPY.oddsAt(oddsAt) : "";
}

/**
 * ヘッダー（spec FR-2、screens S-1 A）: 会場・R・ラウンド・グレード・締切、気象（展示後だけ）・時点の切り替え、
 * 堅い？荒れる？の枠（children）、オッズの取得時刻、龍神ソナーへの導線（ソナーを表示できる端末だけ、D-36 (8)）。
 * 会場名を押すと会場の特徴のシート。ラウンド・風・潮（干満差のある会場だけ。公式の場データ）の「傾向 ›」はセオリーカード（D-15。Codex F09）
 */
export default function AssistHeader({
  race,
  venueCode = null,
  raceId,
  round,
  stage,
  canPost,
  onStage,
  oddsAt,
  oddsFinal = false,
  showSonar,
  tidal = false,
  onVenue,
  children,
}) {
  return (
    <header className="ta-header">
      <AssistHeaderRow race={race} round={round} onVenue={onVenue} />
      <AssistHeaderSub
        race={race}
        venueCode={venueCode}
        stage={stage}
        canPost={canPost}
        onStage={onStage}
        tidal={tidal}
      />
      {children}
      <div className="ta-header-foot">
        {/* オッズが無いときは買い目レンズの図に「発売後に出る」を出す（screens「状態」）。ここでは出さない */}
        <span className="ta-num">{oddsText(oddsFinal, oddsAt)}</span>
        {/* 龍神ソナーは別のタブ（BOA-271）。内部タブは指定せず、ソナーの既定（差がつく材料）で開く。
            以前は ?tab=aiPrediction のままで AI予想タブに移っていた（2026-10-17 オーナー指摘） */}
        {showSonar && (
          <Link
            className="ta-link"
            to={`/race/${raceId}?tab=${SONAR_RACE_TAB}`}
          >
            {ASSIST_COPY.sonarLink}
          </Link>
        )}
      </div>
    </header>
  );
}
