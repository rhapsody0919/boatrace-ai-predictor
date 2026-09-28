/**
 * RaceBeforeInfoTab - レース詳細ページ「直前情報」タブ（BOA-304）
 *
 * DataRaceTable（基本情報、過去実績系）から「当日更新・レース前は未確定」の
 * 4指標（展示ST・展示タイム・チルト・調整重量）を分離し、性質の異なるデータを
 * 混在させない。あわせて表示欠落だった気象情報（race_conditions）を追加し、
 * モーター調子ドリルダウン（BOA-221、部品交換/プロペラ交換履歴）への参照導線を
 * 置く。選手コメント（BOA-273未実装）・今節展示情報の周回/周り足/直線タイム
 * 内訳（BOA-266）・スタート展示の並び（BOA-290）・潮汐（BOA-295）はデータが
 * 無いためスコープ外（ダミー表示は作らない）。
 *
 * 行の定義・レンダリングロジックはDataRaceTableと同じraceIndicators.jsx
 * （buildBeforeInfoRows）を共有し、二重実装を避ける。
 *
 * 2026-09-16追記(ユーザーによる日和再調査後のフィードバック): 除外理由の無い
 * 抜けが4つ見つかったため追加した。いずれも新規スクレイピング不要、既存データの
 * 集計のみ:
 * - 平均進入順・展示タイム1位勝率: RaceBasicInfoTab（BOA-306）と同じ
 *   getRacerScopedRaceStats(racerId)の生データ（既にactualCourse/
 *   isFastestExhibitionを追加済み）をこのタブでも取得し、basicInfoStats.jsの
 *   computeAvgEntryCourse/computeExhibitionTopRatesで集計する
 * - 今節展示情報（展示タイムのみ）: racerService.getCurrentMeetRaceEntriesと
 *   同じ節判定（groupIntoCurrentMeet）を使うgetRacerMeetExhibitionTrendBefore
 *
 * 2026-09-24（phase a FR-5 / BOA-222）に「本日の成績サマリー」をこのタブから
 * 外した。粒度（レース単位ではなく会場×当日単位）と更新タイミング（発走前に
 * 確定していくのではなく、レースが終わるたびに増える事後集計）が、このタブの
 * 他の項目とずれていたため。移設先は結果タブ（払戻の下）と会場ページで、
 * 実装は VenueDaySummaryCard。getVenueDaySummary の呼び出しもそちらへ移した
 */
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  BarChart,
  Bar,
  Cell,
  LabelList,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { BOAT_COLORS } from "../../utils/colors";
import { useRaceAnalysisData } from "../../hooks/useRaceAnalysisData";
import { useHorizontalScrollHint } from "../../hooks/useHorizontalScrollHint";
import { supabaseDataService } from "../../services/supabaseDataService";
import {
  buildBeforeInfoRows,
  originalExhibitionKindLabels,
  toNumber,
} from "./raceIndicators";
import {
  computeAvgEntryCourse,
  computeExhibitionTopRates,
  SMALL_SAMPLE_THRESHOLD,
} from "./basicInfoStats";
import {
  formatObservedTime,
  translateWeather,
  translateWindDirection,
  weatherIcon,
} from "./weatherInfo";
import { trackEvent } from "../../utils/analytics";
import TermHintButton from "./TermHintButton";
import RacePitReportSection from "./RacePitReportSection";
import InlineFetchError from "../InlineFetchError";
import "./RaceBeforeInfoTab.css";
import "../common/HorizontalScrollHint.css";
import { formatCapturedAtJst } from "../../utils/formatters";

function RaceBeforeInfoTab({
  raceId,
  venueCode,
  players,
  weather,
  raceGrade,
  isFinished = false,
}) {
  const { t } = useTranslation();
  const analysis = useRaceAnalysisData(raceId, { venueCode });

  const sortedPlayers = [...(players ?? [])].sort(
    (a, b) => a.number - b.number,
  );

  // 平均進入順・展示タイム1位勝率用: 基本情報タブ(BOA-306)と同じgetRacerScopedRaceStats
  // を選手ごとに取得する（withCacheで基本情報タブと同一キャッシュを共有するため、
  // 既にどちらかのタブを開いていれば再取得は発生しない）
  const [scopedStatsByRacer, setScopedStatsByRacer] = useState({});
  useEffect(() => {
    let cancelled = false;
    sortedPlayers.forEach((p) => {
      if (!p.racerId) return;
      supabaseDataService
        .getRacerScopedRaceStats(p.racerId)
        .then((data) => {
          if (!cancelled)
            setScopedStatsByRacer((prev) => ({ ...prev, [p.racerId]: data }));
        })
        .catch((err) => {
          // 取得失敗時にscopedStatsByRacer[p.racerId]が永久にundefinedのまま
          // 残ると「平均進入順」「展示タイム1位勝率」が読み込み中のまま固まる
          // （RaceBasicInfoTab.jsxの同種の指摘と同じ問題、2026-09-16修正）
          console.error("選手出走履歴取得エラー:", err?.message ?? String(err));
          if (!cancelled)
            setScopedStatsByRacer((prev) => ({ ...prev, [p.racerId]: [] }));
        });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceId]);

  // 今節展示情報用: 選手ごとに「このレースより前・同一モーターの今節」の展示タイム推移を取得する
  const [meetTrendByRacer, setMeetTrendByRacer] = useState({});
  useEffect(() => {
    let cancelled = false;
    sortedPlayers.forEach((p) => {
      if (!p.racerId || !p.motorNumber || !raceId) return;
      supabaseDataService
        .getRacerMeetExhibitionTrendBefore(p.racerId, p.motorNumber, raceId)
        .then((data) => {
          if (!cancelled)
            setMeetTrendByRacer((prev) => ({ ...prev, [p.racerId]: data }));
        })
        .catch((err) => {
          // catchしないとmeetTrendByRacer[p.racerId]がundefinedのまま残り、
          // 今節展示情報のセルがスケルトンのまま固まる（上のscopedStatsと同じ扱い）
          console.error("今節展示情報取得エラー:", err?.message ?? String(err));
          if (!cancelled)
            setMeetTrendByRacer((prev) => ({ ...prev, [p.racerId]: [] }));
        });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceId]);

  // オリジナル展示（一周/半周ラップ/まわり足/直線、BOA-452 / FR-4b）。
  // BOATCAST由来の生値なので、表示するときは必ず出典を添える（ADR-0067）。
  // 096が未適用の間は state==="forbidden" が返り、行も出典も出さない
  // **raceIdとセットで持つ**（RacePitReportSection と同じ）。レース詳細は
  // ボトムナビで次のレースへ移ってもこのコンポーネントが再マウントされず、
  // raceId プロップだけが変わる。値だけを持つと、新しい取得が返るまでの間、
  // 展示ST・展示タイムは新レース・一周/まわり足/直線は前レース、という
  // 1つの表の中で別レースの数字が混ざった状態になる
  const [fetchedExhibition, setFetchedExhibition] = useState(null);
  useEffect(() => {
    if (!raceId) return undefined;
    let cancelled = false;
    supabaseDataService
      .getRaceOriginalExhibition(raceId)
      .then((data) => {
        if (!cancelled) setFetchedExhibition({ raceId, data });
      })
      .catch((err) => {
        // 取得失敗でこのタブの他の行まで巻き込まない。行が出ないだけにする
        console.error("オリジナル展示取得エラー:", err?.message ?? String(err));
        if (!cancelled) setFetchedExhibition({ raceId, data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [raceId]);
  const originalExhibition =
    fetchedExhibition?.raceId === raceId ? fetchedExhibition.data : null;

  // 展示前の体重（出走表の体重、BOA-484）。オリジナル展示と同じく raceId とセットで持ち、
  // 失敗も state として残す（取得失敗を「未公開」「値なし」に化けさせない。frontend-data-fetch.md）。
  // reloadKey は InlineFetchError の再試行用（RacePitReportSection と同じ方式）
  const [fetchedEntryWeights, setFetchedEntryWeights] = useState(null);
  const [entryWeightsReloadKey, setEntryWeightsReloadKey] = useState(0);
  useEffect(() => {
    if (!raceId) return undefined;
    let cancelled = false;
    supabaseDataService
      .getRaceEntryWeights(raceId)
      .then((data) => {
        if (!cancelled) setFetchedEntryWeights({ raceId, data });
      })
      .catch((err) => {
        console.error("出走表の体重の取得エラー:", err?.message ?? String(err));
        if (!cancelled)
          setFetchedEntryWeights({ raceId, data: { state: "error" } });
      });
    return () => {
      cancelled = true;
    };
  }, [raceId, entryWeightsReloadKey]);
  const entryWeights =
    fetchedEntryWeights?.raceId === raceId
      ? fetchedEntryWeights.data
      : { state: "loading" };

  // 展示情報の表は390pxで5号艇までしか入らない。**早期returnより前**に
  // 置く（フックの呼び出し順は毎回同じでなければならない）
  const detailScroll = useHorizontalScrollHint([sortedPlayers.length]);

  if (sortedPlayers.length === 0) return null;

  const smallSampleClass = (n) =>
    n !== null && n > 0 && n < SMALL_SAMPLE_THRESHOLD
      ? "drt-n-small-sample"
      : "";

  const extraRows = [
    {
      key: "avgEntryCourse",
      label: t("beforeInfo.rowAvgEntryCourse"),
      shortLabel: t("beforeInfo.rowAvgEntryCourseShort"),
      tab: null,
      best: null,
      render: (p) => {
        if (!p.racerId) return "—";
        const state = scopedStatsByRacer[p.racerId];
        if (state === undefined)
          return <span className="drt-skeleton" aria-hidden="true" />;
        const { n, avgCourse } = computeAvgEntryCourse(state ?? []);
        if (avgCourse === null) return "—";
        return (
          <span className="drt-value">
            {avgCourse.toFixed(2)}
            <span className={`drt-sub ${smallSampleClass(n)}`}>
              {t("beforeInfo.sampleCount", { n })}
            </span>
          </span>
        );
      },
    },
    {
      key: "exhibitionTopRate",
      label: t("beforeInfo.rowExhibitionTopRate"),
      shortLabel: t("beforeInfo.rowExhibitionTopRateShort"),
      tab: null,
      best: null,
      render: (p) => {
        if (!p.racerId) return "—";
        const state = scopedStatsByRacer[p.racerId];
        if (state === undefined)
          return <span className="drt-skeleton" aria-hidden="true" />;
        const rates = computeExhibitionTopRates(state ?? []);
        if (rates.n === 0)
          return (
            <span className="drt-sub">
              {t("beforeInfo.noFastestExhibition")}
            </span>
          );
        return (
          <span className="drt-value">
            <span className="drt-sub">
              {t("beforeInfo.winRateAbbrev")} {rates.winRate.toFixed(0)}%
            </span>
            <span className="drt-sub">
              {t("beforeInfo.top2RateAbbrev")} {rates.top2Rate.toFixed(0)}%
            </span>
            <span className="drt-sub">
              {t("beforeInfo.top3RateAbbrev")} {rates.top3Rate.toFixed(0)}%
            </span>
            <span className={`drt-sub ${smallSampleClass(rates.n)}`}>
              {t("beforeInfo.sampleCount", { n: rates.n })}
            </span>
          </span>
        );
      },
    },
    {
      key: "meetExhibitionTrend",
      label: t("beforeInfo.rowMeetExhibition"),
      shortLabel: t("beforeInfo.rowMeetExhibitionShort"),
      tab: null,
      best: null,
      render: (p) => {
        if (!p.racerId || !p.motorNumber) return "—";
        const state = meetTrendByRacer[p.racerId];
        if (state === undefined)
          return <span className="drt-skeleton" aria-hidden="true" />;
        const trend = (state ?? []).filter((e) => e.exhibitionTime !== null);
        if (trend.length === 0)
          return (
            <span className="drt-sub">{t("dataTable.prevResultNoRace")}</span>
          );
        const prev = trend[trend.length - 1].exhibitionTime;
        const avg =
          trend.reduce((sum, e) => sum + e.exhibitionTime, 0) / trend.length;
        return (
          <span className="drt-value">
            <span className="drt-sub">
              {t("beforeInfo.prevAbbrev")} {prev.toFixed(2)}
            </span>
            <span className="drt-sub">
              {t("beforeInfo.avgAbbrev")} {avg.toFixed(2)}
            </span>
          </span>
        );
      },
    },
  ];

  const rows = [
    ...buildBeforeInfoRows({
      t,
      players: sortedPlayers,
      analysis,
      pending: analysis.pending,
      originalExhibition,
      entryWeights,
    }),
    ...extraRows,
  ];

  const deepLink = (tab) =>
    venueCode && raceId
      ? `/winning-technique?venue_code=${venueCode}&race_id=${raceId}&tab=${tab}`
      : `/winning-technique?tab=${tab}`;

  const onLinkClick = (tab) => () =>
    trackEvent("deep_link_click", {
      tab,
      link_source: "race_before_info_tab",
    });

  // 展示前の注記（BOA-484）: 体重・調整重量が出ていて、チルトがまだ1艇も出ていない間。
  // チルトは展示航走の後に公開される（2026-09-28、9会場の展示前ページで全て空欄を確認）ため、
  // 「—」を未取得の不具合と読まれないようにする。展示後（チルトが出た後）は出さない。
  // 直前情報の設定値（exhibition_data）の取得に失敗したときは、チルトが無いのは
  // 「未公開」ではなく「取得失敗」なので出さない（失敗は上部の InlineFetchError が示す）。
  // 確定済みのレース（展示データが最後まで入らなかった中止・取得漏れ等）にも出さない
  const maintenanceRows = analysis.motorMaintenance ?? [];
  const tiltPublished = maintenanceRows.some((r) => toNumber(r.tilt) !== null);
  const hasPreExhibitionWeight =
    maintenanceRows.some(
      (r) =>
        toNumber(r.today_weight) !== null ||
        toNumber(r.adjustment_weight) !== null,
    ) ||
    (entryWeights.state === "published" &&
      Object.keys(entryWeights.byBoat ?? {}).length > 0);
  const showPreExhibitionNote =
    !isFinished &&
    !analysis.pending?.motorMaintenance &&
    !analysis.failed?.motorMaintenance &&
    !tiltPublished &&
    hasPreExhibitionWeight;

  const cellClass = (boat, best) =>
    `drt-cell ${best !== null && boat === best ? "drt-best" : ""}`;

  // 展示タイム棒グラフ用データ（艇番順、未取得艇はnullのままバーを描かない）
  const exhibitionByBoat = new Map(
    (analysis.exhibitionTime ?? []).map((r) => [r.boat_number, r]),
  );
  const exhibitionChartData = sortedPlayers.map((p) => {
    const row = exhibitionByBoat.get(p.number);
    return {
      boat: p.number,
      name: t("analysis.boatN", { n: p.number }),
      time: row?.exhibition_time != null ? toNumber(row.exhibition_time) : null,
    };
  });
  const hasExhibitionChartData = exhibitionChartData.some(
    (d) => d.time !== null,
  );
  // 展示タイムは**小さいほど速い**のに、素の値で棒を立てると
  // 「棒が高い＝いい」と読まれる（一番高い棒が実は一番遅い艇）。
  // 2026-09-27のファン視点レビューで実害として挙がったので、
  // 棒の長さを「最も遅い艇との差」にして**長いほど速い**に直した。
  // 数字は各棒の上に実タイムを出すので、読み取れる情報は減らない。
  const exhibitionTimes = exhibitionChartData
    .map((d) => d.time)
    .filter((v) => v !== null);
  const slowestExhibition =
    exhibitionTimes.length > 0 ? Math.max(...exhibitionTimes) : null;
  const fastestExhibition =
    exhibitionTimes.length > 0 ? Math.min(...exhibitionTimes) : null;
  const exhibitionLeadData = exhibitionChartData.map((d) => ({
    ...d,
    // 最も遅い艇は差が0で棒が消えるため、最小の下駄（0.01秒相当）を履かせる。
    // ラベルは実タイムなので数字は歪まない
    lead: d.time === null ? null : slowestExhibition - d.time + 0.01,
    timeLabel: d.time === null ? "" : d.time.toFixed(2),
    isFastest: d.time !== null && d.time === fastestExhibition,
  }));

  const weatherItems = weather
    ? [
        weather.weather && {
          key: "weather",
          icon: weatherIcon(weather.weather),
          value: translateWeather(t, weather.weather),
          label: t("beforeInfo.weatherLabel"),
        },
        weather.temperature !== null && {
          key: "temperature",
          icon: "🌡️",
          value: `${weather.temperature.toFixed(1)}℃`,
          label: t("beforeInfo.temperatureLabel"),
        },
        (weather.windSpeed !== null || weather.windDirection) && {
          key: "wind",
          icon: "💨",
          value: [
            weather.windSpeed !== null
              ? `${weather.windSpeed.toFixed(1)}m`
              : null,
            weather.windDirection
              ? translateWindDirection(t, weather.windDirection)
              : null,
          ]
            .filter(Boolean)
            .join(" / "),
          label: t("beforeInfo.windLabel"),
        },
        weather.waterTemperature !== null && {
          key: "waterTemperature",
          icon: "🌊",
          value: `${weather.waterTemperature.toFixed(1)}℃`,
          label: t("beforeInfo.waterTemperatureLabel"),
        },
        weather.waveHeight !== null && {
          key: "waveHeight",
          icon: "🌀",
          value: `${weather.waveHeight}cm`,
          label: t("beforeInfo.waveHeightLabel"),
        },
      ].filter(Boolean)
    : [];

  // 気象の観測時刻（あれば「10:34現在」を見出しに添える。無ければ従来どおり何も出さない）
  const weatherObservedTime = formatObservedTime(weather?.observedAt);

  return (
    <div className="race-before-info-tab" id="race-before-info-tab">
      <p className="rbi-subtitle">{t("beforeInfo.subtitle")}</p>

      {/* 取得失敗を「—」の羅列（データなし）に化けさせない（BOA-359） */}
      {analysis.hasFailure && <InlineFetchError onRetry={analysis.reload} />}

      {weatherItems.length > 0 && (
        <section className="rbi-card">
          <h3 className="rbi-heading">
            {t("beforeInfo.weatherTitle")}
            {weatherObservedTime && (
              <span className="rbi-observed-at" data-testid="rbi-observed-at">
                {t("beforeInfo.weatherObservedAt", {
                  time: weatherObservedTime,
                })}
              </span>
            )}
          </h3>
          <div className="rbi-weather-grid">
            {weatherItems.map((item) => (
              <div className="rbi-weather-item" key={item.key}>
                <span className="rbi-weather-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="rbi-weather-value">{item.value}</span>
                <span className="rbi-weather-label">{item.label}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rbi-card">
        <h3 className="rbi-heading">
          {t("beforeInfo.exhibitionChartTitle")}
          {analysis.loading && (
            <span className="drt-loading-chip">{t("dataTable.loading")}</span>
          )}
        </h3>
        {hasExhibitionChartData ? (
          <>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={exhibitionLeadData}
                margin={{ top: 20, right: 16, left: 0, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                {/* 縦軸は「最も遅い艇との差」で、目盛りの数字そのものに
                    意味が無いので出さない。実タイムは棒の上に出す */}
                <YAxis hide domain={[0, "dataMax + 0.02"]} />
                <Tooltip
                  formatter={(value, _name, item) =>
                    item?.payload?.time != null
                      ? `${item.payload.time.toFixed(2)}${t("beforeInfo.secondsUnit")}`
                      : "—"
                  }
                />
                <Bar dataKey="lead" radius={[4, 4, 0, 0]}>
                  <LabelList
                    dataKey="timeLabel"
                    position="top"
                    style={{ fontSize: 11, fill: "var(--text-primary)" }}
                  />
                  {exhibitionLeadData.map((d) => (
                    <Cell
                      key={d.boat}
                      fill={
                        BOAT_COLORS[d.boat]?.bg || "var(--brand-accent-primary)"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="rbi-chart-note">
              {t("beforeInfo.exhibitionChartNote")}
            </p>
          </>
        ) : (
          <p className="rbi-empty">{t("beforeInfo.exhibitionChartEmpty")}</p>
        )}
      </section>

      <section className="rbi-card">
        <h3 className="rbi-heading">{t("beforeInfo.detailTableTitle")}</h3>
        {/* 6艇×多指標の表は390pxだと5号艇までで切れ、**6号艇が存在しない
            ように見える**（2026-09-27、ファン視点のレビューで実測）。
            切れていることが分かる手がかりを出す */}
        <div
          className={`hscroll-hint${detailScroll.hasMore ? " has-more" : ""}`}
        >
          {detailScroll.hasMore && (
            <button
              type="button"
              className="hscroll-more"
              onClick={detailScroll.scrollRight}
              aria-hidden="true"
              tabIndex={-1}
            >
              ›
            </button>
          )}
          <div
            className="drt-table-wrapper"
            ref={detailScroll.ref}
            onScroll={detailScroll.update}
          >
            <table className="drt-table">
              <thead>
                <tr>
                  <th className="drt-label-th"></th>
                  {sortedPlayers.map((p) => {
                    const color = BOAT_COLORS[p.number] || {};
                    return (
                      <th
                        key={p.number}
                        className="drt-boat-th"
                        style={{ background: color.bg, color: color.text }}
                      >
                        {p.number}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <td className="drt-label-cell">
                      {row.tab ? (
                        <Link
                          to={deepLink(row.tab)}
                          className="drt-label-link"
                          onClick={onLinkClick(row.tab)}
                        >
                          <span className="drt-label-full">{row.label}</span>
                          <span className="drt-label-short">
                            {row.shortLabel}
                          </span>
                          <span className="drt-link-arrow">›</span>
                        </Link>
                      ) : (
                        <>
                          <span className="drt-label-full">{row.label}</span>
                          <span className="drt-label-short">
                            {row.shortLabel}
                          </span>
                        </>
                      )}
                      <TermHintButton termKey={row.key} />
                    </td>
                    {sortedPlayers.map((p) => (
                      <td
                        key={p.number}
                        className={cellClass(p.number, row.best)}
                      >
                        {row.render(p)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {/* 出走表の体重の取得失敗は、展示前の体重を出せないときだけ示す
            （全艇に直前情報の体重があれば、表示に影響しないため） */}
        {entryWeights.state === "error" &&
          !sortedPlayers.every(
            (p) =>
              toNumber(
                (analysis.motorMaintenance ?? []).find(
                  (r) => r.boat_number === p.number,
                )?.today_weight,
              ) !== null,
          ) && (
          <InlineFetchError
            message={t("beforeInfo.entryWeightFetchError")}
            onRetry={() => setEntryWeightsReloadKey((k) => k + 1)}
          />
        )}
        {showPreExhibitionNote && (
          <p className="rbi-note" data-testid="rbi-pre-exhibition-note">
            {t("beforeInfo.preExhibitionNote")}
          </p>
        )}
        <p className="rbi-note">💡 {t("beforeInfo.detailTableNote")}</p>
        {/* オリジナル展示（BOA-452 / ADR-0067）の出典。値を出したときだけ、
            表のすぐ下に1回。ピットレポート（RacePitReportSection）と同じ形で、
            出典・取得時刻・再配布しない旨の3点を書く */}
        {originalExhibition?.state === "published" && (
          <div className="rbi-source">
            <p className="rbi-source-text">
              {t("beforeInfo.originalExhibitionSource", {
                items: originalExhibitionKindLabels(
                  t,
                  originalExhibition.kinds,
                ).join(t("beforeInfo.originalExhibitionItemSeparator")),
              })}
            </p>
            {formatCapturedAtJst(originalExhibition.capturedAt) && (
              <p className="rbi-source-text">
                {t("beforeInfo.originalExhibitionCapturedAt", {
                  time: formatCapturedAtJst(originalExhibition.capturedAt),
                })}
                {t("home.jstNote")}
              </p>
            )}
            <p className="rbi-source-text">
              {t("beforeInfo.originalExhibitionNote")}
            </p>
          </div>
        )}
      </section>

      <RacePitReportSection
        raceId={raceId}
        raceGrade={raceGrade}
        players={sortedPlayers}
      />

      <Link
        to={deepLink("motor")}
        className="rbi-motor-link"
        onClick={onLinkClick("motor")}
      >
        🔧 {t("beforeInfo.motorHistoryLink")} →
      </Link>
    </div>
  );
}

export default RaceBeforeInfoTab;
