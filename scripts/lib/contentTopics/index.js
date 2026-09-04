/**
 * ネタ供給モジュールのレジストリ。
 * 新規系統を追加する時は、この配列に1行足すだけでよい
 * （各モジュールの内部ロジックには一切触れない）。
 */

import * as newFeatureSource from "./newFeatureSource.js";
import * as venueCharacteristicSource from "./venueCharacteristicSource.js";
import * as dataInsightSource from "./dataInsightSource.js";
import * as dailyResultSource from "./dailyResultSource.js";

export const topicSources = [
  newFeatureSource,
  venueCharacteristicSource,
  dataInsightSource,
  dailyResultSource,
];

// 全ソースを回して候補を集める。1つのソースが例外を投げても他を止めない
export async function collectAllCandidates() {
  const results = await Promise.allSettled(
    topicSources.map((source) => source.getCandidates()),
  );

  const candidatesBySource = {};
  const errors = [];
  results.forEach((result, i) => {
    const sourceId = topicSources[i].id;
    if (result.status === "fulfilled") {
      candidatesBySource[sourceId] = result.value;
    } else {
      candidatesBySource[sourceId] = [];
      errors.push({
        sourceId,
        error: result.reason?.message ?? String(result.reason),
      });
    }
  });

  return { candidatesBySource, errors };
}
