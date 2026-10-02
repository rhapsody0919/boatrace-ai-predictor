/**
 * RaceAiPredictionTab - 「AI予想」独立タブ（BOA-346）
 *
 * 日和には無い龍神レーダー独自のAI予想機能を、既存の折りたたみ表示
 * （旧AiAnalysisSection、BOA-168）から独立タブへ格上げしたもの。
 * - 未確定レース: 展開予測カード（TurnPatternList）/イン崩れ指数バッジ
 *   （VolatilityDisplay）/出現パターン（OutcomePatternPreview）の3ブロックを表示
 * - 確定済みレース: 旧RaceResult.jsxが持っていた「答え合わせ」ロジック
 *   （イン崩れ指数の的中/不的中判定、展開予測の実測精度）をそのまま移設して表示
 *
 * 旧AiAnalysisSectionは「折りたたみ」であることに価値があったが、独立タブへの
 * 昇格によりタブ選択自体が開閉の役割を兼ねるため、アコーディオンの重複UIは
 * 廃止した（本命サマリー表示もOutcomePatternPreview内で艇番が分かるため省略）。
 *
 * アナロジー・ファインダー節（BOA-271）は、予想（predictions）の有無と切り離して、中止以外の
 * すべての分岐（確定後・予想なし・未確定）で既存ブロックの下に出す。既存ブロックの早期 return に
 * 巻き込まれないよう、既存の表示は PredictionBlocks に分け、節はその外に置く。
 * BOA-635 も同じ場所（PredictionBlocks の外）に部品を置く前提なので、この形を変えるときは知らせる。
 */
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import VolatilityDisplay from "./VolatilityDisplay";
import TurnPatternList from "./TurnPatternList";
import PredictionCard from "./PredictionCard";
import OutcomePatternPreview from "./OutcomePatternPreview";
import { getVolatilityLevel } from "../../utils/volatilityLevel";
import { isJudgeable } from "../../utils/raceOutcome";
import VolatilityPercentileBar from "./VolatilityPercentileBar";
import { dataService } from "../../services/dataService";
import AnalogyFinderSection from "./analogy/AnalogyFinderSection";
import { isAnalogyFinderEnabled } from "../../config/featureFlags";

function RaceAiPredictionTab({
  prediction,
  venueCode,
  venueName,
  raceId,
  raceGrade = null,
  raceStage = null,
  isCancelled = false,
}) {
  const { t } = useTranslation();

  // 中止確定のレースは開催されないので、展開予測・イン崩れ指数を出さない（BOA-424）。
  // predictions は中止前に作られて残っていることがある（BOA-411）ため、データの有無では判定しない。
  // タブ自体は残し、他タブの空状態と同じ形で案内する
  if (isCancelled) {
    return (
      <div className="race-tabs-empty" data-testid="ai-prediction-cancelled">
        <p>{t("aiPredictionTab.cancelled")}</p>
      </div>
    );
  }

  return (
    <>
      <PredictionBlocks
        prediction={prediction}
        venueCode={venueCode}
        venueName={venueName}
        raceId={raceId}
      />
      {/* 公開までは機能フラグで隠す（隠している間は描かないので API も呼ばない。src/config/featureFlags.js） */}
      {isAnalogyFinderEnabled() && (
        <AnalogyFinderSection
          key={raceId}
          venueCode={venueCode}
          venueName={venueName}
          raceGrade={raceGrade}
          raceStage={raceStage}
        />
      )}
    </>
  );
}

function PredictionBlocks({ prediction, venueCode, venueName, raceId }) {
  const { t } = useTranslation();
  const result = prediction?.result;
  const finished = Boolean(result?.finished);

  // 1着の艇が実際に入ったコース（BOA-708）。的中は艇番で判定するが、前付けで艇番と
  // コースが違ったレースでは「逆に見える」ので、注記で添える。当日は entry_course で補い、
  // それも無ければ出さない（取得に失敗しても注記を出さないだけで、判定の表示は止めない）
  const [winner, setWinner] = useState({
    raceId: null,
    boat: null,
    course: null,
  });
  useEffect(() => {
    if (!finished || !raceId) return undefined;
    let cancelled = false;
    dataService
      .getRaceWinnerCourses([raceId])
      .then((byRace) => {
        const w = byRace[raceId];
        if (!cancelled && w) setWinner({ raceId, ...w });
      })
      .catch((error) => {
        console.error(
          "1着艇の進入コースの取得に失敗（注記を出さない）:",
          error,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [finished, raceId]);
  const showWinnerCourse =
    winner.raceId === raceId &&
    winner.course != null &&
    winner.boat != null &&
    winner.course !== winner.boat;

  const turnPatterns = prediction?.turnPrediction?.patterns;
  const hasTurnPrediction =
    Array.isArray(turnPatterns) && turnPatterns.length > 0;

  if (finished) {
    // イン崩れ指数は確率的な傾向予測のため二値的中判定は行わない（下記コメント参照）。
    // 予測レベルと実際の結果を判定なしで併記するのみに留める
    const volatilityLevel = prediction.volatilityPercentileIsFallback
      ? null
      : getVolatilityLevel(prediction.volatilityPercentile);
    const showVolatilityOutcome =
      volatilityLevel === "high" || volatilityLevel === "low";
    // 不成立のレースは1着が決まっていないので、振り返りも「判定対象外」にする（BOA-543）
    const canJudge = isJudgeable(result);
    const isUpset = result.rank1 !== 1;

    if (!showVolatilityOutcome && !hasTurnPrediction) {
      return (
        <div className="race-tabs-empty">
          <p>{t("aiPredictionTab.unavailableTitle")}</p>
        </div>
      );
    }

    return (
      <div className="race-ai-prediction-tab">
        {/* イン崩れ指数は「このレースは荒れやすい/堅い」という確率的な傾向予測であり、
            複勝予想・展開予測のような単発レースの二値的中判定にはなじまない
            （1レースが堅く決まっても「高リスク」判定が誤りだったとは言えない）。
            2026-08-14: 従来ここに表示していた単発レースの的中/不的中判定を削除。
            精度検証は集計ベース（BOA-177、着手待ち）に委ねる方針で統一した。
            2026-08-29: 判定なしの事実併記(予測レベル→実際の結果)を追加。
            2026-08-30: 分かりにくいとの指摘を受け、予測・結果を同じ語彙（堅い⇄崩れやすい）で
            並べ対応関係を明確化。パーセンタイル数値も併記（数値を隠す方がむしろ「高い/低い」
            の2値ラベルだけを見て的中/不的中と誤読されやすいとの判断、天気予報の降水確率と同じ
            考え方）。単発レースの正誤は判断できない旨の注記と精度分析ページへの導線を追加
            （2026-09-16、BOA-346でRaceResult.jsxから本タブへ移設） */}
        {showVolatilityOutcome && (
          <div className="result-verify-section">
            <h5 className="result-verify-title">
              {t("result.volatilitySectionTitle")}
            </h5>
            {/* 指数はレース前と同じ 0〜100 のバーで見せる。以前は「会場内パーセンタイル0」と
                文字で出していて、専門用語のうえ「0」が確率0%に見えた（BOA-706） */}
            <p className="result-volatility-line">
              {t("result.volatilityPredicted", {
                label: t(
                  `volatility.level${volatilityLevel === "high" ? "High" : "Low"}`,
                ),
              })}
            </p>
            <VolatilityPercentileBar
              percentile={prediction.volatilityPercentile ?? 0}
            />
            {/* 何と比べた 0〜100 かを、レース前のカードと同じ一文で書く。無いと「イン崩れ確率高」の
                真下の「99」が「崩れる確率99%」に読めた（PR #1186 ファン評価1・3周目） */}
            <p className="result-volatility-caveat">
              {t("volatility.description")}
            </p>
            <p className="result-volatility-line">
              {t("result.volatilityOutcomeLabel")}
              {": "}
              {canJudge ? (
                <>
                  <strong>
                    {isUpset
                      ? t("result.volatilityOutcomeCollapsed")
                      : t("result.volatilityOutcomeSolid")}
                  </strong>
                  {isUpset
                    ? t("result.volatilityOutcomeDetailUpset", {
                        winner: result.rank1,
                      })
                    : t("result.volatilityOutcomeDetailFavorite")}
                </>
              ) : (
                <strong>{t("result.volatilityOutcomeNotJudgeable")}</strong>
              )}
            </p>
            <p className="result-volatility-caveat">
              {t("result.volatilityCaveat")}{" "}
              <Link to="/accuracy">{t("result.volatilityCaveatLink")}</Link>
            </p>
          </div>
        )}

        {/* 展開予測: 実測的中率（約80%）は「上位予想のいずれかが的中すれば的中」という
            定義のため、単一の断定予想ではなく確率付きランキングとして正直に見せる */}
        {hasTurnPrediction && (
          <div className="result-verify-section">
            <h5 className="result-verify-title">
              {t("result.turnSectionTitle")}
            </h5>
            <TurnPatternList patterns={turnPatterns} result={result} />
            {showWinnerCourse && (
              <p className="result-verify-entry-note">
                {t("turnPatternList.winnerEntryCourse", {
                  boat: winner.boat,
                  course: winner.course,
                })}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  // 未確定レース: 「これから何が起きそうか」を示す未来志向の3ブロック
  if (!hasTurnPrediction && prediction?.volatilityPercentile == null) {
    return (
      <div className="race-tabs-empty">
        <p>{t("aiPredictionTab.unavailableTitle")}</p>
        <p className="race-tabs-empty-body">
          {t("aiPredictionTab.unavailableBody")}
        </p>
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        className="prediction-result"
        initial={{ opacity: 0, x: 10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2 }}
      >
        {/* ブロック1: 展開予測カード（FR2）。実測精度（動的）+ 今回の上位候補ランキング。
            以前はここにアニメーション（FirstMarkAnimation）も併記していたが、
            同じpatternsデータから異なる問い（複数シナリオの勝者候補 vs 単一
            シナリオの全着順）に答える2つの表示が数値レベルで食い違い、
            ユーザーから「よくわからないUX」との指摘を受けたため撤去した
            （2026-08-14。将来的に別の演出を検討する） */}
        {prediction.turnPrediction && prediction.allPlayers && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          >
            <PredictionCard
              title={`🌊 ${t("turnPatternList.title")}`}
              statKey="turn"
              hintKey="turnPrediction"
            >
              <TurnPatternList patterns={prediction.turnPrediction.patterns} />
            </PredictionCard>
          </motion.div>
        )}

        {/* ブロック2: イン崩れ指数バッジ（FR3） */}
        {prediction.volatilityPercentile != null && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
          >
            <VolatilityDisplay
              percentile={prediction.volatilityPercentile}
              reasons={prediction.volatilityReasons}
              isFallback={prediction.volatilityPercentileIsFallback}
              venueCode={venueCode}
              raceId={raceId}
            />
          </motion.div>
        )}

        {/* 出現パターン */}
        {venueCode && venueName && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.3, ease: "easeOut" }}
          >
            <OutcomePatternPreview
              venueCode={venueCode}
              venueName={venueName}
              prediction={prediction}
            />
          </motion.div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

export default RaceAiPredictionTab;
