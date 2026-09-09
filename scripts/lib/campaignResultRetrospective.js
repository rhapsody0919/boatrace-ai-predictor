/**
 * 企画エントリの結果確定後、「なぜ当たった/外れたか」を実データで説明する
 * 振り返り文を組み立てる。
 *
 * サイトのレース詳細ページ「データで振り返る」（src/components/race/raceIndicators.jsx・
 * RaceReview.jsx）と同じ方法論（指標のレース内順位が上位2/下位2なら強気/弱気と
 * みなし、実際に3着以内に入ったかどうかと突き合わせて整合/不整合を判定する）を、
 * 企画がすでに持っている実データ（win_rate・motor_2rate・turnPrediction）だけで
 * 簡易的に再現したもの。サイト本実装は7指標（当地勝率・調子・ST・展示タイム等も
 * 含む）を見るためこちらとは一致しない場合がある（2026-09-09、7指標フル移植は
 * 工数に見合わないと判断しユーザー合意の上でこの簡易版にした）。
 *
 * 生成する文はそのままキャプション本文になるわけではなく、sns_topics.topic_text
 * に埋め込む「材料」。実際の文章化はX/blogの生成Routineが担う
 * （docs/operation/sns-pipeline-x.md参照）。
 */

const METRIC_LABELS = {
  win_rate: "全国勝率",
  motor_2rate: "モーター2連率",
};

const TECHNIQUE_LABELS = { nige: "逃げ", sashi: "差し", makuri: "まくり" };

/** boatsを指標降順に並べ、boat_number -> 順位(1-6)のMapを返す */
function rankOf(boats, metricKey) {
  const sorted = [...boats].sort(
    (a, b) => (b[metricKey] ?? -Infinity) - (a[metricKey] ?? -Infinity),
  );
  const map = new Map();
  sorted.forEach((b, i) => map.set(b.boat_number, i + 1));
  return map;
}

/** 順位から強気/弱気シグナルを判定する（上位2=strong、下位2=weak、3-4位はnull） */
function signalOf(rank, totalBoats) {
  if (rank == null) return null;
  if (rank <= 2) return "strong";
  if (rank >= totalBoats - 1) return "weak";
  return null;
}

/** シグナルと実際の着順（3着以内か）を突き合わせ、match/mismatch/nullを返す */
function markFor(signal, good) {
  if (signal === "strong") return good ? "match" : "mismatch";
  if (signal === "weak") return good ? "mismatch" : "match";
  return null;
}

function describeBoat(boats, boatNumber, label, winRateRank, motorRank, good) {
  const totalBoats = boats.length;
  const wr = winRateRank.get(boatNumber);
  const mr = motorRank.get(boatNumber);
  const wrMark = markFor(signalOf(wr, totalBoats), good);
  const mrMark = markFor(signalOf(mr, totalBoats), good);
  const resultText = good ? "3着以内で通過" : "着外";
  const sentences = { match: [], mismatch: [] };

  if (wrMark && wrMark === mrMark) {
    // 両指標が同じ判定なら1文にまとめる（冗長な繰り返しを避ける）
    const connector = wrMark === "match" ? "通り" : "だったが";
    sentences[wrMark].push(
      `${boatNumber}号艇（${label}）は全国勝率・モーター2連率とも参加${totalBoats}艇中${wr}位・${mr}位のデータ${connector}、実際は${resultText}`,
    );
    return sentences;
  }
  if (wrMark) {
    const connector = wrMark === "match" ? "通り" : "だったが";
    sentences[wrMark].push(
      `${boatNumber}号艇（${label}）は${METRIC_LABELS.win_rate}が参加${totalBoats}艇中${wr}位のデータ${connector}、実際は${resultText}`,
    );
  }
  if (mrMark) {
    const connector = mrMark === "match" ? "通り" : "だったが";
    sentences[mrMark].push(
      `${boatNumber}号艇（${label}）は${METRIC_LABELS.motor_2rate}が参加${totalBoats}艇中${mr}位のデータ${connector}、実際は${resultText}`,
    );
  }
  return sentences;
}

function describeTurnPrediction(turnPrediction, winnerBoatNumber) {
  const patterns = turnPrediction?.patterns;
  if (!patterns || patterns.length === 0) return null;
  const top = [...patterns].sort((a, b) => b.probability - a.probability)[0];
  if (!top) return null;

  const predictedBoat = top.winnerCourse;
  const pct = Math.round(top.probability * 100);
  const techniqueLabel = TECHNIQUE_LABELS[top.technique] || top.technique;

  if (predictedBoat === winnerBoatNumber) {
    return {
      mark: "match",
      text: `展開予測は${predictedBoat}号艇の${techniqueLabel}（確率${pct}%）を1着候補としており、実際にその通り1着だった`,
    };
  }
  return {
    mark: "mismatch",
    text: `展開予測は${predictedBoat}号艇の${techniqueLabel}（確率${pct}%）を1着候補としていたが、実際の1着は${winnerBoatNumber}号艇だった`,
  };
}

/**
 * @param {object} params
 * @param {{boat_number:number, win_rate:number, motor_2rate:number}[]} params.boats - race_entriesから取得した6艇分のデータ
 * @param {string} params.actualResult - 実際の着順（例: "2-1-6"）
 * @param {object|null} params.turnPrediction - feature_contributions.turnPrediction
 * @param {number[]} params.pickedBoatNumbers - 買い目に含まれる艇番（例: [3,2,4]）。先頭を「本命」として扱う
 * @returns {{matches: string[], mismatches: string[]}}
 */
export function buildResultRetrospective({
  boats,
  actualResult,
  turnPrediction,
  pickedBoatNumbers,
}) {
  const positions = actualResult.split("-").map(Number);
  const top3 = new Set(positions);
  const winnerBoatNumber = positions[0];

  const winRateRank = rankOf(boats, "win_rate");
  const motorRank = rankOf(boats, "motor_2rate");

  const matches = [];
  const mismatches = [];

  function addBoat(boatNumber, label) {
    const good = top3.has(boatNumber);
    const s = describeBoat(
      boats,
      boatNumber,
      label,
      winRateRank,
      motorRank,
      good,
    );
    matches.push(...s.match);
    mismatches.push(...s.mismatch);
  }

  const topPickBoat = pickedBoatNumbers?.[0];
  if (topPickBoat != null) addBoat(topPickBoat, "本命");
  if (winnerBoatNumber != null && winnerBoatNumber !== topPickBoat) {
    addBoat(winnerBoatNumber, "実際の1着");
  }

  const tp = describeTurnPrediction(turnPrediction, winnerBoatNumber);
  if (tp) (tp.mark === "match" ? matches : mismatches).push(tp.text);

  return { matches, mismatches };
}
