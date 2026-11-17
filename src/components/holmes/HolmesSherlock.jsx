import { useState, useEffect } from "react";
import {
  getSherlockPredictions,
  getSherlockModelInfo,
} from "../../services/sherlockService";
import { SherlockExplanation } from "./explanations";
import HolmesSherlockStats from "./HolmesSherlockStats";
import HolmesSherlockLive from "./HolmesSherlockLive";
import { THEME } from "./HolmesSherlockLogic";
import "./HolmesSherlock.css";

function HolmesSherlock() {
  const [races, setRaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const info = getSherlockModelInfo();

  useEffect(() => {
    getSherlockPredictions(null)
      .then(setRaces)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div
      className="holmes-detective-card"
      style={{ borderTop: `4px solid ${THEME}` }}
    >
      <div className="holmes-detective-header">
        <div className="holmes-detective-icon" style={{ background: THEME }}>
          🔍
        </div>
        <div className="holmes-detective-meta">
          <div className="holmes-detective-name">シャーロック予想</div>
          <div className="holmes-detective-title">
            名探偵本人 - 事実と市場、両方を観察する推理機械
          </div>
          <div className="holmes-detective-tech">
            技術: <code>Conditional Logit + Odds Blend (Benter 2段階)</code>
          </div>
        </div>
        <div
          className="holmes-status-badge"
          style={{ background: THEME, color: "#fff" }}
        >
          β版・稼働中
        </div>
      </div>

      <HolmesSherlockStats info={info} />

      <HolmesSherlockLive races={races} loading={loading} />

      <SherlockExplanation />
    </div>
  );
}

export default HolmesSherlock;
