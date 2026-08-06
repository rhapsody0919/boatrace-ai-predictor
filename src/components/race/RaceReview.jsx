/**
 * RaceReview - データで振り返る（BOA-168）
 * レース結果確定後、勝った艇についてboatAIの分析データを機械的に照合し、
 * 「データと整合した点」「データと違った点」に分類して表示する。
 * AIの本命の当否も誠実に検証する（外れた場合は勝者を示唆していたデータを提示）。
 * 判定は全てレース内順位・一致判定のみで、恣意的な閾値・文章生成は使わない。
 */
import { useTranslation } from "react-i18next";
import { TECHNIQUE_NAMES } from "../../utils/turnPrediction";
import { useRaceAnalysisData } from "../../hooks/useRaceAnalysisData";
import { getRaceId } from "../../utils/raceId";
import "./RaceReview.css";

const TECHNIQUE_KEY_BY_NAME = Object.fromEntries(
  Object.entries(TECHNIQUE_NAMES).map(([key, name]) => [name, key]),
);

// rows内でaccessor値のレース内順位（1始まり）を返す。dir="max"なら大きいほど上位。
// 同値タイは同順位（competition ranking: 自分より真に良い値の数+1）として扱う
function rankInRace(rows, boat, accessor, dir = "max") {
  const values = (rows ?? [])
    .map((row) => ({ boat: row.boat_number, value: accessor(row) }))
    .filter((c) => c.value !== null && c.value !== undefined);
  const target = values.find((c) => c.boat === boat);
  if (!target) return null;
  const better = values.filter((c) =>
    dir === "min" ? c.value < target.value : c.value > target.value,
  ).length;
  return better + 1;
}

function RaceReview({ prediction, selectedRace }) {
  const { t } = useTranslation();
  const raceId = getRaceId(selectedRace);
  const finished = Boolean(prediction?.result?.finished);
  const {
    motor,
    racerForm,
    exhibitionTime,
    techniqueProfile,
    returnRate,
    resultSummary,
    loading,
  } = useRaceAnalysisData(finished ? raceId : null, { includeResult: true });

  if (!finished || !raceId) return null;

  const winner = resultSummary?.rank1 ?? prediction.result.rank1;
  if (!winner) return null;

  const winningTechnique =
    resultSummary?.winning_technique ??
    prediction.result.winningTechnique ??
    null;

  const winnerPlayer = prediction.allPlayers?.find((p) => p.number === winner);
  const winnerName = winnerPlayer?.name?.replace(/\s+/g, "") ?? "";

  const translateTechnique = (name) => {
    const key = TECHNIQUE_KEY_BY_NAME[name];
    return key ? t(`techniques.${key}`, name) : name;
  };

  // --- 機械的照合 ---
  const matches = [];
  const mismatches = [];

  // 1. 決まり手 vs 勝者の勝ちパターン
  const winnerTech = (techniqueProfile ?? []).find(
    (r) => r.boat_number === winner,
  );
  if (winnerTech) {
    if (!winnerTech.win_count) {
      mismatches.push({
        key: "techniqueNoWins",
        text: t("review.itemTechniqueNoWins"),
      });
    } else if (winningTechnique) {
      const idx = winnerTech.techniques.findIndex(
        (tech) => tech.technique === winningTechnique,
      );
      if (idx === 0) {
        matches.push({
          key: "techniqueTop",
          text: t("review.itemTechniqueTop", {
            technique: translateTechnique(winningTechnique),
            pct: winnerTech.techniques[0].percentage.toFixed(0),
          }),
        });
      } else if (idx === -1) {
        mismatches.push({
          key: "techniqueNone",
          text: t("review.itemTechniqueNone", {
            technique: translateTechnique(winningTechnique),
          }),
        });
      }
      // リスト内2位以下は中立として表示しない
    }
  }

  // 2. モーター2連率のレース内順位
  const motorRank = rankInRace(motor, winner, (r) => r.motor_2rate);
  if (motorRank !== null) {
    if (motorRank <= 2) {
      matches.push({
        key: "motorHigh",
        text: t("review.itemMotorHigh", { rank: motorRank }),
      });
    } else if (motorRank >= 5) {
      mismatches.push({
        key: "motorLow",
        text: t("review.itemMotorLow", { rank: motorRank }),
      });
    }
  }

  // 3. 勝率Δ（調子）
  const winnerForm = (racerForm ?? []).find((r) => r.boat_number === winner);
  if (winnerForm && winnerForm.delta !== null) {
    if (winnerForm.delta > 0) {
      matches.push({
        key: "formUp",
        text: t("review.itemFormUp", { delta: winnerForm.delta.toFixed(2) }),
      });
    } else if (winnerForm.delta < 0) {
      mismatches.push({
        key: "formDown",
        text: t("review.itemFormDown", {
          delta: Math.abs(winnerForm.delta).toFixed(2),
        }),
      });
    }
  }

  // 4. 当日展示タイムのレース内順位（速いほど上位）
  const exRank = rankInRace(
    exhibitionTime,
    winner,
    (r) => r.exhibition_time,
    "min",
  );
  if (exRank !== null) {
    if (exRank <= 2) {
      matches.push({
        key: "exFast",
        text: t("review.itemExhibitionFast", { rank: exRank }),
      });
    } else if (exRank >= 5) {
      mismatches.push({
        key: "exSlow",
        text: t("review.itemExhibitionSlow", { rank: exRank }),
      });
    }
  }

  // 5. 単勝回収率100%以上（客観基準のため参考として整合側のみ）
  const winnerRate = (returnRate ?? []).find((r) => r.boat_number === winner);
  if (winnerRate?.sample_count > 0 && winnerRate.win_return_rate >= 100) {
    matches.push({
      key: "returnHigh",
      text: t("review.itemReturnHigh", {
        rate: winnerRate.win_return_rate.toFixed(0),
      }),
    });
  }

  // --- AI検証 ---
  const aiPick = prediction.topPick?.number ?? null;
  const aiHit = aiPick !== null && aiPick === winner;

  return (
    <div className="race-review">
      <h3 className="race-review-title">🔍 {t("review.title")}</h3>
      <p className="race-review-result">
        {t("review.resultLine", { number: winner, name: winnerName })}
        {winningTechnique && (
          <span className="race-review-technique">
            {t("review.techniqueLabel", {
              technique: translateTechnique(winningTechnique),
            })}
          </span>
        )}
      </p>

      {loading && <p className="race-review-loading">{t("review.loading")}</p>}

      {!loading && (
        <>
          {matches.length > 0 && (
            <div className="race-review-group race-review-match">
              <h4>✅ {t("review.matchHeading")}</h4>
              <ul>
                {matches.map((item) => (
                  <li key={item.key}>{item.text}</li>
                ))}
              </ul>
            </div>
          )}

          {mismatches.length > 0 && (
            <div className="race-review-group race-review-mismatch">
              <h4>⚠️ {t("review.mismatchHeading")}</h4>
              <ul>
                {mismatches.map((item) => (
                  <li key={item.key}>{item.text}</li>
                ))}
              </ul>
            </div>
          )}

          {aiPick !== null && (
            <div className="race-review-ai">
              <h4>🤖 {t("review.aiHeading")}</h4>
              <p>
                {aiHit
                  ? t("review.aiHit", { number: aiPick })
                  : matches.length > 0
                    ? t("review.aiMissWithData", {
                        aiNumber: aiPick,
                        winnerNumber: winner,
                      })
                    : t("review.aiMissNoData", {
                        aiNumber: aiPick,
                        winnerNumber: winner,
                      })}
              </p>
            </div>
          )}

          <p className="race-review-note">💡 {t("review.note")}</p>
        </>
      )}
    </div>
  );
}

export default RaceReview;
