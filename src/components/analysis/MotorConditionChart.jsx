/**
 * MotorConditionChart - モーター調子（BOA-151）
 * 本日開催中の会場・レースを選ぶと、そのレースの枠番別モーター調子
 * （2連率/3連率）を一覧表示する。「このレースのどの艇のモーターが
 * 調子いいか」を直接示すことで、賭ける判断にそのまま使えるようにする。
 * 気になるモーターは節ごとの推移グラフにドリルダウンできる。
 */
// 区画のファイルへ移す前と CSS の重なりの順を同じにする（元はこの2つの部品を先に import していた）
import "../common/HorizontalScrollHint.css";
import "../racer/RacerGradeBadge.css";
import { useTranslation } from "react-i18next";
import { STADIUM_NAMES as VENUE_NAMES } from "../../constants";
import { useVenueRaceSelector } from "../../hooks/useVenueRaceSelector";
import { useHorizontalScrollHint } from "../../hooks/useHorizontalScrollHint";
import {
  useBreakdownLoad,
  useDrillLoad,
  useMotorStates,
  usePeriodAndWakuReset,
} from "./motorConditionLoad";
import { useMotorView } from "./motorConditionView";
import { MotorTitle, PeriodControls } from "./MotorConditionControls";
import { MotorFooterNotes, MotorMain } from "./MotorConditionDrill";
import "./MotorConditionChart.css";
import "../common/HorizontalScrollHint.css";

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

function MotorSelectors({ m, venueOffToday }) {
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

function MotorConditionChart({
  initialVenueCode = null,
  initialRaceId = null,
  initialMotorNumber = null,
  embedded = false,
  // レース詳細で「今どの艇を見ているか」をタブ間で共有する（BOA-492/BOA-494）。
  // /winning-technique は渡さないので、そちらの挙動は変わらない
  focusedBoat = null,
  onFocusBoat = null,
}) {
  const { t } = useTranslation();
  const selector = useVenueRaceSelector({ initialVenueCode, initialRaceId, embedded, t });
  const states = useMotorStates(initialMotorNumber);
  const m = { ...selector, ...states, t, embedded, focusedBoat, onFocusBoat };
  useBreakdownLoad(m);
  useDrillLoad(m);
  usePeriodAndWakuReset(m);
  const v = useMotorView(m);
  // 9列の表は390pxでは右が切れる。切れていることに気づけるようにする
  // 会場内順位の列は一覧の後から足される（BOA-428）。足されたときに測り直す
  const rankingScroll = useHorizontalScrollHint([
    m.breakdown.length,
    m.venueRanks?.state,
  ]);
  const scroll = {
    hasMore: rankingScroll.hasMore,
    hasLess: rankingScroll.hasLess,
    scrollRight: rankingScroll.scrollRight,
    scrollLeft: rankingScroll.scrollLeft,
    update: rankingScroll.update,
  };

  return (
    <div className="motor-condition-container">
      {!embedded && <MotorTitle />}
      {!embedded && <MotorSelectors m={m} venueOffToday={v.venueOffToday} />}
      <PeriodControls m={m} v={v} />
      <MotorMain m={m} v={v} scroll={scroll} scrollRef={rankingScroll.ref} />
      <MotorFooterNotes m={m} v={v} />
    </div>
  );
}

export default MotorConditionChart;
