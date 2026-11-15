import { recordsBeforeRace } from "./basicInfoStats";
import SixBoatCourseTable from "./SixBoatCourseTable";
import RaceStConsiderationCard from "./RaceStConsiderationCard";
import { deriveCellView, periodAnchorOf } from "./RaceWakuInfoTabData";
import { BoatChipRow, LowerCards } from "./RaceWakuInfoTabCards";
import { CourseGridCard } from "./RaceWakuInfoTabGrid";

// 表示中のレースより前の走だけを使う（BOA-603）。過去のレースを開いたとき、
// そのレース自身と後日の走がコース別成績・直近走の帯・ST考察に入り、結果を
// 知った状態の数字になっていた
function recordsBeforeEachRace(scopedByRacer, raceId) {
  return Object.fromEntries(
    Object.entries(scopedByRacer).map(([id, records]) => [
      id,
      recordsBeforeRace(records, raceId),
    ]),
  );
}

// hooks を呼び終えた後の描画。props は RaceWakuInfoTab が集めた値
export default function RaceWakuInfoTabBody({
  t,
  venueCode,
  raceId,
  onFocusBoat,
  sixBoatPeriod,
  onSixBoatPeriodChange,
  sortedPlayers,
  selectedBoat,
  selectedPlayer,
  scopedByRacer,
  openCell,
  toggleCell,
  fold,
  sixBoatStats,
  flyingRowByBoat,
  currentMeetFlyingBoats,
  venueData,
}) {
  const { techniqueStats, baseline, nigeRows } = venueData;
  const scopedBefore = recordsBeforeEachRace(scopedByRacer, raceId);
  const scopedRecords = selectedPlayer?.racerId
    ? scopedBefore[selectedPlayer.racerId]
    : null;
  const periodAnchor = periodAnchorOf(raceId);
  const todayCourse = selectedPlayer?.number ?? null;
  const view = deriveCellView({
    scopedRecords,
    venueCode,
    metric: fold.metric,
    periodAnchor,
    todayCourse,
    openCell,
    t,
  });

  return (
    <div className="race-waku-info-tab">
      <SixBoatCourseTable
        stats={sixBoatStats}
        players={sortedPlayers}
        venueCode={venueCode}
        scopedBefore={scopedBefore}
        periodAnchor={periodAnchor}
        period={sixBoatPeriod}
        onPeriodChange={onSixBoatPeriodChange}
        focusedBoat={selectedBoat}
        onFocusBoat={onFocusBoat}
      />
      <p className="rwit-note">{t("wakuInfo.note")}</p>

      <BoatChipRow
        t={t}
        players={sortedPlayers}
        selectedNumber={selectedPlayer.number}
        onFocusBoat={onFocusBoat}
      />

      <CourseGridCard
        t={t}
        scopedRecords={scopedRecords}
        sixBoatStats={sixBoatStats}
        selectedNumber={selectedPlayer.number}
        todayCourse={todayCourse}
        view={view}
        openCell={openCell}
        toggleCell={toggleCell}
        {...fold}
      />

      {/* ST考察（FR-1）。6艇分を並べるため選択中の選手に依存しない。
          今日の進入コースはレース前には確定しないため、枠なり進入を想定して
          艇番をそのままコースとして使う（日和のST考察も1号艇の抜出率が「-」で
          あることからコース別＝枠なり進入想定の集計と判断した。spec.md FR-1） */}
      <RaceStConsiderationCard
        players={sortedPlayers}
        scopedByRacer={scopedBefore}
        baseline={baseline}
        entryCourseOf={(p) => p.number}
        flyingRowByBoat={flyingRowByBoat}
        currentMeetFlyingBoats={currentMeetFlyingBoats}
      />

      <LowerCards
        t={t}
        raceId={raceId}
        players={sortedPlayers}
        scopedBefore={scopedBefore}
        periodAnchor={periodAnchor}
        sixBoatPeriod={sixBoatPeriod}
        nigeRows={nigeRows}
        techniqueStats={techniqueStats}
      />
    </div>
  );
}
