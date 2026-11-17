export const MODEL_META = {
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

export function formatProb(p) {
  if (p == null) return "-";
  return `${(p * 100).toFixed(1)}%`;
}

/** trifecta_prob に応じた信頼度ラベル（バックテスト: p≥0.10 で回収率100%超え） */
export function confidenceBadge(p) {
  if (p == null) return null;
  if (p >= 0.1) return { label: "高", className: "is-high" };
  if (p >= 0.05) return { label: "中", className: "is-mid" };
  return { label: "低", className: "is-low" };
}

export function selectRaces(allRaces, modelVersion) {
  return allRaces
    .filter((r) => r.models[modelVersion])
    .sort((a, b) => {
      const pa = a.models[modelVersion]?.trifecta_prob ?? 0;
      const pb = b.models[modelVersion]?.trifecta_prob ?? 0;
      return pb - pa;
    });
}

export function sortedWinProbs(pred) {
  return Object.entries(pred.win_probs || {}).sort(
    ([a], [b]) => Number(a) - Number(b),
  );
}
