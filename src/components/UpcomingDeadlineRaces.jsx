/**
 * UpcomingDeadlineRaces - トップの「まもなく締切のレース」の節（PV09 T1・案 B、BOA-1690）
 *
 * 置き場所は TodayVenuesSection の UpdateStatus の下・初めての人の案内のカード（FirstVisitGuideCard）と
 * IntroBanner より上。最初の画面にレースの中身を出し、1回でレースへ入れるようにする。
 * - PC（768px 以上）は最大6行を3列×2段。スマホは3行＋「もっと見る」。押すと残りを出し、ボタンは消す（閉じない）
 * - 時刻は「締切予定 HH:MM」の固定の字だけ。「あと○分」・展開の1語は出さない（オーナー決定）
 * - 的中率・回収率・買い目・展開予測の語と数字は出さない（docs/decisions/site-positioning.md）
 * - ボット向けのトップ（botPageModel.js の buildTopModel）も同じ純関数で同じ行を同じ並びに出す
 * - 読み込み中は同じ高さの場所を取る（CLS を出さない）。残りが0なら節ごと出さない
 * - 行は 4行目以降も DOM に置き、スマホでは CSS で隠す（PC の幅では常に見える）
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLocalizedPath } from "../hooks/useLocalizedPath";
import { isInCautionEnabled } from "../config/featureFlags";
import { getRaceStageBadge } from "../constants/raceStageConfig";
import { raceNumberLabel, deadlineValueText } from "../utils/raceListDisplay";
import {
  pickUpcomingDeadlineRaces,
  moreButtonVenues,
  UPCOMING_MOBILE_VISIBLE,
} from "../utils/upcomingDeadlineRaces";
import InCautionBadge from "./race/InCautionBadge";
import "./UpcomingDeadlineRaces.css";

const FINAL_BADGE = getRaceStageBadge("優勝戦");

function moreLabel(t, rows) {
  const { venues, hasOthers } = moreButtonVenues(rows);
  const names = venues
    .map(
      (v) =>
        `${t(`venues.${v.venueCode}`)}${v.isFinal ? ` ${t(FINAL_BADGE.i18nKey)}` : ""}`,
    )
    .join(t("home.upcomingDeadline.venueSeparator"));
  return t(
    hasOthers
      ? "home.upcomingDeadline.moreWithOthers"
      : "home.upcomingDeadline.more",
    { venues: names },
  );
}

function RaceRow({ row, hidden, showCaution }) {
  const { t } = useTranslation();
  const localize = useLocalizedPath();
  return (
    <li
      className={`upcoming-deadline__item${hidden ? " upcoming-deadline__item--more" : ""}`}
    >
      <Link
        to={localize(`/race/${row.raceId}`)}
        className="upcoming-deadline__link"
      >
        <span className="upcoming-deadline__top">
          <span className="upcoming-deadline__race" translate="no">
            {t(`venues.${row.venueCode}`)} {raceNumberLabel(row.raceNo)}
          </span>
          <span className="upcoming-deadline__time">
            <span className="upcoming-deadline__time-label">
              {t("home.upcomingDeadline.deadline")}
            </span>{" "}
            <span className="upcoming-deadline__time-value">
              {deadlineValueText(t, row.startTime)}
            </span>
          </span>
        </span>
        <span className="upcoming-deadline__bottom">
          {row.gradeLabel && (
            <span
              className="upcoming-deadline__badge"
              style={{ background: row.gradeColor }}
            >
              {row.gradeLabel}
            </span>
          )}
          {row.isFinal && (
            <span
              className="upcoming-deadline__badge"
              style={{ background: FINAL_BADGE.color }}
            >
              {FINAL_BADGE.emoji} {t(FINAL_BADGE.i18nKey)}
            </span>
          )}
          {row.boat1 && (
            <span className="upcoming-deadline__racer" translate="no">
              <span className="upcoming-deadline__boat" aria-hidden="true">
                1
              </span>
              <span className="upcoming-deadline__racer-name">
                {row.boat1.name}
              </span>
              {row.boat1.rank && (
                <span className="upcoming-deadline__racer-rank">
                  {row.boat1.rank}
                </span>
              )}
            </span>
          )}
          {showCaution && row.cautionHigh && <InCautionBadge level="high" />}
        </span>
      </Link>
    </li>
  );
}

export default function UpcomingDeadlineRaces({ venuesData, nowHHMM, loading }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (loading) {
    return (
      <div
        className="upcoming-deadline upcoming-deadline--placeholder"
        aria-hidden="true"
      />
    );
  }
  const rows = pickUpcomingDeadlineRaces(venuesData, nowHHMM);
  if (rows.length === 0) return null;
  const showCaution = isInCautionEnabled();
  const hasMore = rows.length > UPCOMING_MOBILE_VISIBLE;
  return (
    <section
      className={`upcoming-deadline${expanded ? " upcoming-deadline--expanded" : ""}`}
      aria-labelledby="upcoming-deadline-title"
    >
      <h3 id="upcoming-deadline-title" className="upcoming-deadline__title">
        ⏱️ {t("home.upcomingDeadline.title")}
      </h3>
      <ul className="upcoming-deadline__list">
        {rows.map((row, i) => (
          <RaceRow
            key={row.raceId}
            row={row}
            hidden={i >= UPCOMING_MOBILE_VISIBLE}
            showCaution={showCaution}
          />
        ))}
      </ul>
      {hasMore && !expanded && (
        <button
          type="button"
          className="upcoming-deadline__more"
          onClick={() => setExpanded(true)}
        >
          {moreLabel(t, rows)}
        </button>
      )}
    </section>
  );
}
