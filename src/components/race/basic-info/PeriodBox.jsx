import { useTranslation } from "react-i18next";
import {
  pickPeriodStats,
  periodDiff,
  periodDiffShownFrom,
} from "../basicInfoStats";
import { slashDatePadded } from "./format";

// 「前期」は公式の期別成績で、単位が点。自社集計の1着率%と同じ列に混ぜられないため別枠にする
export default function PeriodBox({ periodStats, racerId, raceId, nowRow }) {
  const { t } = useTranslation();
  const period = pickPeriodStats(
    periodStats,
    racerId,
    (raceId ?? "").slice(0, 10),
  );
  if (!period) return null;

  // 前期と出走表の値の差（BOA-439）。出走表の値は上のバーの
  // 既定（全国・今期）と同じ公式値（race_entries、追加クエリ無し）。
  // 「今期」とは呼ばない: 出走表の勝率は期が替わっても数え直されず、
  // 5月は直前の期の確定値との差が平均0.12しかない（9月は0.38。
  // 2026-09-30実測）。バーを当地に切り替えても全国のままなので
  // 「全国」も明記する。平均STは出走表の値が無いので差は出さない
  const winDiff = periodDiff(period.winRate, nowRow?.win_rate, 2);
  const top2Diff = periodDiff(period.top2Rate, nowRow?.global_2rate, 1);
  // 期の初めから3か月は差を出さず、出走表の値だけを並べる
  // （periodDiffShownFrom のコメント参照）
  const diffShownFrom = periodDiffShownFrom(period?.calcTo ?? null);
  const raceDate = (raceId ?? "").slice(0, 10);
  // 前期を取り込む前に前々期を出しているとき（period.fallback）も差を出さない。
  // 出走表の勝率は前期の成績に近く、前々期との差を「前期から」と読ませると誤る
  const diffWithheld = Boolean(
    period?.fallback || (diffShownFrom && raceDate && raceDate < diffShownFrom),
  );
  // 前々期を出しているときの、差を出さない理由。コードが知っている事実
  // （前期を取り込んでいない・差を出し始める日）だけを書く。「公式の公開待ち」
  // 「出走表は前期に近い」は日付によって外れる（期の初め3か月を過ぎれば公式は
  // 公開済みで、出走表も前期から離れる）。ファン評価1周目・2周目で同じ注記に
  // 指摘が続いたため、外の事実を言い切らない形にした
  const fallbackDiffNote = (p, date) => {
    const from = periodDiffShownFrom(p.pending.calcTo);
    return from && date && date < from
      ? t("basicInfo.periodDiffFallbackNoteDate", {
          date: slashDatePadded(from),
        })
      : t("basicInfo.periodDiffFallbackNote");
  };
  // 2連対率の差は率の変化ではなくポイント差なので pt を付ける
  const diffLabel = (d, unit = "", diffUnit = unit) =>
    d && (
      <span
        // 勝率・2連対率とも高いほど良い。上がった＝緑、下がった＝赤
        // （差の数字に＋−が付く。race-detail-ui-unify R2）。
        // 差を出さない期の初め（diffWithheld）は色を付けない
        className={`rbit-period-diff${
          diffWithheld
            ? ""
            : d.sign > 0
              ? " is-up ind-good"
              : d.sign < 0
                ? " is-down ind-bad"
                : ""
        }`}
      >
        {diffWithheld
          ? t("basicInfo.periodCurrentOnly", {
              current: `${d.current}${unit}`,
            })
          : t("basicInfo.periodVsCurrent", {
              current: `${d.current}${unit}`,
              diff: `${d.diff}${diffUnit}`,
            })}
      </span>
    );

  return (
    <div className={`rbit-period${period.fallback ? " is-fallback" : ""}`}>
      <div className="rbit-period-heading">
        {t(
          period.fallback
            ? "basicInfo.periodTitleFallback"
            : "basicInfo.periodTitle",
          {
            from: slashDatePadded(period.calcFrom),
            to: slashDatePadded(period.calcTo),
          },
        )}
      </div>
      {/* 公式の fan が公開される前（期替わり直後）は前々期を出す。
          その期を表として取り込んでいないときだけ（pickPeriodStats） */}
      {/* 値の行は通常の前期と同じ見た目なので、見出しの「々」1文字だけに
          頼らず、この注記を本文と同じ大きさ・色で出す（ファン評価1周目 P2） */}
      {period.fallback && (
        <p className="rbit-period-note rbit-period-pending">
          {t("basicInfo.periodFallbackNote", {
            from: slashDatePadded(period.pending.calcFrom),
            to: slashDatePadded(period.pending.calcTo),
          })}
        </p>
      )}
      <div className="rbit-period-values">
        <span>
          {t("basicInfo.periodWinRate", {
            value: period.winRate === null ? "—" : period.winRate.toFixed(2),
          })}
          {diffLabel(winDiff)}
        </span>
        <span>
          {/* 単位は値側に付ける。i18n側に「%」を残すと
              出走0の新人（top2_rateがNULL）で
              「2連対率 —%」になる */}
          {t("basicInfo.periodTop2Rate", {
            value:
              period.top2Rate === null ? "—" : `${period.top2Rate.toFixed(1)}%`,
          })}
          {diffLabel(top2Diff, "%", "pt")}
        </span>
        <span>
          {t("basicInfo.periodAvgSt", {
            value: period.avgSt === null ? "—" : period.avgSt.toFixed(2),
          })}
        </span>
      </div>
      {/* 優出・優勝（BOA-326）。公式の期別成績の前期の値と、
          前期を含む直近4期の合計。1艇ずつの表示で6艇の
          比較ではないので、最良の金枠は付けない */}
      <div className="rbit-period-finals">
        <span>
          {t("basicInfo.periodFinals", {
            value: period.finals ?? "—",
          })}
        </span>
        <span>
          {t("basicInfo.periodWins", {
            value: period.wins ?? "—",
          })}
        </span>
        {/* 範囲と回数を分け、回数は1つの塊で折り返す（375pxで「回」だけが
            次の行に落ちた。ファン評価2周目 P2） */}
        <span className="rbit-period-recent">
          {t(
            period.fallback
              ? "basicInfo.periodRecentRangeFallback"
              : "basicInfo.periodRecentRange",
            {
              from: period.recent.from.slice(0, 7).replace("-", "/"),
              to: period.recent.to.slice(0, 7).replace("-", "/"),
            },
          )}
          <span className="rbit-period-recent-counts">
            {t("basicInfo.periodRecentCounts", {
              finals: period.recent.finals,
              wins: period.recent.wins,
            })}
          </span>
        </span>
      </div>
      {diffWithheld && (winDiff || top2Diff) && (
        <p className="rbit-period-note">
          {period.fallback
            ? fallbackDiffNote(period, raceDate)
            : t("basicInfo.periodDiffWithheldNote", {
                date: slashDatePadded(diffShownFrom),
              })}
        </p>
      )}
    </div>
  );
}
