import { useEffect, useState } from "react";
import { getMetricObservations } from "../../../services/snsHubService.js";
import {
  compareObservations,
  OBSERVATION_METRICS,
} from "../../../utils/snsObservations.js";
import "./MetricsTab.css";

export default function MetricsTab() {
  const [window, setWindow] = useState("48h");
  const [metric, setMetric] = useState("views");
  const [state, setState] = useState({
    loading: true,
    error: null,
    groups: [],
  });
  useEffect(() => {
    let active = true;
    getMetricObservations(window, metric)
      .then(({ drafts, observations }) => {
        if (active)
          setState({
            loading: false,
            error: null,
            groups: compareObservations(drafts, observations, {
              window,
              metric,
            }),
          });
      })
      .catch((error) => {
        if (active)
          setState({ loading: false, error: error.message, groups: [] });
      });
    return () => {
      active = false;
    };
  }, [window, metric]);
  const change = (setter, value) => {
    setState({ loading: true, error: null, groups: [] });
    setter(value);
  };
  return (
    <section className="sns-observation-panel">
      <h2>観測窓別の型比較</h2>
      <p>
        同じチャネル・言語・型の版・尺・取得元・定義で比較します。10本未満は暫定です。欠測は0にしません。
      </p>
      <label>
        観測窓{" "}
        <select
          value={window}
          onChange={(e) => change(setWindow, e.target.value)}
        >
          <option value="48h">48h</option>
          <option value="7d">7d</option>
        </select>
      </label>
      <label>
        指標{" "}
        <select
          value={metric}
          onChange={(e) => change(setMetric, e.target.value)}
        >
          {OBSERVATION_METRICS.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <p>
        API反映が対象期間に届かない値と、遅れて取得した累積値は欠測です。engagedViews/viewsを「視聴を継続した割合」として算出しません。
      </p>
      {state.loading ? (
        <p role="status">読み込み中…</p>
      ) : state.error ? (
        <p role="alert">{state.error}</p>
      ) : !state.groups.length ? (
        <p>観測窓を終えた投稿はありません。</p>
      ) : (
        state.groups.map((group) => (
          <article className="sns-observation-card" key={group.key}>
            <h3>
              {group.platform} / {group.language} / {group.format}
            </h3>
            <p>
              版: {group.variant || "未確認"} / 尺: {group.duration ?? "未確認"}
              秒 / {group.source} / {group.kind}
            </p>
            <p>
              定義: {group.definition} / 分母:{" "}
              {group.denominator ?? "未提供・該当なし"}
            </p>
            <p>
              投稿 {group.count}本・有効 {group.values.length}本{" "}
              {group.provisional && "（10本未満・暫定）"} / 中央値:{" "}
              {group.median ?? "欠測"}
            </p>
            <p>
              欠測理由:{" "}
              {Object.entries(group.missing)
                .map(([reason, count]) => `${reason}: ${count}本`)
                .join("、") || "なし"}
            </p>
            <details>
              <summary>分布・取得時点・維持曲線</summary>
              <p>値の分布: {group.values.join(" / ") || "欠測"}</p>
              {group.posts.map((post) => (
                <p key={post.draft_id}>
                  {post.draft_id} / 取得: {post.observed_at || "未収集"} /
                  データ最終: {post.data_through || "不明"} / 値:{" "}
                  {post.value ?? "欠測"} / revision: {post.revision ?? "なし"}
                </p>
              ))}
              {group.curves.map((curve) => (
                <div key={curve.draft_id}>
                  <p>
                    {curve.draft_id} の維持曲線（経過割合 / audienceWatchRatio）
                  </p>
                  <svg
                    className="sns-observation-curve"
                    viewBox="0 0 300 120"
                    role="img"
                    aria-label={`${curve.draft_id}の維持曲線`}
                  >
                    <polyline
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      points={curve.points
                        .map(
                          (point) =>
                            `${10 + point.elapsed_ratio * 280},${110 - (point.value / Math.max(1, ...curve.points.map((p) => p.value))) * 100}`,
                        )
                        .join(" ")}
                    />
                  </svg>
                  <ul>
                    {curve.points.map((point) => (
                      <li key={point.elapsed_ratio}>
                        {point.elapsed_ratio} / {point.value}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </details>
          </article>
        ))
      )}
    </section>
  );
}
