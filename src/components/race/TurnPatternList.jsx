/**
 * TurnPatternList - 展開予測の上位パターンを確率付きランキングで表示する共有コンポーネント
 *
 * 背景（2026-08-14）: 展開予測の実測的中率（約80%）は「上位パターンのいずれかの
 * winnerCourseが実際の1着と一致すれば的中」という定義（verify-turn-prediction-accuracy-v6.js）。
 * これを「予想: 1・2・3号艇が1着」のように単一の断定予想として見せると、
 * (1) 複数艇を並べているだけで何を予想したのか分からない、
 * (2) 1位予想の確率が例えば47%しかない場合でも「1号艇が1着」と断定的に見えてしまい、
 *     イン崩れ注意度（波乱リスク高）の表示と矛盾しているように見える、
 * という2つの問題があった。確率付きの候補ランキングとして正直に見せることで、
 * どの程度の自信度の予想なのかが一目でわかるようにする。
 *
 * PredictionPanel（レース前）とRaceResult（レース後）で共有する。
 * result（結果オブジェクト）を渡すとレース後モードになり、一致した行をハイライトし結果を明示する。
 * 不成立のレースは「判定対象外」、返還艇の候補には「返還（判定対象外）」を出す（BOA-543）。
 *
 * 艇番の重複除去（2026-08-14追記）: patternsは技術（決まり手）単位の配列のため、
 * 同じ艇が異なる決まり手で複数回登場することがある（例: 2号艇の差し9%とまくり9%）。
 * そのまま並べると「1号艇→2号艇→2号艇」のように同じ艇が2回候補として見え、
 * 分かりにくい・データがおかしく見えるという指摘があったため、表示上は艇番で
 * 重複除去する（既に確率降順のため最も確率の高い決まり手が残る）。
 * 的中判定（hasHit）は実測的中率80%の定義と一致させるため、重複除去前の
 * 元のpatterns全体に対して行う（表示の重複除去とは独立）
 */
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import {
  TECHNIQUE_NAMES,
  pickHitPattern,
  isAsPredicted,
  techniqueDiffers,
} from "../../utils/turnPrediction";
import { TURN_JUDGEMENT, judgeTurnPrediction } from "../../utils/raceOutcome";
import "./TurnPatternList.css";

const RANK_ICONS = ["🥇", "🥈", "🥉"];

function TurnPatternList({
  patterns,
  result = null,
  // 1着の艇が実際に入ったコース（不明なら null）。「予想通り」を言うかの判定に使う（BOA-724）
  winnerEntryCourse = null,
}) {
  const { t } = useTranslation();

  if (!Array.isArray(patterns) || patterns.length === 0) return null;

  // patterns[].technique は "nige"/"sashi" 等の英語キー（TECHNIQUE_KEY_BY_NAMEの
  // 日本語名→キーとは向きが逆。FirstMarkAnimation.jsxのuseTechniqueLabelと同じ変換）
  const translateTechnique = (key) =>
    t(`techniques.${key}`, TECHNIQUE_NAMES[key] || key);

  // レース後モード（result あり）。的中の判定は RaceCard・HitRaces と同じ関数を通す（BOA-543）。
  // 不成立は判定対象外、一部返還は返還艇の候補にだけ「判定対象外」の印を付ける
  const isResultMode = result != null;
  const judgement = isResultMode ? judgeTurnPrediction(patterns, result) : null;
  const isNotJudgeable = judgement?.status === TURN_JUDGEMENT.NOT_JUDGEABLE;
  const hasHit = judgement?.status === TURN_JUDGEMENT.HIT;
  const actualWinner = judgement?.winner ?? null;

  // 実際の決まり手（日本語）。的中は1着の艇だけで判定するので、決まり手が外れていることがある
  const actualTechnique = result?.winningTechnique ?? null;
  // 1着の艇は、実際の決まり手と同じ候補があればそれを出す（的中レース一覧のカードと同じ候補。
  // pickHitPattern、BOA-724）。他の艇は確率の一番高い決まり手
  const hitPattern =
    hasHit && actualWinner != null
      ? pickHitPattern(patterns, actualWinner, actualTechnique)
      : null;
  const seenCourses = new Set();
  const displayPatterns = patterns
    .filter((p) => {
      if (seenCourses.has(p.winnerCourse)) return false;
      seenCourses.add(p.winnerCourse);
      return true;
    })
    .map((p) =>
      hitPattern && p.winnerCourse === hitPattern.winnerCourse ? hitPattern : p,
    );
  // 本命（1番手の候補）が、予想の決まり手・艇番どおりのコースで1着になったときだけ「予想通り」と言う。
  // 2番手以下が当たった、決まり手が違う、前付けで勝った、のどれかなら控えめなまとめにする
  // （BOA-724 の A-2 を (b) に。共有文と同じ区別）
  const asPredicted =
    hitPattern != null &&
    isAsPredicted({
      predictedTechnique: TECHNIQUE_NAMES[hitPattern.technique],
      actualTechnique,
      winnerBoat: actualWinner,
      winnerEntryCourse,
      isTopPick: hitPattern === patterns[0],
    });
  // 決まり手の英語キー（実際の決まり手を各言語の名前で出すため）
  const actualTechniqueKey =
    Object.keys(TECHNIQUE_NAMES).find(
      (key) => TECHNIQUE_NAMES[key] === actualTechnique,
    ) ?? null;

  return (
    <div className="turn-pattern-list">
      {/* レース後の振り返りでも、%が何の値かを書く。書かないと「47%」を的中率や過去の決着率と
          取り違えやすく、丸数字がコース番号であることも分からなかった（BOA-706） */}
      <p className="turn-pattern-caption">
        {t(
          isResultMode
            ? "turnPatternList.captionResult"
            : "turnPatternList.caption",
        )}
      </p>
      {displayPatterns.map((pattern, index) => {
        // 不成立のレースは行ごとの印を付けず、まとめの「判定対象外（不成立）」だけにする
        const isRefunded =
          isResultMode &&
          !isNotJudgeable &&
          judgement.refundedCourses.includes(pattern.winnerCourse);
        const isMatch =
          isResultMode &&
          !isNotJudgeable &&
          !isRefunded &&
          pattern.winnerCourse === actualWinner;
        const colors = BOAT_COLORS[pattern.winnerCourse] || BOAT_COLORS[1];
        return (
          <div
            key={`${pattern.winnerCourse}-${pattern.technique}-${index}`}
            className={`turn-pattern-row${isMatch ? " turn-pattern-row--hit" : ""}${isNotJudgeable || isRefunded ? " turn-pattern-row--void" : ""}`}
          >
            <span className="turn-pattern-rank">
              {RANK_ICONS[index] || `${index + 1}`}
            </span>
            <span
              className="turn-pattern-boat"
              style={{ background: colors.bg, color: colors.text }}
            >
              {pattern.winnerCourse}
            </span>
            {/* 「的中」は艇の印。判定は1着の艇だけで決まり手は見ないため、決まり手と%の後ろに
                付けると「その決まり手が当たった」と読めた（BOA-724） */}
            {isMatch && (
              <span className="turn-pattern-hit-tag">
                {t("turnPatternList.hitTag")}
              </span>
            )}
            <span className="turn-pattern-technique">
              {translateTechnique(pattern.technique)}
              {/* 予想した決まり手が外れていても艇が1着なら的中になる。「① 的中 逃げ」だけだと
                  逃げが当たったと読めるので、実際の決まり手を添える（BOA-724。カードと同じ） */}
              {isMatch &&
                actualTechniqueKey &&
                techniqueDiffers(
                  TECHNIQUE_NAMES[pattern.technique],
                  actualTechnique,
                ) && (
                  <span className="turn-pattern-actual">
                    {t("turnPatternList.actualTechnique", {
                      technique: translateTechnique(actualTechniqueKey),
                    })}
                  </span>
                )}
            </span>
            <span className="turn-pattern-prob">
              {Math.round(pattern.probability * 100)}%
            </span>
            {isRefunded && (
              <span className="turn-pattern-void-tag">
                {t("turnPatternList.refundedTag")}
              </span>
            )}
          </div>
        );
      })}

      {isResultMode && isNotJudgeable && (
        <div className="turn-pattern-summary turn-pattern-summary--void">
          <p className="turn-pattern-summary-title">
            {t("turnPatternList.notJudgeable")}
          </p>
          <p className="turn-pattern-summary-body">
            {t("turnPatternList.notJudgeableBody")}
          </p>
        </div>
      )}
      {isResultMode && !isNotJudgeable && (
        <p
          className={`turn-pattern-summary${hasHit ? " turn-pattern-summary--hit" : " turn-pattern-summary--miss"}`}
        >
          {hasHit
            ? t(
                asPredicted
                  ? "turnPatternList.summaryAsPredicted"
                  : "turnPatternList.summaryHit",
              )
            : t("turnPatternList.summaryMiss", { winnerNumber: actualWinner })}
        </p>
      )}
    </div>
  );
}

export default TurnPatternList;
