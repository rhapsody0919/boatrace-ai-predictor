import { GRADE_CONFIG } from "../../../constants/gradeConfig";
import { ROUND_LABEL } from "../../../utils/assistModel";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";
import { TheoryButton } from "./SheetButtons";

// 一般（ippan）も札を出す（承認モック v7。レース詳細は出さないが、ここは会場・R・ラウンドと並べて読ませる）
function gradeLabelOf(race) {
  return (
    GRADE_CONFIG[race?.raceGrade]?.label ??
    (race?.raceGrade === "ippan" ? ASSIST_COPY.gradeIppan : null)
  );
}

function VenueTitle({ race, onVenue }) {
  return (
    <h1 className="ta-header-venue">
      {race?.venue ? (
        <button
          type="button"
          className="ta-venue-btn"
          aria-label={ASSIST_COPY.venueAria(race.venue)}
          onClick={onVenue}
        >
          {race.venue} ›
        </button>
      ) : null}{" "}
      {race?.raceNumber ? `${race.raceNumber}R` : ""}
      <span className="ta-sr"> {ASSIST_COPY.title}</span>
    </h1>
  );
}

export default function AssistHeaderRow({ race, round, onVenue }) {
  const grade = gradeLabelOf(race);
  const roundLabel = round ? ROUND_LABEL[round] : (race?.raceStage ?? null);
  return (
    <div className="ta-header-row">
      <VenueTitle race={race} onVenue={onVenue} />
      {roundLabel && (
        <span className="ta-pill ta-pill-round">{roundLabel}</span>
      )}
      {/* 優勝戦・準優勝戦のスタートのセオリー（TC-T8）。予選・一般の日は出さない */}
      {round && (
        <TheoryButton
          id="TC-T8"
          name={ASSIST_COPY.roundTheory(ROUND_LABEL[round])}
        />
      )}
      {/* 一般戦はラウンドも「一般」になるので、同じ語を2つ並べない（ファン評価 2周目 指摘8） */}
      {grade && grade !== roundLabel && (
        <span className="ta-pill">{grade}</span>
      )}
      {race?.startTime && (
        <span className="ta-pill ta-num">
          {ASSIST_COPY.deadline(race.startTime)}
        </span>
      )}
    </div>
  );
}
