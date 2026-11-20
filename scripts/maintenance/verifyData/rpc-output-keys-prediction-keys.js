// verify-rpc-output-keys.js から字のまま移した、get_predictions_by_date / _light の期待キーの表（レース直下と入れ子）。
// get_predictions_by_date / _light のレース要素が持つべきキー
export const PREDICTION_RACE_KEYS = [
  "raceId",
  "venueCode",
  "raceNumber",
  "startTime",
  "raceGrade",
  "raceTitle",
  "seriesDay", // 038
  "isFinalDay", // 038
  "raceStage", // 062
  "weather", // 066
  "cancellationStatus", // 048（BOA-363で回帰）
];

// get_predictions_by_date / _light の入れ子要素が持つべきキー。同じ回帰が入れ子のフィールド
// （037のracerId、051のresultの着順・払戻等）にも起こりうるため、レース直下と同様に検査する。
// 値が null の入れ子（結果未確定のresult、中止レースのentries等）は検査対象から外れる
export const PREDICTION_NESTED_CHECKS = [
  {
    path: "entries",
    keys: [
      "number",
      "name",
      "racerId", // 037
      "grade",
      "age",
      "winRate",
      "localWinRate",
      "global2Rate",
      "motorNumber",
      "motor2Rate",
      "boatNumber",
      "boat2Rate",
      "aiScoreStandard",
      "aiScoreSafeBet",
      "aiScoreUpsetFocus",
    ],
  },
  {
    // 066（気象6項目）と070（観測時刻 observedAt）。weather が null のレース（気象未取得）は対象外。
    // 値が null でもキーは出力される（観測時刻不明の行は observedAt: null）
    path: "weather",
    keys: [
      "weather",
      "windDirection",
      "windSpeed",
      "waveHeight",
      "temperature",
      "waterTemperature",
      "observedAt", // 070（BOA-358。069の列 race_conditions.weather_observed_at）
    ],
  },
  {
    path: "exhibitionData", // 008
    keys: ["boatNumber", "exhibitionTime", "startTiming"],
  },
  {
    path: "predictionOdds", // 011・019
    keys: [
      "trifectaPredStandard",
      "trifectaOddsStandard",
      "trioPredStandard",
      "trioOddsStandard",
      "trifectaPredSafeBet",
      "trifectaOddsSafeBet",
      "trioPredSafeBet",
      "trioOddsSafeBet",
      "trifectaPredUpsetFocus",
      "trifectaOddsUpsetFocus",
      "trioPredUpsetFocus",
      "trioOddsUpsetFocus",
    ],
  },
  {
    path: "result", // 051（全着順・払戻・人気）
    keys: [
      "finished",
      "isCancelled",
      "isNoRace",
      "rank1",
      "rank2",
      "rank3",
      "rank4",
      "rank5",
      "rank6",
      "raceTime1",
      "raceTime2",
      "raceTime3",
      "raceTime4",
      "raceTime5",
      "raceTime6",
      "winningTechnique",
      "payoutWin",
      "payoutPlace1",
      "payoutPlace2",
      "payoutTrifecta",
      "payoutTrio",
      "payoutExacta",
      "payoutQuinella",
      "payoutWide1",
      "payoutWide2",
      "payoutWide3",
      "popularityTrifecta",
      "popularityTrio",
      "popularityExacta",
      "popularityQuinella",
      "popularityWide1",
      "popularityWide2",
      "popularityWide3",
      // 109（BOA-543）のキーは下の MIGRATION_109_RESULT_KEYS（適用状況で扱いを変える）
    ],
  },
];
