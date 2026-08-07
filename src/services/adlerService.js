/**
 * アドラー予想 データ取得・推論サービス
 *
 * シャーロック予想の勝率計算（sherlockService、ブラウザ内リアルタイム推論）を
 * そのまま土台にし、各レースの勝率を位置別温度付き Plackett-Luce（adlerModel.js）で
 * 2連単・3連単・3連複の順列確率に展開する。
 * 温度パラメータは data/adler/model.json（週次再学習でコミット）から読む。
 */

import { getSherlockPredictions } from "./sherlockService";
import { rankPermutations } from "./adlerModel";
import model from "../../data/adler/model.json";

/** モデルのメタ情報（フィット値・学習日・検証指標など）を返す */
export function getAdlerModelInfo() {
  return {
    trainedAt: model.trained_at,
    baseModelTrainedAt: model.base_model_trained_at,
    gamma: model.gamma,
    delta: model.delta,
    nRaces: model.n_races,
    fitFrom: model.fit_from,
    fitTo: model.fit_to,
    eval: model.eval,
  };
}

/**
 * 指定日の全レースについてアドラー予想（順列確率）を計算する
 * @returns {Promise<Array>} シャーロックのレース予測に permutations を付与したもの
 */
export async function getAdlerPredictions(date) {
  const races = await getSherlockPredictions(date);
  return races.map((race) => ({
    ...race,
    permutations: rankPermutations(
      race.boats.map((b) => b.prob),
      { gamma: model.gamma, delta: model.delta },
    ),
  }));
}
