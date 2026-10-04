/**
 * TodaysVolatilityHighlights - 本日のイン崩れ注意度ハイライト
 * ホーム画面の会場グリッド直前に表示し、当日全レースをイン崩れ指数（unified予想モデルの
 * feature_contributions.volatilityPercentile、get_today_races RPC経由）でソートして
 * 上位（注意度が高い）・下位（注意度が低い）を提示する。
 * scripts/daily/todays-volatility-digest.js（SNS投稿用ダイジェスト）と同じ
 * predictions.feature_contributions.volatilityPercentileが情報源のため、
 * Web/SNS間で表示内容が食い違うことはない。
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
import { BOAT_COLORS } from "../../utils/colors";
import "./TodaysVolatilityHighlights.css";

const HIGHLIGHT_COUNT = 5;

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
        closed:
          getRaceStatus(
            { startTime: race.startTime, result: race.result },
            nowHHMM,
          ) !== RACE_STATUS.UPCOMING,
        // 1着の艇番（結果が出ていれば）。締切済みのレースの振り返りに出す
        rank1: race.result?.rank1 ?? null,
        // turnPrediction は get_today_races RPC（052マイグレーション）が返す場合のみ
        // 存在する。未適用環境ではundefinedのため、無いものとして扱う
        turnPrediction: race.turnPrediction || null,
      });
    }
  }
  return races;
}

function HighlightList({ title, races, t }) {
  if (races.length === 0) return null;
  return (
    <div className="volatility-highlights__column">
      <h3 className="volatility-highlights__column-title">{title}</h3>
      <ul className="volatility-highlights__list">
        {races.map((race) => (
          <li key={race.raceId}>
            <RaceLink race={race} t={t} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function RaceLink({ race, t }) {
  const localize = useLocalizedPath();
  const tp = race.turnPrediction;
  return (
    <Link
      to={localize(`/race/${race.raceId}`)}
      className="volatility-highlights__race-link"
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
        <span className="volatility-highlights__percentile">
          {volatilityDisplayValue(race.percentile)}
          <span className="volatility-highlights__percentile-max">
            {t("volatility.percentileBarMax100")}
          </span>
        </span>
      </div>
      {/* 展開予測でいちばん確率の高い1パターン。値は艇番として扱う（レース詳細の AI予想タブと同じく、
          艇色の丸数字で出す。的中も艇番で判定している）。「1コース逃げ」とコースで書いた版は、詳細の
          「① 逃げ」と別物に読めた（PR #1248 ファン評価1周目） */}
      {tp && typeof tp.probability === "number" && (
        <div className="volatility-highlights__turn">
          {t("home.volatilityHighlightsTurnLabel")}
          <span
            className="volatility-highlights__boat"
            style={{
              background: BOAT_COLORS[tp.winnerCourse]?.bg,
              color: BOAT_COLORS[tp.winnerCourse]?.text,
            }}
          >
            {tp.winnerCourse}
          </span>
          {t("home.volatilityHighlightsTurnBody", {
            technique: t(`techniques.${tp.technique}`, tp.technique),
            probability: Math.round(tp.probability * 100),
          })}
        </div>
      )}
      {/* 締切済みのレースは結果も出す（振り返り）。予測はコース番号（「1コース逃げ」）、結果は艇番なので、
          「結果: 3号艇が1着」と結果だと分かる形にして、コースと号艇を混ぜて読ませない。
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

  const {
    high: highRaces,
    low: lowRaces,
    allClosed,
  } = pickVolatilityHighlights(
    flattenRaces(venuesData, nowHHMM),
    HIGHLIGHT_COUNT,
  );
  if (highRaces.length === 0 && lowRaces.length === 0) return null;

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
          t={t}
        />
        <HighlightList
          title={`🎯 ${t("volatility.levelLow")}`}
          races={lowRaces}
          t={t}
        />
      </div>
      <AccuracyLink t={t} />
    </section>
  );
}

// BOA-248: イン崩れ指数を根拠にレースを選んだユーザーが、その指数自体の
// 実測精度をすぐ確認できるよう、ハイライト直後に導線を置く
function AccuracyLink({ t }) {
  const localize = useLocalizedPath();
  return (
    <p className="volatility-highlights__accuracy-link">
      <Link to={localize("/accuracy")}>
        📈 {t("home.volatilityHighlightsAccuracyLink")}
      </Link>
    </p>
  );
}

export default TodaysVolatilityHighlights;
