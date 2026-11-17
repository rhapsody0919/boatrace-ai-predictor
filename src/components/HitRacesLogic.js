import { STADIUM_NAMES } from "../constants";
import { TURN_JUDGEMENT, judgeTurnPrediction } from "../utils/raceOutcome";
import { pickHitPattern } from "../utils/turnPrediction";

/**
 * 予測データから展開予測的中レースを抽出する（BOA-174、unified一本化）
 * unifiedモデルはレース単位で二値的中判定できるのが複勝的中・展開予測的中の
 * 2種類のみ（BOA-173）。本ページは「1マーク展開の予想パターンが実際の1着
 * コースと一致したか」の展開予測的中のみを扱う（複勝的中は対象外、spec.md方針）。
 */
export function extractHitRaces(predictions) {
  // 的中の判定は RaceCard・TurnPatternList と同じ関数を通す（不成立は判定対象外。BOA-543）
  return predictions
    .map((race) => {
      const patterns = race.unified?.turnPrediction?.patterns;
      const judgement = race.result?.finished
        ? judgeTurnPrediction(patterns, race.result)
        : null;
      return { race, patterns, judgement };
    })
    .filter(({ judgement }) => judgement?.status === TURN_JUDGEMENT.HIT)
    .map(({ race, patterns, judgement }) => {
      const { winner } = judgement;
      // 1着の艇の、確率が一番高い候補（AI予想タブのその艇の行と同じ。BOA-724）
      const matchedPattern = pickHitPattern(patterns, winner);

      const parts = race.raceId.split("-");
      const date = `${parts[0]}-${parts[1]}-${parts[2]}`;
      const placeCode = parts[3];
      const raceNo = parts[4];

      return {
        raceId: race.raceId,
        venue: STADIUM_NAMES[parseInt(placeCode)] || `${placeCode}番`,
        raceNumber: parseInt(raceNo),
        date,
        placeCode: parseInt(placeCode),
        // 1着の艇番。実際に入ったコースは表示中のカードだけ別に引く（winnerCourses）
        winnerBoat: winner,
        matchedPattern,
        // 当たった候補が1番手（本命）か。2番手以下なら共有文で「予想通り」と言わない（BOA-724）
        isTopPick: matchedPattern != null && matchedPattern === patterns[0],
        // 当たった艇が上位候補の何番手か（艇単位。AI予想タブの🥇🥈🥉と同じ数え方）。
        // 本命の63%も3番手の5%も同じ「展開予測的中」に見えた（BOA-724 ファン評価2周目）
        pickRank:
          [...new Set(patterns.map((p) => p.winnerCourse))].indexOf(winner) + 1,
        result: race.result,
      };
    })
    .sort(
      (a, b) =>
        (b.matchedPattern?.probability || 0) -
        (a.matchedPattern?.probability || 0),
    );
}

// 選択中の期間の的中レース
export function selectPeriodRaces(period, today, yesterday, all) {
  if (period === "today") return today;
  if (period === "yesterday") return yesterday;
  return all;
}

// ボートレース場別の統計を計算
export function buildVenueStats(hitRaces) {
  const stats = {};
  hitRaces.forEach((race) => {
    const venue = race.venue;
    if (!stats[venue]) {
      stats[venue] = { venue, hitCount: 0 };
    }
    stats[venue].hitCount++;
  });

  return Object.values(stats).sort((a, b) => b.hitCount - a.hitCount);
}

// 折りたたみ時の表示件数（全期間だけ12、他は8）
export function getMaxDisplay(period) {
  return period === "all" ? 12 : 8;
}

export function sliceDisplayRaces(period, currentHitRaces, isShowingAll) {
  return isShowingAll
    ? currentHitRaces
    : currentHitRaces.slice(0, getMaxDisplay(period));
}

export function cardVariant(period, hitRace, todayStr) {
  if (period === "all")
    return hitRace.date === todayStr ? "today" : "yesterday";
  return period;
}
