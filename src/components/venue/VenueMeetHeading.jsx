/**
 * 会場ページの見出しの下の、節と日目の行と「1R〜12R」のボタン（公式の形に寄せる。オーナー 2026-11-23 承認、
 * docs/design/venue-race-card-redesign/approved.md）。
 *
 * - 節の行: グレード（SG〜G3。一般戦は札なし）と節の名前。全グレードで出す（節のページへの帯 VenueMeetBanner は SG・G1・G2 だけ）
 *   グレードと名前は先頭レースの値を会場の代表値にする（会場カード venueCardHeadline と同じ）
 * - 日付と日目: 日目はトップの会場カード・レース詳細の見出しと同じ getVenueSeriesDayLabel（丸一日中止の日は出さない）
 * - 1R〜12R: 押すとそのレースの塊へ移る（目印の近道と同じ holdScrollPosition）
 */
import { useTranslation } from "react-i18next";
import { gradeConfigOf } from "../../utils/raceListDisplay";
import { getVenueSeriesDayLabel } from "../../utils/raceDetailHeading";
import { venueRaceJumpItems } from "../../pure/venueRaceJump";
import { holdScrollPosition } from "../../pages/VenueRaceListPageScroll";
import "./VenueMeetHeading.css";

function monthDayText(date, lang) {
  return new Intl.DateTimeFormat(lang || "ja", {
    timeZone: "Asia/Tokyo",
    month: "long",
    day: "numeric",
  }).format(new Date(`${date}T00:00:00+09:00`));
}

export default function VenueMeetHeading({
  venueRaces,
  date,
  isToday,
  liveNextIndex,
  gridRef,
}) {
  const { t, i18n } = useTranslation();
  const raws = venueRaces.map((r) => r.rawData);
  const first = raws[0];
  const grade = gradeConfigOf(first?.raceGrade);
  const title = first?.raceTitle?.normalize("NFKC").trim() || null;
  const dayLabel = getVenueSeriesDayLabel(raws, t);
  const dateText = monthDayText(date, i18n.resolvedLanguage);
  const items = venueRaceJumpItems(venueRaces, liveNextIndex, isToday);

  const jumpTo = (index) =>
    holdScrollPosition(
      () => gridRef.current?.querySelectorAll(":scope > .race-card")[index],
      gridRef.current,
    );

  return (
    <div className="venue-meet-heading" data-testid="venue-meet-heading">
      {(grade || title) && (
        <p className="venue-meet-heading__meet">
          {grade && (
            <span
              className="venue-meet-heading__grade"
              style={{ background: grade.color }}
            >
              {grade.label}
            </span>
          )}
          {/* 節タイトルは公式の固有名なので訳さない（i18n-glossary「レース種別」） */}
          {title && (
            <span className="venue-meet-heading__title" translate="no">
              {title}
            </span>
          )}
        </p>
      )}
      <p className="venue-meet-heading__day">
        {dayLabel ? `${dateText} / ${dayLabel}` : dateText}
      </p>
      <nav
        className="venue-meet-heading__races"
        aria-label={t("venueRaceList.title")}
      >
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={`venue-meet-heading__race${item.state ? ` is-${item.state}` : ""}`}
            aria-current={item.state === "next" ? "true" : undefined}
            onClick={() => jumpTo(index)}
          >
            {item.raceNumber}R
          </button>
        ))}
      </nav>
    </div>
  );
}
