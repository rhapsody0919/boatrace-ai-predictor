/**
 * RaceReview - データで振り返る（BOA-168）
 * レース結果確定後、全6艇についてboatAIの分析データと着順を機械的に照合する
 * 「指標レベルの深掘り」を担う。的中/不的中の一次判定（複勝的中・展開予測的中）は
 * RaceResult.jsx（レース結果パネル）が担当するため、ここでは繰り返さない
 * （2026-08-14: 同じ判定を2箇所に重複表示していたのを整理・統合）。
 * - 全艇の照合サマリー: 全指標×全艇の○×一覧テーブル
 * - 全艇の言語化: 1〜3着（好走）・着外の各艇について「整合した点/違った点」を列挙
 * 判定は全てレース内順位・一致判定のみ（指標定義はraceIndicators.jsxで
 * データ出走表と共通化）。4〜6着の個別着順はDBに未保存のため「着外」で扱う。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRaceAnalysisData } from "../../hooks/useRaceAnalysisData";
import { getRaceId } from "../../utils/raceId";
import { buildIndicatorRows, TECHNIQUE_KEY_BY_NAME } from "./raceIndicators";
import "./RaceReview.css";

// 指標の示唆（strong/weak）と着順（好走/着外）の組み合わせ → ○×−
const markFor = (signal, good) => {
  if (signal === "strong") return good ? "match" : "mismatch";
  if (signal === "weak") return good ? "mismatch" : "match";
  return "none";
};

const MARK = { match: "○", mismatch: "×", none: "−" };

function RaceReview({ prediction, selectedRace }) {
  const { t } = useTranslation();
  const raceId = getRaceId(selectedRace);
  const finished = Boolean(prediction?.result?.finished);
  const analysis = useRaceAnalysisData(finished ? raceId : null, {
    includeResult: true,
  });
  const { techniqueProfile, resultSummary, loading } = analysis;

  // 着外艇の言語化ブロックはモバイルではデフォルト折りたたみ（縦長対策）。
  // デスクトップ（768px以上）はデフォルト展開
  const [showOutBoats, setShowOutBoats] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 768,
  );

  if (!finished || !raceId) return null;

  const winner = resultSummary?.rank1 ?? prediction.result.rank1;
  if (!winner) return null;

  const winningTechnique =
    resultSummary?.winning_technique ??
    prediction.result.winningTechnique ??
    null;

  const players = [...(prediction.allPlayers ?? [])].sort(
    (a, b) => a.number - b.number,
  );
  const boatName = (boat) =>
    players.find((p) => p.number === boat)?.name?.replace(/\s+/g, "") ?? "";
  const playerOf = (boat) => players.find((p) => p.number === boat);

  const translateTechnique = (name) => {
    const key = TECHNIQUE_KEY_BY_NAME[name];
    return key ? t(`techniques.${key}`, name) : name;
  };

  // 着順順の艇リスト（1〜3着 + 着外を枠番順）
  const rank2 = resultSummary?.rank2 ?? prediction.result.rank2 ?? null;
  const rank3 = resultSummary?.rank3 ?? prediction.result.rank3 ?? null;
  const topFinishers = [winner, rank2, rank3].filter((b) => b !== null);
  const outBoats = players
    .map((p) => p.number)
    .filter((b) => !topFinishers.includes(b));
  const orderedBoats = [
    ...topFinishers.map((b, i) => ({ boat: b, position: i + 1 })),
    ...outBoats.map((b) => ({ boat: b, position: null })),
  ];

  // 指標定義（データ出走表と共通）。決まり手型は勝者専用の特別判定
  const rows = buildIndicatorRows({
    t,
    players,
    analysis,
    pending: analysis.pending,
  });
  // technique/placeRecommendationは常時null signalのため一覧比較の対象外
  // （placeRecommendationは上位2着基準の的中判定が未実装、review.jsxのgoodは上位3着基準のため流用不可）
  const judgeableRows = rows.filter(
    (row) => !["technique", "placeRecommendation"].includes(row.key),
  );

  // 各艇の言語化: 整合/相違の事実文リスト
  const itemsFor = (boat, good) => {
    const matches = [];
    const mismatches = [];
    judgeableRows.forEach((row) => {
      const signal = row.signal(boat);
      if (!signal) return;
      const text = row.itemText?.(boat);
      if (!text) return;
      const mark = markFor(signal, good);
      if (mark === "match") matches.push({ key: row.key, text });
      else if (mark === "mismatch") mismatches.push({ key: row.key, text });
    });
    return { matches, mismatches };
  };

  // 勝者の決まり手×勝ちパターン照合（特別判定）
  const winnerTechniqueItem = (() => {
    const winnerTech = (techniqueProfile ?? []).find(
      (r) => r.boat_number === winner,
    );
    if (!winnerTech) return null;
    if (!winnerTech.win_count) {
      return { type: "mismatch", text: t("review.itemTechniqueNoWins") };
    }
    if (!winningTechnique) return null;
    const idx = winnerTech.techniques.findIndex(
      (tech) => tech.technique === winningTechnique,
    );
    if (idx === 0) {
      return {
        type: "match",
        text: t("review.itemTechniqueTop", {
          technique: translateTechnique(winningTechnique),
          pct: winnerTech.techniques[0].percentage.toFixed(0),
        }),
      };
    }
    if (idx === -1) {
      return {
        type: "mismatch",
        text: t("review.itemTechniqueNone", {
          technique: translateTechnique(winningTechnique),
        }),
      };
    }
    // 勝ちパターン2位以下での勝利: 実績はあるため整合側に順位付きで表示
    return {
      type: "match",
      text: t("review.itemTechniqueRank", {
        technique: translateTechnique(winningTechnique),
        rank: idx + 1,
        pct: winnerTech.techniques[idx].percentage.toFixed(0),
      }),
    };
  })();

  return (
    <div className="race-review">
      <h3 className="race-review-title">🔍 {t("review.title")}</h3>
      <p className="race-review-result">
        {t("review.resultLine", { number: winner, name: boatName(winner) })}
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
          {/* 全艇の照合サマリー（全指標×全艇の○×一覧） */}
          <div className="race-review-all">
            <h4>📋 {t("review.allBoatsHeading")}</h4>
            <div className="race-review-all-wrapper">
              <table className="race-review-all-table">
                <thead>
                  <tr>
                    <th>{t("review.colFinish")}</th>
                    <th>{t("review.colBoat")}</th>
                    <th>{t("review.colGrade")}</th>
                    {judgeableRows.map((row) => (
                      <th key={row.key}>{t(`review.cols.${row.key}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orderedBoats.map(({ boat, position }) => {
                    const good = position !== null;
                    return (
                      <tr key={boat}>
                        <td className="race-review-finish">
                          {position !== null
                            ? t("review.finishPosition", { position })
                            : t("review.finishOut")}
                        </td>
                        <td className="race-review-boat" translate="no">
                          {boat} {boatName(boat)}
                        </td>
                        <td
                          className={`race-review-grade ${playerOf(boat)?.grade === "A1" ? "race-review-grade-a1" : ""}`}
                        >
                          {playerOf(boat)?.grade ?? "—"}
                        </td>
                        {judgeableRows.map((row) => {
                          const mark = markFor(row.signal(boat), good);
                          return (
                            <td
                              key={row.key}
                              className={`race-review-mark-${mark}`}
                            >
                              {MARK[mark]}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="race-review-legend">{t("review.allBoatsLegend")}</p>
          </div>

          {/* 全艇の言語化（1〜3着 + 着外の各艇）。着外はトグルで折りたたみ可能 */}
          <div className="race-review-boats">
            {orderedBoats
              .filter(({ position }) => showOutBoats || position !== null)
              .map(({ boat, position }) => {
                const good = position !== null;
                const { matches, mismatches } = itemsFor(boat, good);
                if (boat === winner && winnerTechniqueItem) {
                  if (winnerTechniqueItem.type === "match")
                    matches.push({
                      key: "technique",
                      text: winnerTechniqueItem.text,
                    });
                  else
                    mismatches.push({
                      key: "technique",
                      text: winnerTechniqueItem.text,
                    });
                }
                const player = playerOf(boat);
                return (
                  <div
                    key={boat}
                    className={`race-review-boat-block ${boat === winner ? "race-review-boat-winner" : ""}`}
                  >
                    <h4 className="race-review-boat-heading">
                      <span
                        className={`race-review-finish-badge ${position !== null ? `race-review-finish-${position}` : ""}`}
                      >
                        {position !== null
                          ? t("review.finishPosition", { position })
                          : t("review.finishOut")}
                      </span>
                      {boat}.{" "}
                      <span translate="no">
                        {player?.name?.replace(/\s+/g, "") ?? ""}
                      </span>
                      {player?.grade && (
                        <span
                          className={`race-review-grade-badge ${player.grade === "A1" ? "race-review-grade-a1" : ""}`}
                        >
                          {player.grade}
                        </span>
                      )}
                    </h4>
                    {matches.length === 0 && mismatches.length === 0 ? (
                      <p className="race-review-no-items">
                        {t("review.noItems")}
                      </p>
                    ) : (
                      <>
                        {matches.length > 0 && (
                          <div className="race-review-group race-review-match">
                            <h5>✅ {t("review.matchHeading")}</h5>
                            <ul>
                              {matches.map((item) => (
                                <li key={item.key}>{item.text}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {mismatches.length > 0 && (
                          <div className="race-review-group race-review-mismatch">
                            <h5>⚠️ {t("review.mismatchHeading")}</h5>
                            <ul>
                              {mismatches.map((item) => (
                                <li key={item.key}>{item.text}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
          </div>

          {outBoats.length > 0 && (
            <button
              type="button"
              className="race-review-out-toggle"
              onClick={() => setShowOutBoats((prev) => !prev)}
            >
              {showOutBoats
                ? t("review.hideOutBoats")
                : t("review.showOutBoats", { n: outBoats.length })}
            </button>
          )}

          <p className="race-review-note">💡 {t("review.note")}</p>
        </>
      )}
    </div>
  );
}

export default RaceReview;
