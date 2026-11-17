import { useMoriartyData } from "./HolmesMoriartyData";
import { getStage } from "./HolmesMoriartyLogic";
import HolmesMoriartyHeader from "./HolmesMoriartyHeader";
import {
  MoriartyStageStarting,
  MoriartyStageGathering,
  MoriartyStageGrowing,
  MoriartyStageMature,
} from "./HolmesMoriartyStages";
import { MoriartyExplanation } from "./explanations";
import "./HolmesMoriarty.css";

function HolmesMoriarty() {
  const data = useMoriartyData();
  const { stats, loading, error } = data;

  const totalBets = stats.total_bets ?? 0;
  const stage = getStage(totalBets);

  if (loading) {
    return (
      <div className="holmes-detective-card moriarty-card">
        <div className="moriarty-loading">データを読み込み中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="holmes-detective-card moriarty-card">
        <div className="moriarty-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="holmes-detective-card moriarty-card">
      <HolmesMoriartyHeader />

      {stage === "starting" && (
        <MoriartyStageStarting {...data} totalBets={totalBets} stage={stage} />
      )}
      {stage === "gathering" && (
        <MoriartyStageGathering {...data} totalBets={totalBets} stage={stage} />
      )}
      {stage === "growing" && <MoriartyStageGrowing {...data} />}
      {stage === "mature" && <MoriartyStageMature {...data} />}
      <MoriartyExplanation />
    </div>
  );
}

export default HolmesMoriarty;
