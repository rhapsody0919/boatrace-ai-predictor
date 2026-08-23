/**
 * SNSショート動画向けの「良いネタレース」自動候補選定
 *
 * 背景: マスコット動画（scratch-tiktok-pilot）の題材選定を手作業で行った際、
 * 「DBに実データがある」ことと「動画のフックとして面白いか」は別物だと判明した
 * （2026-08-22〜23、廃止済みモデルの誤選定・展開予測ミスのレースの誤選定を経て
 * 児島2R=イン崩れ指数100%かつ展開予測も的中、という実例にたどり着いた）。
 * その選定基準をスクリプト化し、次回以降は毎回ゼロから手探りしないようにする。
 *
 * スコアリング方針（今回の実例から逆算）:
 * - 展開予測パターンのいずれかが的中（is_hit_turn）: 現行UIの「上位予想の1つが的中しました」
 *   バッジがそのまま実画面のスクショに使える、最も再現性の高いフォーマット
 * - イン崩れ指数が高かった（volatilityPercentile>=0.8）のに実際に1号艇が飛んだ:
 *   「AIが荒れを警告→的中」という説明不要のストーリー。ただし現行UIはレース確定後に
 *   イン崩れ指数バッジを表示しないため、動画内では実データを直接テキスト化する必要がある
 *   （画面キャプチャではなく、このスクリプトの出力値をそのままテロップに使う）
 * - 両方を満たす（ダブル的中）レースを最優先する（児島2Rと同じパターン）
 * - 1号艇以外が勝ったレース（アップセット）・払戻が大きいレースほど「驚き」の起伏が大きい
 *
 * 使い方:
 *   node scripts/analysis/find-video-worthy-race.js [--days=2] [--top=5]
 *
 * 注意: これは候補の一次選定のみ。出力された候補が実際にライブUIで期待通り
 * 表示されるか（廃止済み機能でないか等）は、必ずPlaywrightで実画面を確認してから
 * 台本に採用すること（video-producer-prompt.mdのステップ2参照）。
 */
import { supabase, VENUE_NAMES } from "../lib/supabaseClient.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? true];
  }),
);
const DAYS = Number(args.days ?? 2);
const TOP_N = Number(args.top ?? 5);

const HIGH_VOLATILITY_THRESHOLD = 0.8;

async function fetchAll(table, buildQuery) {
  const PAGE = 1000;
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

function parseRaceId(raceId) {
  const [y, m, d, venueCode, raceNumber] = raceId.split("-");
  return {
    date: `${y}-${m}-${d}`,
    venueCode: parseInt(venueCode, 10),
    raceNumber: parseInt(raceNumber, 10),
  };
}

function scoreCandidate(c) {
  let score = 0;
  score += Math.min(c.payoutWin / 20, 50); // 払戻を得点化(上限50点、2000円で頭打ち)
  if (c.turnHit) score += 30;
  if (c.volatilityCorrect) score += 40;
  if (c.turnHit && c.volatilityCorrect) score += 30; // ダブル的中ボーナス
  if (c.actualRank1 !== 1) score += 15; // アップセットボーナス
  return Math.round(score);
}

async function main() {
  const since = new Date();
  since.setDate(since.getDate() - DAYS);
  const sinceIso = since.toISOString();

  const predictions = await fetchAll("predictions", (from, to) =>
    supabase
      .from("predictions")
      .select("race_id, feature_contributions, predicted_at")
      .eq("model_id", "unified")
      .gte("predicted_at", sinceIso)
      .not("feature_contributions", "is", null)
      .range(from, to),
  );

  if (predictions.length === 0) {
    console.log(`直近${DAYS}日以内のunified予想データが見つかりませんでした。`);
    return;
  }

  const raceIds = predictions.map((p) => p.race_id);
  const chunks = [];
  for (let i = 0; i < raceIds.length; i += 500) {
    chunks.push(raceIds.slice(i, i + 500));
  }
  let results = [];
  for (const chunk of chunks) {
    const { data, error } = await supabase
      .from("race_results")
      .select(
        "race_id, rank1, rank2, rank3, payout_win, payout_trifecta, winning_technique",
      )
      .in("race_id", chunk);
    if (error) throw new Error(`race_results: ${error.message}`);
    results = results.concat(data);
  }
  const resultMap = Object.fromEntries(results.map((r) => [r.race_id, r]));

  const candidates = predictions
    .map((p) => {
      const result = resultMap[p.race_id];
      if (!result) return null;

      const patterns = p.feature_contributions?.turnPrediction?.patterns || [];
      const matchedPattern = patterns.find(
        (pt) => pt.winnerCourse === result.rank1,
      );
      const volatilityPercentile =
        p.feature_contributions?.volatilityPercentile;
      const volatilityCorrect =
        typeof volatilityPercentile === "number" &&
        volatilityPercentile >= HIGH_VOLATILITY_THRESHOLD &&
        result.rank1 !== 1;

      const { date, venueCode, raceNumber } = parseRaceId(p.race_id);

      const candidate = {
        raceId: p.race_id,
        date,
        venue: VENUE_NAMES[venueCode] || `${venueCode}番`,
        raceNumber,
        actualRank1: result.rank1,
        winningTechnique: result.winning_technique,
        payoutWin: result.payout_win || 0,
        turnHit: Boolean(matchedPattern),
        matchedPattern: matchedPattern
          ? {
              technique: matchedPattern.technique,
              probability: matchedPattern.probability,
            }
          : null,
        volatilityPercentile: volatilityPercentile ?? null,
        volatilityCorrect,
        volatilityReasons: p.feature_contributions?.volatilityReasons || [],
      };
      candidate.score = scoreCandidate(candidate);
      return candidate;
    })
    .filter(Boolean)
    .filter((c) => c.turnHit || c.volatilityCorrect) // どちらも満たさないレースは動画のフックにならない
    .sort((a, b) => b.score - a.score);

  console.log(
    `\n直近${DAYS}日・候補 ${candidates.length}件中、スコア上位${TOP_N}件:\n`,
  );

  candidates.slice(0, TOP_N).forEach((c, i) => {
    const tags = [
      c.turnHit && c.volatilityCorrect ? "ダブル的中" : null,
      c.turnHit && !c.volatilityCorrect ? "展開予測的中" : null,
      !c.turnHit && c.volatilityCorrect ? "イン崩れ警告的中" : null,
      c.actualRank1 !== 1 ? "アップセット" : null,
    ].filter(Boolean);

    console.log(
      `${i + 1}. [score ${c.score}] ${c.raceId}（${c.venue}${c.raceNumber}R、${c.date}） ${tags.join("・")}`,
    );
    console.log(
      `   結果: ${c.actualRank1}号艇が${c.winningTechnique}で1着、払戻${c.payoutWin}円`,
    );
    if (c.matchedPattern) {
      console.log(
        `   展開予測: ${c.matchedPattern.technique}パターン（確率${Math.round(c.matchedPattern.probability * 100)}%）が的中`,
      );
    }
    if (c.volatilityPercentile !== null) {
      console.log(
        `   イン崩れ指数: ${Math.round(c.volatilityPercentile * 100)}%${c.volatilityCorrect ? "（警告的中）" : ""}`,
      );
      c.volatilityReasons.forEach((r) => console.log(`     - ${r}`));
    }
    console.log("");
  });

  console.log(
    "※ 採用前に必ずPlaywrightで実画面を確認すること（video-producer-prompt.mdステップ2）。\n" +
      "  展開予測は結果確定後もRaceResultコンポーネントで常時表示されるが、イン崩れ指数は\n" +
      "  結果確定後は非表示（BOA-209）のため、このスクリプトの出力値をテロップとして使う。",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
