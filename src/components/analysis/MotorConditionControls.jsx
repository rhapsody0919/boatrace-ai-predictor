/** MotorConditionChart の見出しと選択の部品（会場・レース・期間）（MotorConditionChart.jsx から本文を字のまま移した） */
import { useTranslation } from "react-i18next";
import { STADIUM_NAMES as VENUE_NAMES } from "../../constants";
import { formatGenerationDate } from "../../utils/motorGeneration";

export function MotorTitle() {
  const { t } = useTranslation();
  return (
    <>
      <h2>{t("analysis.motor.title")}</h2>
      <p className="section-description">
        {t("analysis.motor.description")}
      </p>
    </>
  );
}

function VenueSelect({ venues, selectedVenue, setSelectedVenue, venueOffToday }) {
  const { t } = useTranslation();
  return (
    <>
      <label htmlFor="motor-venue-select">
        {t(
          venueOffToday
            ? "analysis.venueSelectLabel"
            : "analysis.venueSelectTodayLabel",
        )}
      </label>
      <select
        id="motor-venue-select"
        value={selectedVenue ?? ""}
        onChange={(e) => setSelectedVenue(parseInt(e.target.value, 10))}
        className="venue-select"
      >
        {/* ディープリンク先の会場が「本日開催中」の一覧に無いとき（ランキングの機番・
            機力バッジから過去レースへ飛んだとき）も、選択肢に足す。無いとブラウザが
            先頭の会場を表示し、別会場の同じ番号のモーターと読み違える（BOA-428 ファン評価） */}
        {(venueOffToday
          ? [selectedVenue, ...venues]
          : venues
        ).map((v) => (
          <option key={v} value={v}>
            {t(`venues.${v}`, VENUE_NAMES[v] || String(v))}
          </option>
        ))}
      </select>
    </>
  );
}

function RaceSelect({ races, selectedRace, setSelectedRace }) {
  const { t } = useTranslation();
  return (
    <>
      <label htmlFor="motor-race-select">
        {t("analysis.raceSelectLabel")}
      </label>
      <select
        id="motor-race-select"
        value={selectedRace ?? ""}
        onChange={(e) => setSelectedRace(e.target.value)}
        className="venue-select"
      >
        {/* 選択中のレースが今日の一覧に無い（過去レースへのディープリンク）ときも足す */}
        {selectedRace !== null &&
          !races.some((r) => r.race_id === selectedRace) && (
            <option value={selectedRace}>
              {t("analysis.raceOptionPast", {
                date: selectedRace
                  .slice(5, 10)
                  .replace("-", "/")
                  .replace(/^0/, "")
                  .replace(/\/0/, "/"),
                number: Number(selectedRace.slice(-2)),
              })}
            </option>
          )}
        {races.map((r) => (
          <option key={r.race_id} value={r.race_id}>
            {t("analysis.raceOption", {
              number: r.race_number,
              time: r.start_time?.slice(0, 5),
            })}
          </option>
        ))}
      </select>
    </>
  );
}

export function MotorSelectors({ m, venueOffToday }) {
  const { t } = useTranslation();
  const { venues, loading, selectedVenue, setSelectedVenue, races, selectedRace, setSelectedRace } = m;
  return venues.length === 0 && !loading ? (
    <div className="empty-state">{t("analysis.noRacesToday")}</div>
  ) : (
    <div className="controls-section">
      <VenueSelect venues={venues} selectedVenue={selectedVenue} setSelectedVenue={setSelectedVenue} venueOffToday={venueOffToday} />
      {(races.length > 0 || selectedRace !== null) && (
        <RaceSelect races={races} selectedRace={selectedRace} setSelectedRace={setSelectedRace} />
      )}
    </div>
  );
}

export function PeriodControls({ m, v }) {
  const { t } = useTranslation();
  const { generationStart, periodDays, setPeriodDays, drillDownMotor, racePreGeneration } = m;
  const { showPeriodToggle, periodChoiceHasEffect, clippedByGeneration, officialMode } = v;
  return showPeriodToggle ? (
    <>
      {/* 現行モーターの使用開始日。いつからのモーターかが分からないと、「入れ替え後の
          ため期間を限っています」を「最近入れ替えた」と読み違える（2026-09-29 ユーザー指摘）。
          当日のレースだけに出す（過去レースは出走表時点の公式値で、取れるのは最新の
          使用開始日1つだけのため、当時の日付を出せない） */}
      {generationStart !== null && (
        <p className="motor-generation-start">
          {t("analysis.motor.generationStartLabel", {
            date: formatGenerationDate(generationStart),
          })}
          <span className="motor-generation-start-source">
            {t("analysis.motor.generationStartSource")}
          </span>
        </p>
      )}
      {periodChoiceHasEffect && (
        <div className="period-toggle" role="group">
          <button
            type="button"
            className={`period-toggle-btn ${periodDays === 90 ? "active" : ""}`}
            onClick={() => setPeriodDays(90)}
          >
            {t("analysis.motor.period90")}
          </button>
          <button
            type="button"
            className={`period-toggle-btn ${periodDays === 30 ? "active" : ""}`}
            onClick={() => setPeriodDays(30)}
          >
            {t("analysis.motor.period30")}
          </button>
        </div>
      )}
      {clippedByGeneration && (
        <p className="table-note">
          {t("analysis.motor.periodClippedNote", {
            date: formatGenerationDate(generationStart, { short: true }),
          })}
        </p>
      )}
    </>
  ) : (
    officialMode &&
    drillDownMotor === null && (
      <p className="table-note">
        {t("analysis.motor.periodOfficialNote")}
        {racePreGeneration &&
          ` ${t("analysis.motor.racePreGenerationNote")}`}
      </p>
    )
  );
}
