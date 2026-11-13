import { formatObservedTime } from "../weatherInfo";
import { trueWindDirection } from "../../../utils/windDirection.js";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";
import { TheoryButton } from "./SheetButtons";

function WindSpan({ w, windDir }) {
  if (!(windDir || w.windSpeed != null)) return null;
  return (
    <span>
      風 {windDir ?? ""}{" "}
      {w.windSpeed != null && <b className="ta-num">{w.windSpeed}m</b>}{" "}
      <TheoryButton
        id="TC-W1"
        name={ASSIST_COPY.theoryWindTitle(w.windSpeed)}
      />
    </span>
  );
}

function SkySpan({ w }) {
  if (!(w.weather || w.temperature != null)) return null;
  return (
    <span>
      {w.weather ?? ""}
      {w.temperature != null && (
        <span className="ta-num"> {w.temperature}℃</span>
      )}
    </span>
  );
}

function WeatherDetail({ w, windDir }) {
  const observed = formatObservedTime(w.observedAt);
  return (
    <>
      <WindSpan w={w} windDir={windDir} />
      {w.waveHeight != null && (
        <span>
          波 <b className="ta-num">{w.waveHeight}</b>cm
        </span>
      )}
      <SkySpan w={w} />
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
  );
}

function TideSpan() {
  return (
    <span>
      {ASSIST_COPY.tide} <span className="ta-note">{ASSIST_COPY.tidePrep}</span>{" "}
      <TheoryButton id="TC-T3" name={ASSIST_COPY.venueTide} />
    </span>
  );
}

function StageSeg({ post, canPost, onStage }) {
  return (
    <span className="ta-seg" role="group" aria-label={ASSIST_COPY.stageGroup}>
      <button type="button" aria-pressed={!post} onClick={() => onStage("pre")}>
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
  );
}

export default function AssistHeaderSub({
  race,
  venueCode,
  stage,
  canPost,
  onStage,
  tidal,
}) {
  const w = race?.weather ?? null;
  // DB の風向はアイコンの番号のままなので、会場ごとに本当の方位に直す（BOA-819）
  const windDir = trueWindDirection(w?.windDirection, venueCode);
  const post = stage === "post";
  return (
    <div className="ta-header-sub">
      {post && w ? (
        <WeatherDetail w={w} windDir={windDir} />
      ) : (
        <span>{ASSIST_COPY.weatherAfterExhibition}</span>
      )}
      {tidal && <TideSpan />}
      <StageSeg post={post} canPost={canPost} onStage={onStage} />
    </div>
  );
}
