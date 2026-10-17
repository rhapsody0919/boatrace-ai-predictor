/**
 * TodaysVolatilityHighlights - 本日のイン崩れ注意度ハイライト
 * ホーム画面の会場グリッド直前に表示し、当日全レースをイン崩れ指数（unified予想モデルの
 * feature_contributions.volatilityPercentile、get_today_races RPC経由）でソートして
 * 上位（注意度が高い）・下位（注意度が低い）を提示する。
 * scripts/daily/todays-volatility-digest.js（SNS投稿用ダイジェスト）と同じ
 * predictions.feature_contributions.volatilityPercentileが情報源のため、
 * Web/SNS間で表示内容が食い違うことはない。
 *
 * BOA-822（機能フラグ isInCautionEnabled() の側）: イン崩れ注意度（get_today_races の inCaution、朝の生成が保存した pct・level）
 * で並べる。列は崩れやすい（高い順）と堅め（低い順）、値は割合と段の札（承認モック mock/2-lists-375.png）。
 * フラグの外は今のまま（旧指数）。
 */
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLocalizedPath } from "../../hooks/useLocalizedPath";
import { getRaceId } from "../../utils/raceId";
import { isRaceCancelled } from "../../utils/raceCancellation";
import {
  getVolatilityLevel,
  volatilityDisplayValue,
} from "../../utils/volatilityLevel";
import { getRaceStatus, RACE_STATUS } from "../../utils/raceStatus";
import { pickVolatilityHighlights } from "../../utils/volatilityHighlights";
import { isInCautionEnabled } from "../../config/featureFlags";
import InCautionBadge from "./InCautionBadge";
import { trackEvent } from "../../utils/analytics";
import { useVisibleOnce } from "../../hooks/useVisibleOnce";
import {
  cautionClickEvent,
  cautionVisibleEvent,
} from "../../utils/cautionEvents";

/** ホームの注意度の欄から送る（BOA-822 task 27、measurement.md の home_highlight） */
const sendHomeCaution = (input) => {
  const ev = input.target
    ? cautionClickEvent({ surface: "home_highlight", ...input })
    : cautionVisibleEvent({ surface: "home_highlight" });
  if (ev) trackEvent(ev.name, ev.params);
};
import "./TodaysVolatilityHighlights.css";

const HIGHLIGHT_COUNT = 5;

/** 締切を過ぎたか（結果が出たレースも含む）。締切前のレースから選ぶために使う（BOA-757） */
const isClosed = (race, nowHHMM) =>
  getRaceStatus({ startTime: race.startTime, result: race.result }, nowHHMM) !==
  RACE_STATUS.UPCOMING;

/** BOA-822: イン崩れ注意度で並べるレース。値の無いレース（中止・1号艇の欠場など）は入れない */
function flattenInCautionRaces(venuesData, nowHHMM) {
  const races = [];
  for (const venue of venuesData || []) {
    for (const race of venue.races || []) {
      if (isRaceCancelled(race)) continue;
      const ic = race.inCaution;
      if (!ic || typeof ic.pct !== "number") continue;
      races.push({
        raceId: getRaceId({ rawData: race }),
        venueName: venue.placeName,
        raceNo: race.raceNo,
        startTime: race.startTime || null,
        pct: ic.pct,
        // 段は朝の生成が保存した値をそのまま使う（画面で閾値をかけ直さない、plan §1）
        level: ic.level,
        closed: isClosed(race, nowHHMM),
        rank1: race.result?.rank1 ?? null,
      });
    }
  }
  return races;
}

function flattenRaces(venuesData, nowHHMM) {
  const races = [];
  for (const venue of venuesData || []) {
    for (const race of venue.races || []) {
      // 開催中止・打ち切り確定のレースは注目レースとして提示しない
      // （BOA-411調査中に発見。isCancelledの判定基準はPredictionPanel.jsx/
      // RaceCard.jsxと同じくconfirmedのみ。tentativeは暫定検知でまだ確定していないため対象外）。
      // 結果（result.rank1）があれば confirmed が残っていても中止扱いしない（BOA-525）。
      // result は get_today_races（110）と直接クエリの代替経路の両方が返す（BOA-542）。
      // 110 が未適用の間は result が届かず、従来どおり confirmed だけで決まる
      if (isRaceCancelled(race)) continue;
      // isFallbackは会場内サンプル数不足によるプレースホルダ値（0.5）のため、
      // 「注意度が高い/低い」の根拠として提示すると誤解を招く。除外する
      if (!race.volatility || race.volatility.isFallback) continue;
      if (typeof race.volatility.percentile !== "number") continue;
      races.push({
        raceId: getRaceId({ rawData: race }),
        venueName: venue.placeName,
        raceNo: race.raceNo,
        startTime: race.startTime || null,
        percentile: race.volatility.percentile,
        // 列に入れるかの段階（レース詳細と同じ基準）
        level: getVolatilityLevel(race.volatility.percentile),
        // 締切を過ぎたか（結果が出たレースも含む）。締切前のレースから選ぶために使う（BOA-757）
        closed: isClosed(race, nowHHMM),
        // 1着の艇番（結果が出ていれば）。締切済みのレースの振り返りに出す
        rank1: race.result?.rank1 ?? null,
      });
    }
  }
  return races;
}

// 列が空でも見出しと「該当なし」を出す。列ごと消すと、崩れ注意のレースが無いのか読み込めていないのかが
// 分からず、1440px では残った列が全幅に伸びた（PR #1248 ファン評価2周目）
function HighlightList({ title, races, emptyText, t, onRaceClick = null }) {
  return (
    <div className="volatility-highlights__column">
      <h3 className="volatility-highlights__column-title">{title}</h3>
      {races.length === 0 ? (
        <p className="volatility-highlights__empty">{emptyText}</p>
      ) : (
        <ul className="volatility-highlights__list">
          {races.map((race) => (
            <li key={race.raceId}>
              <RaceLink race={race} t={t} onRaceClick={onRaceClick} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RaceLink({ race, t, onRaceClick = null }) {
  const localize = useLocalizedPath();
  return (
    <Link
      // 注意度の行は AI予想タブ（注意度のカード）を開く（2026-10-18 オーナー決定）。旧指数の行は今のまま
      to={localize(
        `/race/${race.raceId}${race.pct != null ? "?tab=aiPrediction" : ""}`,
      )}
      className="volatility-highlights__race-link"
      onClick={onRaceClick ? () => onRaceClick(race) : undefined}
    >
      <div className="volatility-highlights__race-main">
        <span translate="no">
          {race.venueName} {race.raceNo}R
          {race.startTime && (
            <span className="volatility-highlights__time">
              {" "}
              {race.startTime}
            </span>
          )}
          {race.closed && (
            <span className="volatility-highlights__closed">
              {t("home.volatilityHighlightsClosed")}
            </span>
          )}
        </span>
        {/* 「100%」は確率に読まれた。レース詳細の比較バーと同じく「100 / 100」（0〜100 の物差し）で
            出し、値もバーと同じ丸め方にする（2026-10-03 ユーザー判断、BOA-711 U4） */}
        {race.pct != null ? (
          <span className="volatility-highlights__percentile">
            {race.pct}% <InCautionBadge level={race.level} />
          </span>
        ) : (
          <span className="volatility-highlights__percentile">
            {volatilityDisplayValue(race.percentile)}
            <span className="volatility-highlights__percentile-max">
              {t("volatility.percentileBarMax100")}
            </span>
          </span>
        )}
      </div>
      {/* 展開予測（最有力の展開）は出さない。ほぼ全レースが「① 逃げ」で見分けに使えず、同じ会場内の
          相対値である崩れやすさと並ぶと、「イン崩れ注意（高）」の列で逃げが最有力と言っているように
          見えた（PR #1248 ファン評価1・2周目、ユーザー判断で外した）。展開は各レースの AI予想タブで見る */}
      {/* 締切済みのレースは結果も出す（振り返り）。「結果: 3号艇が1着」と結果だと分かる形にする。
          進入コースはホームのデータ（get_today_races）に無いので出さない */}
      {race.closed && (
        <div className="volatility-highlights__result">
          {race.rank1 != null
            ? t("home.volatilityHighlightsResult", { boat: race.rank1 })
            : t("home.volatilityHighlightsResultPending")}
        </div>
      )}
    </Link>
  );
}

function TodaysVolatilityHighlights({ venuesData, nowHHMM = null }) {
  const { t } = useTranslation();
  if (isInCautionEnabled())
    return <InCautionHighlights venuesData={venuesData} nowHHMM={nowHHMM} />;

  const {
    high: highRaces,
    low: lowRaces,
    allClosed,
    poolSize,
  } = pickVolatilityHighlights(
    flattenRaces(venuesData, nowHHMM),
    HIGHLIGHT_COUNT,
  );
  if (poolSize === 0) return null;
  const emptyKey = allClosed ? "Closed" : "Open";

  return (
    <section className="volatility-highlights">
      <h2 className="volatility-highlights__title">
        {t("home.volatilityHighlightsTitle")}
      </h2>
      {/* 数字が確率に読まれないよう、物差しの意味を書く（BOA-711 U4 のファン評価1周目） */}
      <p className="volatility-highlights__scale-note">
        {t("home.volatilityHighlightsScaleNote")}
      </p>
      {/* 締切前のレースが残っていない時間帯（夜）だけ、振り返りとして出していることを書く */}
      {allClosed && (
        <p className="volatility-highlights__closed-note">
          {t("home.volatilityHighlightsClosedNote")}
        </p>
      )}
      <div className="volatility-highlights__columns">
        <HighlightList
          // アイコンはレース詳細のイン崩れ注意度カードと同じ 🌪️（2026-10-03 ユーザー判断、BOA-711）
          title={`🌪️ ${t("volatility.levelHigh")}`}
          races={highRaces}
          emptyText={t(`home.volatilityHighlightsHighEmpty${emptyKey}`)}
          t={t}
        />
        <HighlightList
          title={`🎯 ${t("volatility.levelLow")}`}
          races={lowRaces}
          emptyText={t(`home.volatilityHighlightsLowEmpty${emptyKey}`)}
          t={t}
        />
      </div>
      <AccuracyLink
        label={`📈 ${t("home.volatilityHighlightsAccuracyLink")}`}
      />
    </section>
  );
}

/** BOA-822: 今日のイン崩れ注意度（崩れやすい順・堅めの順の2列。行全体を押せる） */
function InCautionHighlights({ venuesData, nowHHMM }) {
  const { t } = useTranslation();
  const {
    high: highRaces,
    low: lowRaces,
    allClosed,
    poolSize,
  } = pickVolatilityHighlights(
    flattenInCautionRaces(venuesData, nowHHMM),
    HIGHLIGHT_COUNT,
    "pct",
  );
  // 欄が画面に入ったらページごとに1回（race_id・段なし）。行を押したらそのレースの段つき（BOA-822 task 27）
  const visibleRef = useVisibleOnce(
    poolSize > 0 ? "home_highlight" : null,
    () => sendHomeCaution({}),
  );
  const onRaceClick = (race) =>
    sendHomeCaution({
      target: "race",
      raceId: race.raceId,
      inCaution: { level: race.level },
    });
  if (poolSize === 0) return null;
  const emptyKey = allClosed ? "Closed" : "Open";
  return (
    <section
      className="volatility-highlights volatility-highlights--in-caution"
      ref={visibleRef}
    >
      <h2 className="volatility-highlights__title">
        {t("inCaution.home.title")}
      </h2>
      <p className="volatility-highlights__scale-note">
        {t("inCaution.listNote")}
      </p>
      {allClosed && (
        <p className="volatility-highlights__closed-note">
          {t("home.volatilityHighlightsClosedNote")}
        </p>
      )}
      <div className="volatility-highlights__columns">
        <HighlightList
          title={t("inCaution.home.highTitle")}
          races={highRaces}
          emptyText={t(`inCaution.home.highEmpty${emptyKey}`)}
          t={t}
          onRaceClick={onRaceClick}
        />
        <HighlightList
          title={t("inCaution.home.lowTitle")}
          races={lowRaces}
          emptyText={t(`inCaution.home.lowEmpty${emptyKey}`)}
          t={t}
          onRaceClick={onRaceClick}
        />
      </div>
      <AccuracyLink
        label={t("inCaution.home.accuracyLink")}
        onClick={() => sendHomeCaution({ target: "accuracy" })}
      />
    </section>
  );
}

// BOA-248: イン崩れ指数を根拠にレースを選んだユーザーが、その指数自体の
// 実測精度をすぐ確認できるよう、ハイライト直後に導線を置く
function AccuracyLink({ label, onClick }) {
  const localize = useLocalizedPath();
  return (
    <p className="volatility-highlights__accuracy-link">
      <Link to={localize("/accuracy")} onClick={onClick}>
        {label}
      </Link>
    </p>
  );
}

export default TodaysVolatilityHighlights;
