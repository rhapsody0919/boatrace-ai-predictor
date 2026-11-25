import { ALL_VENUE_CODES } from "../../constants";
import { GRADE_LABELS } from "../race/raceGradeLabels";

// 選手ページの成績・調子（RacerPerformanceStats）の絞り込みの欄と、履歴の読み込みの注記

/** 会場・枠番の選択 */
function VenueBoatSelects({ t, vc, todayVenueCode }) {
  return (
    <>
      <div className="racer-vc-filter-field">
        <label htmlFor="vc-venue">会場</label>
        <select
          id="vc-venue"
          className="venue-select"
          value={vc.vcVenue}
          onChange={(e) => vc.setVcVenue(e.target.value)}
        >
          <option value="all">全会場</option>
          {ALL_VENUE_CODES.map((code) => (
            <option key={code} value={code}>
              {code === todayVenueCode ? "🏁 " : ""}
              {t(`venues.${code}`, code)}
            </option>
          ))}
        </select>
      </div>
      <div className="racer-vc-filter-field">
        <label htmlFor="vc-boat">枠番</label>
        <select
          id="vc-boat"
          className="venue-select"
          value={vc.vcBoat}
          onChange={(e) => vc.setVcBoat(e.target.value)}
        >
          <option value="all">全枠番</option>
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n}号艇
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

/** 進入コースの選択。選択肢に走数を出し、0走は押せなくする（選んでいるものは除く） */
function CourseSelect({ vc }) {
  return (
    <div className="racer-vc-filter-field">
      <label htmlFor="vc-course">進入コース</label>
      <select
        id="vc-course"
        className="venue-select"
        value={vc.vcCourse}
        onChange={(e) => vc.setVcCourse(e.target.value)}
      >
        <option value="all">全コース</option>
        {[1, 2, 3, 4, 5, 6].map((n) => {
          const runs = vc.vcCourseCounts?.[n] ?? 0;
          return (
            <option
              key={n}
              value={n}
              disabled={runs === 0 && vc.vcCourse !== String(n)}
            >
              {n}コース（{runs}走）
            </option>
          );
        })}
      </select>
    </div>
  );
}

/** グレード・レース種別の選択 */
function GradeStageSelects({ vc }) {
  return (
    <>
      <div className="racer-vc-filter-field">
        <label htmlFor="vc-grade">グレード</label>
        <select
          id="vc-grade"
          className="venue-select"
          value={vc.vcGrade}
          onChange={(e) => vc.setVcGrade(e.target.value)}
        >
          <option value="all">全グレード</option>
          {Object.entries(GRADE_LABELS).map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="racer-vc-filter-field">
        <label htmlFor="vc-stage">レース種別</label>
        <select
          id="vc-stage"
          className="venue-select"
          value={vc.vcStage}
          onChange={(e) => vc.setVcStage(e.target.value)}
        >
          <option value="all">全レース</option>
          <option value="優勝戦">優勝戦</option>
          <option value="準優勝戦">準優勝戦</option>
        </select>
      </div>
    </>
  );
}

/**
 * フィルタ: 見出し直下・最上部に常時表示（ADR-0063）。venueStatsが
 * 空（出走実績が薄い選手）でも全会場を選べるようにするため、この
 * ブロック自体はhasAnyData（呼ぶ側でチェック済み）にのみ依存する
 */
export function VcFilterBar({ t, vc, vcData, vcLabel, todayVenueCode }) {
  return (
    <div className="racer-vc-filter controls-section">
      <VenueBoatSelects t={t} vc={vc} todayVenueCode={todayVenueCode} />
      <CourseSelect vc={vc} />
      <GradeStageSelects vc={vc} />
      {todayVenueCode && vc.vcVenue !== String(todayVenueCode) && (
        <button
          type="button"
          className="racer-vc-today-badge"
          onClick={() => vc.setVcVenue(String(todayVenueCode))}
        >
          🏁 本日は{t(`venues.${todayVenueCode}`, todayVenueCode)}で出走 →
        </button>
      )}
      {vc.vcCourse !== "all" && (
        <p className="racer-vc-course-note">
          進入コースは実際に入ったコースです（2025年12月以降で、進入が分かった走だけ）。前付けがあると枠番と違います。
        </p>
      )}
      {vc.vcActive && (
        <span className="racer-vc-filter-badge">
          {vc.vcHistoryError
            ? `${vcLabel}（読み込みに失敗しました）`
            : vc.vcHistoryLoading
              ? `${vcLabel}（集計中…）`
              : vcData
                ? `${vcLabel}（${vcData.n}走）`
                : vcLabel}
        </span>
      )}
    </div>
  );
}

/** 出走履歴の取得に失敗したときの注記と再試行 */
export function VcHistoryError({ vc }) {
  if (!vc.vcHistoryError) return null;
  return (
    <p className="racer-stat-note">
      出走履歴の取得に失敗しました。
      <button
        type="button"
        className="racer-vc-retry-button"
        onClick={() => vc.setVcRetryToken((n) => n + 1)}
      >
        再試行
      </button>
    </p>
  );
}
