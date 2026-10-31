import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabaseDataService } from "../../services/supabaseDataService";
import { useLocalizedPath } from "../../hooks/useLocalizedPath";
import {
  MEET_PAGE_GRADES,
  isOutOfScopeMeetTitle,
} from "../../utils/meetPageModel";
import InlineFetchError from "../InlineFetchError";
import "./RaceNumberStrip.css";

/**
 * レース詳細の 1R〜12R の帯（BOA-1189 GS01-c、2026-10-31 オーナー決定）。
 * a 要素（Link）で作り、検索のボットにも同じ会場の他のレースが辿れるようにする（既存の
 * RaceNavCard・RaceBottomNav は button のため、今回は残したまま別の部品にした）。
 * SG/G1/G2 の節（グランプリ・クイーンズクライマックス・トーナメントを除く。節ページと同じ判定）の
 * 日は、節ページ（/venue/N/meet/初日）へのリンクを1つ足す。初日は race_series から引く
 */
export default function RaceNumberStrip({
  races,
  currentRaceId,
  venueCode,
  date,
  raceGrade = null,
  raceTitle = null,
}) {
  const { t } = useTranslation();
  const localize = useLocalizedPath();
  // 取得結果は鍵（会場・日）とセットで持つ。会場を移ったときに前の節のリンクが残らないようにする
  const key = `${venueCode}-${date}`;
  const [loaded, setLoaded] = useState(null);
  const [failedKey, setFailedKey] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  // レースのグレードが分かっていて SG/G1/G2 でなければ、節は引かない（一般戦・G3 でリンクは出ない）。
  // 分からないときだけ引く
  const needsSeries = !raceGrade || MEET_PAGE_GRADES.includes(raceGrade);

  useEffect(() => {
    if (!needsSeries) return undefined;
    let cancelled = false;
    supabaseDataService
      .getSeriesOfDate(venueCode, date)
      .then((series) => {
        if (cancelled) return;
        setLoaded({ key, series });
        setFailedKey(null);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("節（race_series）の取得に失敗:", err);
        setFailedKey(key);
      });
    return () => {
      cancelled = true;
    };
  }, [venueCode, date, key, reloadKey, needsSeries]);

  if (!races || races.length === 0) return null;

  const series = needsSeries && loaded?.key === key ? loaded.series : null;
  // 判定は節ページ（MeetPage の meetPageState）と同じく、節の値が無ければレースの値で補う
  const showMeetLink =
    series &&
    MEET_PAGE_GRADES.includes(series.grade ?? raceGrade) &&
    !isOutOfScopeMeetTitle(series.title ?? raceTitle);

  return (
    <nav
      className="race-number-strip"
      aria-label={t("raceStrip.label", { venue: t(`venues.${venueCode}`) })}
      data-testid="race-number-strip"
    >
      <ul className="race-number-strip__list">
        {races.map((r) => {
          const current = r.id === currentRaceId;
          return (
            <li key={r.id}>
              <Link
                to={localize(`/race/${r.id}`)}
                className={`race-number-strip__link${current ? " is-current" : ""}`}
                aria-current={current ? "page" : undefined}
              >
                {r.raceNumber}R
              </Link>
            </li>
          );
        })}
      </ul>
      {showMeetLink && (
        <Link
          to={localize(`/venue/${venueCode}/meet/${series.start_date}`)}
          className="race-number-strip__meet"
          data-testid="race-number-strip-meet"
        >
          {t("raceStrip.meetLink")}
        </Link>
      )}
      {needsSeries && failedKey === key && (
        <InlineFetchError
          message={t("raceStrip.meetFetchError")}
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      )}
    </nav>
  );
}
