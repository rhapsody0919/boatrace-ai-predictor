/**
 * HolmesAdler - 位置別温度付き Plackett-Luce による順列確率予想 [β版・稼働中]
 *
 * シャーロックの勝率をブラウザ内で順列確率（2連単・3連単・3連複）に展開する。
 */
import { useState, useEffect } from "react";
import {
  getAdlerPredictions,
  getAdlerModelInfo,
} from "../../services/adlerService";
import { AdlerExplanation } from "./explanations";
import { AdlerStatsSection } from "./HolmesAdlerStats";
import { THEME } from "./HolmesAdlerLogic";
import { AdlerLiveSection } from "./HolmesAdlerLive";
import "./HolmesAdler.css";

function HolmesAdler() {
  const [races, setRaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const info = getAdlerModelInfo();

  useEffect(() => {
    getAdlerPredictions(null)
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
          💎
        </div>
        <div className="holmes-detective-meta">
          <div className="holmes-detective-name">アドラー予想</div>
          <div className="holmes-detective-title">
            ホームズを唯一出し抜いた女 - 順位確率の魔法使い
          </div>
          <div className="holmes-detective-tech">
            技術: <code>Plackett-Luce（位置別温度・実データフィット）</code>
          </div>
        </div>
        <div
          className="holmes-status-badge"
          style={{ background: THEME, color: "#fff" }}
        >
          β版・稼働中
        </div>
      </div>

      <AdlerStatsSection info={info} />

      <AdlerLiveSection races={races} loading={loading} />

      <AdlerExplanation />
    </div>
  );
}

export default HolmesAdler;
