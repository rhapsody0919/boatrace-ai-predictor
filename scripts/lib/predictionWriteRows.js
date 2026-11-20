// 予想の生成（scripts/daily/generate-predictions.js）が DB へ書く行の組み立て（races 以外の表の行・発走済みの判定・
// race_conditions のキーの組み合わせ）と、変更行だけを書く upsert の部品。generateRacePrediction の結果から行を作る純関数が中心。
// generate-predictions.js の writeToSupabase から字のまま移した（await は呼び元に残す）。
import { upsertChangedRows } from "./unchangedRows.js";

// 風向の度数（16方位）をテキストに変換
export function convertWindDirection(direction) {
  const directions16 = [
    null,
    "北",
    "北北東",
    "北東",
    "東北東",
    "東",
    "東南東",
    "南東",
    "南南東",
    "南",
    "南南西",
    "南西",
    "西南西",
    "西",
    "西北西",
    "北西",
    "北北西",
  ];
  if (direction == null || direction === 0 || direction < 0 || direction > 16) {
    return null;
  }
  return directions16[direction];
}

/** races への変更行だけの upsert（await は呼び元。問い合わせをそのまま返す） */
export function upsertRacesRows(client, racesData) {
  return upsertChangedRows(client, "races", racesData, {
    onConflict: "race_id",
    keyColumns: ["race_id"],
    ignoreColumns: ["updated_at"],
    label: "races",
  });
}

/** race_entries テーブルの1行（3モデルの AI スコアを艇番で突き合わせる） */
export function buildEntryRow(race, player) {
  const safeBetPlayer = race.predictions.safeBet.players.find(
    (p) => p.number === player.number,
  );
  const upsetPlayer = race.predictions.upsetFocus.players.find(
    (p) => p.number === player.number,
  );

  return {
    race_id: race.raceId,
    boat_number: player.number,
    racer_id: player.racerId,
    player_name: player.name,
    grade: player.grade,
    age: player.age,
    win_rate: parseFloat(player.winRate),
    local_win_rate: parseFloat(player.localWinRate),
    global_2rate: player.global2Rate ? parseFloat(player.global2Rate) : null,
    local_2rate: player.local2Rate ? parseFloat(player.local2Rate) : null,
    global_3rate: player.global3Rate ? parseFloat(player.global3Rate) : null,
    local_3rate: player.local3Rate ? parseFloat(player.local3Rate) : null,
    motor_number: player.motorNumber,
    motor_2rate: parseFloat(player.motor2Rate),
    motor_3rate: player.motor3Rate ? parseFloat(player.motor3Rate) : null,
    boat_number_id: player.boatNumber,
    boat_2rate: parseFloat(player.boat2Rate),
    boat_3rate: player.boat3Rate ? parseFloat(player.boat3Rate) : null,
    ai_score_standard: player.aiScore,
    ai_score_safe_bet: safeBetPlayer?.aiScore || 0,
    ai_score_upset_focus: upsetPlayer?.aiScore || 0,
    // F数・L数は、値が取れた艇だけに付ける（null を送ると既存の値を NULL で上書きする。行ごとに列がそろわない
    // 分は upsertChangedRows が既存の値で補う。BOA-590）
    ...(Number.isInteger(player.fCount) ? { f_count: player.fCount } : {}),
    ...(Number.isInteger(player.lCount) ? { l_count: player.lCount } : {}),
  };
}

/** race_entries テーブルの全行（レース順・standard の選手順） */
export function buildEntryRows(allPredictions) {
  const entriesData = [];
  for (const race of allPredictions) {
    for (const player of race.predictions.standard.players) {
      entriesData.push(buildEntryRow(race, player));
    }
  }
  return entriesData;
}

/** race_entries への変更行だけの upsert（await は呼び元。書く行には updated_at を設定する） */
export function upsertEntryRows(client, entriesData) {
  return upsertChangedRows(client, "race_entries", entriesData, {
    onConflict: "race_id,boat_number",
    keyColumns: ["race_id", "boat_number"],
    label: "race_entries",
    stampUpdatedAt: true,
    // F数・L数はマイグレーション081の列。未適用のDBでは、その列だけ除いて書く（BOA-590）
    optionalColumnGroups: {
      "マイグレーション081（F数・L数）": ["f_count", "l_count"],
    },
  });
}

/** exhibition_data テーブルの全行（展示タイムか展示STがある艇だけ） */
export function buildExhibitionRows(allPredictions) {
  const exhibitionRows = [];
  for (const race of allPredictions) {
    const raceId = race.raceId;
    // races.jsonのexhibitionDataは各ボートの展示データ
    // raceIdに対応するrace objectを探す
    // allPredictionsの元データから展示データを取得
    if (race.exhibitionData) {
      for (const ex of race.exhibitionData) {
        if (ex.exhibitionTime != null || ex.startTiming != null) {
          exhibitionRows.push({
            race_id: raceId,
            boat_number: ex.boatNumber,
            exhibition_time: ex.exhibitionTime,
            start_timing: ex.startTiming,
          });
        }
      }
    }
  }
  return exhibitionRows;
}

/** exhibition_data への変更行だけの upsert（await は呼び元） */
export function upsertExhibitionRows(client, exhibitionRows) {
  return upsertChangedRows(client, "exhibition_data", exhibitionRows, {
    onConflict: "race_id,boat_number",
    keyColumns: ["race_id", "boat_number"],
    label: "exhibition_data",
    stampUpdatedAt: true,
  });
}

/**
 * predictions テーブルの1レース分の行（standard・safeBet・upsetFocus の3行）。
 * feature_contributions（turnPrediction・racerStats）は standard/safeBet/upsetFocus の
 * 3モデルで内容が完全に同一（turnPrediction・racerStatsはモデルに依存しない値のため）。
 * フロントエンド（supabaseDataService.js）もstandard行のみを読むため、standard行にのみ
 * 書き、safeBet・upsetFocusはNULLにする（BOA-408、書き込み量を約2/3削減。
 * docs/design/scraping-vercel-consolidation/predictions-write-optimization.md 対策0）
 */
export function predictionRowsForRace(race) {
  const featureContrib =
    race.turnPrediction || race.racerStats
      ? {
          turnPrediction: race.turnPrediction || null,
          racerStats: race.racerStats || null,
        }
      : null;
  const { standard: std, safeBet: safe, upsetFocus: upset } = race.predictions;

  return [
    // Standard model (turnPredictionはstandard行に格納)
    {
      race_id: race.raceId,
      model_id: "standard",
      top_pick: std.topPick,
      top_2nd: std.top3[1] || null,
      top_3rd: std.top3[2] || null,
      confidence: std.confidence,
      is_shadow: false,
      feature_contributions: featureContrib,
    },
    // SafeBet model（feature_contributionsはstandard行と重複するためNULL。BOA-408）
    {
      race_id: race.raceId,
      model_id: "safeBet",
      top_pick: safe.topPick,
      top_2nd: safe.top3[1] || null,
      top_3rd: safe.top3[2] || null,
      confidence: safe.confidence,
      is_shadow: false,
      feature_contributions: null,
    },
    // UpsetFocus model（safeBetと同じ理由でNULL。BOA-408）
    {
      race_id: race.raceId,
      model_id: "upsetFocus",
      top_pick: upset.topPick,
      top_2nd: upset.top3[1] || null,
      top_3rd: upset.top3[2] || null,
      confidence: upset.confidence,
      is_shadow: false,
      feature_contributions: null,
    },
  ];
}

/** predictions テーブルの全行（レースごとに standard → safeBet → upsetFocus の順） */
export function buildPredictionRows(allPredictions) {
  return allPredictions.flatMap((race) => predictionRowsForRace(race));
}

/**
 * 発走済みのレースの race_id の集合（predictions を書かない対象。BOA-628）。
 * (race_id, model_id) で upsert する（BOA-628）。従来は is_shadow=false の全モデルを削除してから挿入しており、
 * 同じレースの unified（generate-unified-predictions.js が書く）まで消していた。
 * 発走済みのレースは書かない（的中フラグ・払戻を保つ。朝の初期化が遅れて昼に走った会場でも、発走後の
 * 作り直しをしない）。発走時刻が「未定」のレースは、判定できないので含めず（書く）
 */
export function findStartedRaceIds(allPredictions, date, now) {
  return new Set(
    allPredictions
      .filter(
        (r) =>
          r.startTime &&
          r.startTime !== "未定" &&
          new Date(`${date}T${r.startTime}:00+09:00`) <= now(),
      )
      .map((r) => r.raceId),
  );
}

/** race_conditions のうち、行ごとに有る・無いが変わりうる列（キーの組み合わせの署名に使う） */
export const CONDITION_OPTIONAL_KEYS = [
  "weather",
  "wind_direction",
  "wind_speed",
  "wave_height",
  "temperature",
  "water_temperature",
  "weather_observed_at",
  "race_title",
  "race_stage",
];

/** race_conditions に書く対象のレースか（天候・レース名・ステージのどれかがある） */
export function hasConditionsToWrite(race) {
  return (
    race.conditions?.weather ||
    race.conditions?.airTemp != null ||
    race.conditions?.raceTitle ||
    race.conditions?.raceStage
  );
}

/**
 * race_conditions の1行。値が無い側のキーは省く（シグネチャごとの別 upsert の前提）。
 * 4. race_conditionsテーブルにupsert（race_grade は races テーブルで管理）
 * series_day/is_final_dayはここでは取得しないためフィールド自体を含めない。
 * 以前は明示的にnullをセットしており、update-race-info.jsが同一サイクル内で
 * 書き込んだ値を直後に上書き消去するバグの原因だった（2026-09-16修正）
 *
 * race_title/race_stage はT4データ（前日〜当日朝1回取得すれば開催中は不変）のため、
 * 天候（T1、発走60分前ウィンドウでの取得が本来のタイミング）の有無に関わらず
 * このタイミングで書き込む（BOA-347）。以前はweather/airTempが無いとrace_title含め
 * 行自体が作られず、その日の唯一の取得機会であるupdate-race-info.jsの60分ウィンドウが
 * 何らかの理由（一時的な取得失敗・concurrency詰まり等）で失敗すると恒久的に欠損していた。
 *
 * 天候系フィールドと race_title/race_stage は、値が無い側をそれぞれ独立して
 * オブジェクトから省く（上のseries_day/is_final_dayと同じ理由）。ただしPostgRESTの
 * 一括upsertは「バッチ内のいずれかの行が持つキー」を列集合として扱い、そのキーを
 * 持たない行には明示的にNULLを書き込む（scrape-odds.jsの全通り系オッズと同じ制約、
 * 583行目付近のコメント参照）。そのため単純に行ごとにキーを省略しただけでは、
 * 同じバッチ内に天候ありの行が1件でもあれば天候無しの行がNULL上書きされてしまう。
 * 実際に含まれるキーの組み合わせ（シグネチャ）ごとにグループ化し、グループ単位で
 * 別々にupsertすることでこれを避ける
 */
export function buildConditionRow(race) {
  const row = { race_id: race.raceId };
  if (race.conditions?.weather || race.conditions?.airTemp != null) {
    row.weather = race.conditions.weather;
    row.wind_direction = convertWindDirection(race.conditions.windDirection);
    row.wind_speed = race.conditions.windVelocity;
    row.wave_height =
      race.conditions.waveHeight != null
        ? Math.round(race.conditions.waveHeight)
        : null;
    row.temperature = race.conditions.airTemp;
    row.water_temperature = race.conditions.waterTemp;
    // この経路の気象（scrape-to-json 由来）は観測時刻が分からない。展示取得・結果取得が
    // 書いた新しい観測時刻を残したまま、値だけ古くなって「10:34現在」と表示されるのを
    // 防ぐため、観測時刻は明示的にNULLにする（BOA-358）
    row.weather_observed_at = null;
  }
  if (race.conditions?.raceTitle) {
    row.race_title = race.conditions.raceTitle;
  }
  if (race.conditions?.raceStage) {
    row.race_stage = race.conditions.raceStage;
  }
  return row;
}

/** race_conditions の行を、実際に含むキーの組み合わせ（シグネチャ）ごとにグループ化する */
export function groupConditionRowsBySignature(conditionsData) {
  const conditionsGroupBySignature = new Map();
  for (const row of conditionsData) {
    const signature = CONDITION_OPTIONAL_KEYS.filter((k) => k in row).join(",");
    if (!conditionsGroupBySignature.has(signature)) {
      conditionsGroupBySignature.set(signature, []);
    }
    conditionsGroupBySignature.get(signature).push(row);
  }
  return conditionsGroupBySignature;
}

/**
 * predictions を (race_id, model_id) の一意制約で upsert する（writeMode="upsert"）。
 * 削除を伴わないため、書き込みの途中で失敗しても、書けなかった行は以前の予測が残る。
 * 行の内容は「削除→挿入」と同じにする（挿入では、下の列が DEFAULT/NULL になっていた）:
 * 的中フラグ・払戻・scores は null に戻し、predicted_at は現在時刻にする。
 */
export async function upsertPredictions(client, predictionsData, at) {
  const rows = predictionsData.map((row) => ({
    ...row,
    scores: null,
    is_hit_win: null,
    is_hit_place: null,
    is_hit_trifecta: null,
    is_hit_trio: null,
    is_hit_turn: null,
    payout_win: null,
    payout_place: null,
    payout_trifecta: null,
    payout_trio: null,
    predicted_at: at.toISOString(),
  }));
  for (let i = 0; i < rows.length; i += 1000) {
    const batch = rows.slice(i, i + 1000);
    const { error } = await client
      .from("predictions")
      .upsert(batch, { onConflict: "race_id,model_id" });
    if (error) throw new Error(`predictions書き込みエラー: ${error.message}`);
  }
}
