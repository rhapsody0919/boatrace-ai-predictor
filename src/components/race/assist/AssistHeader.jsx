import { Link } from "react-router-dom";
import { GRADE_CONFIG } from "../../../constants/gradeConfig";
import { formatObservedTime } from "../weatherInfo";
import { ROUND_LABEL } from "../../../utils/assistModel";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

/**
 * ヘッダー（spec FR-2、screens S-1 A）: 会場・R・ラウンド・グレード・締切、気象（展示後だけ）・時点の切り替え、
 * 堅い？荒れる？の枠（children）、オッズの取得時刻、龍神ソナーへの導線（ソナーを表示できる端末だけ、D-36 (8)）。
 * 会場の特徴のシート・「傾向 ›」は後の PR（tasks PR5）
 */
export default function AssistHeader({
  race,
  raceId,
  round,
  stage,
  canPost,
  onStage,
  oddsAt,
  showSonar,
  children,
}) {
  const w = race?.weather ?? null;
  const post = stage === "post";
  // 一般（ippan）も札を出す（承認モック v7。レース詳細は出さないが、ここは会場・R・ラウンドと並べて読ませる）
  const grade =
    GRADE_CONFIG[race?.raceGrade]?.label ??
    (race?.raceGrade === "ippan" ? ASSIST_COPY.gradeIppan : null);
  const roundLabel = round ? ROUND_LABEL[round] : (race?.raceStage ?? null);
  const observed = formatObservedTime(w?.observedAt);
  return (
    <header className="ta-header">
      <div className="ta-header-row">
        <h1 className="ta-header-venue">
          {race?.venue ?? ""} {race?.raceNumber ? `${race.raceNumber}R` : ""}
          <span className="ta-sr"> {ASSIST_COPY.title}</span>
        </h1>
        {roundLabel && (
          <span className="ta-pill ta-pill-round">{roundLabel}</span>
        )}
        {grade && <span className="ta-pill">{grade}</span>}
        {race?.startTime && (
          <span className="ta-pill ta-num">
            {ASSIST_COPY.deadline(race.startTime)}
          </span>
        )}
      </div>
      <div className="ta-header-sub">
        {post && w ? (
          <>
            {(w.windDirection || w.windSpeed != null) && (
              <span>
                風 {w.windDirection ?? ""}{" "}
                {w.windSpeed != null && (
                  <b className="ta-num">{w.windSpeed}m</b>
                )}
              </span>
            )}
            {w.waveHeight != null && (
              <span>
                波 <b className="ta-num">{w.waveHeight}</b>cm
              </span>
            )}
            {(w.weather || w.temperature != null) && (
              <span>
                {w.weather ?? ""}
                {w.temperature != null && (
                  <span className="ta-num"> {w.temperature}℃</span>
                )}
              </span>
            )}
            {w.waterTemperature != null && (
              <span>
                水温 <span className="ta-num">{w.waterTemperature}℃</span>
              </span>
            )}
            {observed && (
              <span className="ta-note ta-num">
                {ASSIST_COPY.observedAt(observed)}
              </span>
            )}
          </>
        ) : (
          <span>{ASSIST_COPY.weatherAfterExhibition}</span>
        )}
        <span
          className="ta-seg"
          role="group"
          aria-label={ASSIST_COPY.stageGroup}
        >
          <button
            type="button"
            aria-pressed={!post}
            onClick={() => onStage("pre")}
          >
            {ASSIST_COPY.stagePre}
          </button>
          <button
            type="button"
            aria-pressed={post}
            disabled={!canPost}
            onClick={() => onStage("post")}
          >
            {ASSIST_COPY.stagePost}
          </button>
        </span>
      </div>
      {children}
      <div className="ta-header-foot">
        {/* オッズが無いときは買い目レンズの図に「発売後に出る」を出す（screens「状態」）。ここでは出さない */}
        <span className="ta-num">
          {oddsAt ? ASSIST_COPY.oddsAt(oddsAt) : ""}
        </span>
        {showSonar && (
          <Link className="ta-link" to={`/race/${raceId}?tab=aiPrediction`}>
            {ASSIST_COPY.sonarLink}
          </Link>
        )}
      </div>
    </header>
  );
}
