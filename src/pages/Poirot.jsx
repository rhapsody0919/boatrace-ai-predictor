import { useEffect, useMemo, useState } from "react";
import Header from "../components/Header";
import { getPoirotPredictions } from "../services/poirotService";
import PoirotExplanation from "../components/poirot/PoirotExplanation";
import PoirotModelTabs from "./PoirotModelTabs";
import PoirotRaceList from "./PoirotRaceList";
import { MODEL_META, selectRaces } from "./PoirotLogic";
import "./Poirot.css";

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
    () => selectRaces(state.races, modelVersion),
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

            <PoirotModelTabs
              modelVersion={modelVersion}
              onSelect={setModelVersion}
            />
            <p className="poirot-model-desc">{meta.description}</p>

            <PoirotRaceList
              loading={state.loading}
              races={races}
              date={state.date}
              modelVersion={modelVersion}
            />

            <PoirotExplanation />
          </section>
        </div>
      </main>
    </>
  );
}
