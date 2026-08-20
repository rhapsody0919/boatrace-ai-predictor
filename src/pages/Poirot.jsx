import { useEffect, useMemo, useState } from "react";
import Header from "../components/Header";
import { getPoirotPredictions } from "../services/poirotService";
import PoirotExplanation from "../components/poirot/PoirotExplanation";
import "./Poirot.css";

const MODEL_META = {
  "rf-v1": {
    label: "V1 ランダムフォレスト",
    short: "V1 RF",
    description:
      "600本の決定木によるアンサンブル（ランダムフォレスト）。各艇の1着・2着・3着確率を別々のモデルで推定し、Plackett-Luce法で3連単の最有力買い目を導出します。",
  },
  "lgbm-v2": {
    label: "V2 LightGBM",
    short: "V2 LGBM",
    description:
      "勾配ブースティング（LightGBM）による次世代モデル。V1と同じ3ヘッド構成をより高精度な木構造で学習しています。確率が高いレースほど信頼度が高くなります。",
  },
};

function formatProb(p) {
  if (p == null) return "-";
  return `${(p * 100).toFixed(1)}%`;
}

/** trifecta_prob に応じた信頼度ラベル（バックテスト: p≥0.10 で回収率100%超え） */
function confidenceBadge(p) {
  if (p == null) return null;
  if (p >= 0.1) return { label: "高", className: "is-high" };
  if (p >= 0.05) return { label: "中", className: "is-mid" };
  return { label: "低", className: "is-low" };
}

export default function Poirot() {
  const [state, setState] = useState({ loading: true, date: "", races: [] });
  const [modelVersion, setModelVersion] = useState("rf-v1");

  useEffect(() => {
    let cancelled = false;
    getPoirotPredictions().then(({ date, races }) => {
      if (!cancelled) setState({ loading: false, date, races });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const races = useMemo(
    () =>
      state.races
        .filter((r) => r.models[modelVersion])
        .sort((a, b) => {
          const pa = a.models[modelVersion]?.trifecta_prob ?? 0;
          const pb = b.models[modelVersion]?.trifecta_prob ?? 0;
          return pb - pa;
        }),
    [state.races, modelVersion],
  );

  const meta = MODEL_META[modelVersion];

  return (
    <>
        <title>ポアロ予想（α） | 龍神レーダー</title>
        <meta name="robots" content="noindex, nofollow" />
      <Header />
      <main className="poirot-page">
        <div className="poirot-container">
          <div className="poirot-header">
            <h1 className="poirot-title">
              ポアロ予想
              <span className="poirot-alpha-badge">α</span>
            </h1>
            <p className="poirot-lead">
              機械学習モデルによる実験的な予想です。既存の本命／スタンダード／穴モデルとは独立して評価中の2バージョンを表示します。
            </p>
          </div>

          <section className="poirot-notice">
            <h2>このページについて</h2>
            <ul>
              <li>
                本ページは <strong>アルファ版（非公開リンク）</strong>{" "}
                です。動線からはアクセスできません。
              </li>
              <li>
                表示内容は実験中のため、的中率・回収率の保証はありません。
              </li>
              <li>本番採用に至った場合は通常の予想ページに統合されます。</li>
            </ul>
          </section>

          <section className="poirot-content">
            <h2>本日の予想</h2>

            <div className="poirot-model-tabs" role="tablist">
              {Object.entries(MODEL_META).map(([version, m]) => (
                <button
                  key={version}
                  role="tab"
                  aria-selected={modelVersion === version}
                  className={
                    "poirot-model-tab" +
                    (modelVersion === version ? " is-active" : "")
                  }
                  onClick={() => setModelVersion(version)}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="poirot-model-desc">{meta.description}</p>

            {state.loading ? (
              <div className="poirot-placeholder">
                <p>読み込み中...</p>
              </div>
            ) : races.length === 0 ? (
              <div className="poirot-placeholder">
                <p>本日の予想はまだありません。</p>
                <p className="poirot-placeholder-sub">
                  予想は日次バッチで生成されます。しばらくしてから再度お試しください。
                </p>
              </div>
            ) : (
              <>
                <p className="poirot-list-note">
                  3連単の予測確率が高い順に表示（
                  {state.date} / {races.length}レース）
                </p>
                <ul className="poirot-race-list">
                  {races.map((race) => {
                    const pred = race.models[modelVersion];
                    const badge = confidenceBadge(pred.trifecta_prob);
                    return (
                      <li key={race.race_id} className="poirot-race-card">
                        <div className="poirot-race-head">
                          <span className="poirot-race-venue">
                            {race.venue_name} {race.race_number}R
                          </span>
                          {race.start_time && (
                            <span className="poirot-race-time">
                              {String(race.start_time).slice(0, 5)}
                            </span>
                          )}
                          {badge && (
                            <span
                              className={`poirot-conf-badge ${badge.className}`}
                            >
                              信頼度{badge.label}
                            </span>
                          )}
                        </div>
                        <div className="poirot-race-body">
                          <div className="poirot-combo">
                            <span className="poirot-combo-label">3連単</span>
                            <span className="poirot-combo-boats">
                              {pred.top_pick}-{pred.top_2nd}-{pred.top_3rd}
                            </span>
                            <span className="poirot-combo-prob">
                              予測確率 {formatProb(pred.trifecta_prob)}
                            </span>
                          </div>
                          <div className="poirot-probs">
                            {Object.entries(pred.win_probs || {})
                              .sort(([a], [b]) => Number(a) - Number(b))
                              .map(([boat, p]) => (
                                <span
                                  key={boat}
                                  className={
                                    "poirot-prob-chip" +
                                    (Number(boat) === pred.top_pick
                                      ? " is-top"
                                      : "")
                                  }
                                >
                                  <i className={`boat-i b${boat}`}>{boat}</i>
                                  {formatProb(p)}
                                </span>
                              ))}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            <PoirotExplanation />
          </section>
        </div>
      </main>
    </>
  );
}
