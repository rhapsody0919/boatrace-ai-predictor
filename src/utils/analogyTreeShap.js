/**
 * アナロジー・ファインダーのレースごとの寄与度（BOA-271 FR-1b、ADR-0083）: LightGBM の
 * `Booster.dump_model()` の JSON から、生スコアの推論と TreeSHAP（pred_contrib と同じ値）を出す純粋関数。
 *
 * LightGBM（src/io/tree.cpp・include/LightGBM/tree.h）の移植。試作は
 * scripts/analysis/analogy-finder-perrace/treeshap.mjs。Python の pred_contrib との一致は
 * scripts/ml/analogy/treeshap-parity.js（学習ジョブの品質ゲート）と verify-analogy-treeshap.js（CI）で固定している。
 *
 * 入力の特徴量は float32 の値（Math.fround 済み）を double で持つ配列。欠損は NaN。
 * 対応しているのは1クラスの木（binary 等）だけで、線形木・多クラスは compileModel が拒否する。
 */

/** LightGBM の kZeroThreshold（missing_type が Zero の分岐で 0 とみなす幅） */
const ZERO_THRESHOLD = 1e-35;

const isLeaf = (n) => n.leaf_value !== undefined;

function compileTree(root) {
  const feat = [];
  const thr = [];
  const cats = [];
  const defaultLeft = [];
  const missing = [];
  const left = [];
  const right = [];
  const count = [];
  // 葉は ~index で表す。LightGBM の ExpectedValue は leaf_index の順に足すので、その順で持つ
  const leafValue = [];
  const leafCount = [];
  let maxDepth = 0;

  const walk = (n, depth) => {
    if (isLeaf(n)) {
      const idx = n.leaf_index ?? leafValue.length;
      leafValue[idx] = n.leaf_value;
      leafCount[idx] = n.leaf_count;
      maxDepth = Math.max(maxDepth, depth);
      return ~idx;
    }
    const i = feat.length;
    const isCat = n.decision_type === "==";
    if (!isCat && n.decision_type !== "<=") {
      throw new Error(
        `analogyTreeShap: 未対応の分岐 decision_type=${n.decision_type}`,
      );
    }
    feat.push(n.split_feature);
    count.push(n.internal_count);
    thr.push(isCat ? 0 : Number(n.threshold));
    cats.push(
      isCat ? new Set(String(n.threshold).split("||").map(Number)) : null,
    );
    defaultLeft.push(n.default_left);
    missing.push(n.missing_type);
    left.push(0);
    right.push(0);
    left[i] = walk(n.left_child, depth + 1);
    right[i] = walk(n.right_child, depth + 1);
    return i;
  };

  if (isLeaf(root)) {
    return {
      single: true,
      leafValue: [root.leaf_value],
      expected: root.leaf_value,
    };
  }
  walk(root, 0);
  const total = count[0];
  let expected = 0;
  for (let i = 0; i < leafValue.length; i++) {
    expected += (leafCount[i] / total) * leafValue[i];
  }
  return {
    single: false,
    feat,
    thr,
    cats,
    defaultLeft,
    missing,
    left,
    right,
    count,
    leafValue,
    leafCount,
    maxDepth,
    expected,
  };
}

/**
 * dump_model() の JSON（オブジェクト）を推論用に変換する。
 * @returns {{trees: object[], numFeatures: number, featureNames: string[], objective: string}}
 */
export function compileModel(dump) {
  if (!dump || !Array.isArray(dump.tree_info)) {
    throw new Error(
      "analogyTreeShap: dump_model の JSON ではありません（tree_info がない）",
    );
  }
  if ((dump.num_tree_per_iteration ?? 1) !== 1 || (dump.num_class ?? 1) !== 1) {
    throw new Error(
      `analogyTreeShap: 多クラスのモデルには対応していません（num_class=${dump.num_class}）`,
    );
  }
  if (dump.average_output) {
    throw new Error(
      "analogyTreeShap: average_output（random forest）のモデルには対応していません",
    );
  }
  if (dump.tree_info.some((t) => t.is_linear)) {
    throw new Error("analogyTreeShap: 線形木のモデルには対応していません");
  }
  return {
    trees: dump.tree_info.map((t) => compileTree(t.tree_structure)),
    numFeatures: dump.max_feature_idx + 1,
    featureNames: dump.feature_names ?? [],
    objective: String(dump.objective ?? ""),
  };
}

// tree.h の NumericalDecision・CategoricalDecision と同じ向き
function decision(t, x, node) {
  let f = x[t.feat[node]];
  const nan = f === null || f === undefined || Number.isNaN(f);
  if (t.cats[node]) {
    if (nan) return t.right[node];
    const iv = Math.trunc(f);
    if (iv < 0) return t.right[node];
    return t.cats[node].has(iv) ? t.left[node] : t.right[node];
  }
  const miss = t.missing[node];
  if (nan && miss !== "NaN") f = 0;
  if (
    (miss === "Zero" && f >= -ZERO_THRESHOLD && f <= ZERO_THRESHOLD) ||
    (miss === "NaN" && nan)
  ) {
    return t.defaultLeft[node] ? t.left[node] : t.right[node];
  }
  return f <= t.thr[node] ? t.left[node] : t.right[node];
}

const nodeCount = (t, n) => (n >= 0 ? t.count[n] : t.leafCount[~n]);

/** 生スコア（binary なら logit）。pred_contrib の合計と同じ値になる */
export function predictRaw(model, x) {
  let s = 0;
  for (const t of model.trees) {
    if (t.single) {
      s += t.leafValue[0];
      continue;
    }
    let n = 0;
    while (n >= 0) n = decision(t, x, n);
    s += t.leafValue[~n];
  }
  return s;
}

// ---- TreeSHAP（tree.cpp の ExtendPath・UnwindPath・UnwoundPathSum・TreeSHAP）
// path は平坦な配列で、1要素4枠（feature_index, zero_fraction, one_fraction, pweight）
const W = 4;

function extendPath(P, base, d, zero, one, fi) {
  const k = (base + d) * W;
  P[k] = fi;
  P[k + 1] = zero;
  P[k + 2] = one;
  P[k + 3] = d === 0 ? 1 : 0;
  for (let i = d - 1; i >= 0; i--) {
    const a = (base + i) * W;
    P[a + W + 3] += (one * P[a + 3] * (i + 1)) / (d + 1);
    P[a + 3] = (zero * P[a + 3] * (d - i)) / (d + 1);
  }
}

function unwindPath(P, base, d, pi) {
  const one = P[(base + pi) * W + 2];
  const zero = P[(base + pi) * W + 1];
  let next = P[(base + d) * W + 3];
  for (let i = d - 1; i >= 0; i--) {
    const a = (base + i) * W + 3;
    if (one !== 0) {
      const tmp = P[a];
      P[a] = (next * (d + 1)) / ((i + 1) * one);
      next = tmp - (P[a] * zero * (d - i)) / (d + 1);
    } else {
      P[a] = (P[a] * (d + 1)) / (zero * (d - i));
    }
  }
  for (let i = pi; i < d; i++) {
    const a = (base + i) * W;
    P[a] = P[a + W];
    P[a + 1] = P[a + W + 1];
    P[a + 2] = P[a + W + 2];
  }
}

function unwoundPathSum(P, base, d, pi) {
  const one = P[(base + pi) * W + 2];
  const zero = P[(base + pi) * W + 1];
  let next = P[(base + d) * W + 3];
  let total = 0;
  for (let i = d - 1; i >= 0; i--) {
    if (one !== 0) {
      const tmp = (next * (d + 1)) / ((i + 1) * one);
      total += tmp;
      next = P[(base + i) * W + 3] - tmp * zero * ((d - i) / (d + 1));
    } else {
      total += P[(base + i) * W + 3] / zero / ((d - i) / (d + 1));
    }
  }
  return total;
}

function treeShap(t, x, phi, node, depth, P, parentBase, pZero, pOne, pFeat) {
  let d = depth;
  const base = parentBase + d; // 親の path を自分の領域へ写す
  if (d > 0) P.copyWithin(base * W, parentBase * W, (parentBase + d) * W);
  extendPath(P, base, d, pZero, pOne, pFeat);

  if (node < 0) {
    const v = t.leafValue[~node];
    for (let i = 1; i <= d; i++) {
      const w = unwoundPathSum(P, base, d, i);
      const a = (base + i) * W;
      phi[P[a]] += w * (P[a + 2] - P[a + 1]) * v;
    }
    return;
  }

  const hot = decision(t, x, node);
  const cold = hot === t.left[node] ? t.right[node] : t.left[node];
  const w = nodeCount(t, node);
  const hotZero = nodeCount(t, hot) / w;
  const coldZero = nodeCount(t, cold) / w;
  const sf = t.feat[node];
  let inZero = 1;
  let inOne = 1;
  let pi = 0;
  for (; pi <= d; pi++) if (P[(base + pi) * W] === sf) break;
  if (pi !== d + 1) {
    inZero = P[(base + pi) * W + 1];
    inOne = P[(base + pi) * W + 2];
    unwindPath(P, base, d, pi);
    d -= 1;
  }
  treeShap(t, x, phi, hot, d + 1, P, base, hotZero * inZero, inOne, sf);
  treeShap(t, x, phi, cold, d + 1, P, base, coldZero * inZero, 0, sf);
}

/**
 * 1艇ぶんの寄与度。pred_contrib と同じ並び（特徴量ごとの値、最後が期待値）で長さ numFeatures+1。
 * 合計は predictRaw と（浮動小数の誤差の範囲で）一致する。
 */
export function contributions(model, x) {
  const nf = model.numFeatures;
  const phi = new Float64Array(nf + 1);
  for (const t of model.trees) {
    phi[nf] += t.expected;
    if (t.single) continue;
    const m = t.maxDepth + 2;
    const P = new Float64Array(((m * (m + 1)) / 2) * W + W * 16);
    treeShap(t, x, phi, 0, 0, P, 0, 1, 1, -1);
  }
  return phi;
}
