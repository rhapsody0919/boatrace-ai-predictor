/**
 * 会場ページ（本日分）の、開催中の節のページ（/venue/:code/meet/:startDate、BOA-682）への帯（BOA-1189 GS02-b）。
 *
 * SG・G1・G2 の開催中だけ出す（節のページの対象と同じ MEET_PAGE_GRADES。グランプリ等の対象外の節は出さない）。
 * 開催中かどうかは今日のレース（先頭レースのグレードと節タイトル。title の判定・会場カードのバッジと同じ代表値）で決め、
 * 節の初日は race_series から引く（レース詳細の帯と同じ getSeriesOfDate。順延で予定の最終日より後に走る日も同じ節）。取得に失敗したら、帯が無いのと区別して InlineFetchError を出す。
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabaseDataService } from "../../services/supabaseDataService";
import { useLocalizedPath } from "../../hooks/useLocalizedPath";
import { meetBannerSeriesOf } from "../../utils/meetPageModel";
import InlineFetchError from "../InlineFetchError";
import "./VenueMeetBanner.css";

export default function VenueMeetBanner({ venueCode, races, today }) {
  const { t } = useTranslation();
  const localize = useLocalizedPath();
  const series = meetBannerSeriesOf(races);
  const key = series ? `${venueCode}-${today}` : null;
  // 取得結果は会場・日付のキーとセットで持つ（会場を移ったときに前の会場の帯が混ざらない）
  const [loaded, setLoaded] = useState({ key: null, startDate: null });
  const [failedKey, setFailedKey] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    supabaseDataService
      .getSeriesOfDate(venueCode, today)
      .then((meet) => {
        const startDate = meet?.start_date ?? null;
        if (cancelled) return;
        setFailedKey(null);
        setLoaded({ key, startDate });
      })
      .catch((err) => {
        console.error("開催中の節の取得に失敗", err?.message ?? String(err));
        if (!cancelled) setFailedKey(key);
      });
    return () => {
      cancelled = true;
    };
  }, [key, venueCode, today, reloadKey]);

  if (!series) return null;
  if (failedKey === key) {
    return (
      <InlineFetchError
        message={t("venueMeetBanner.fetchError")}
        onRetry={() => {
          setFailedKey(null);
          setReloadKey((n) => n + 1);
        }}
      />
    );
  }
  if (loaded.key !== key || !loaded.startDate) return null;

  return (
    <Link
      to={localize(`/venue/${venueCode}/meet/${loaded.startDate}`)}
      className="venue-meet-banner"
      data-testid="venue-meet-banner"
    >
      <span className="venue-meet-banner__series">
        {/* 節タイトルは公式の固有名なので訳さない（i18n-glossary「レース種別」） */}
        <span translate="no">
          {series.title ? `${series.grade} ${series.title}` : series.grade}
        </span>{" "}
        {t("venueMeetBanner.inProgress")}
      </span>
      <span className="venue-meet-banner__link">
        {t("venueMeetBanner.link")} →
      </span>
    </Link>
  );
}
