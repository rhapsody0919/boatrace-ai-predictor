/**
 * 2号艇の選手本人の、進入2コースで1コースの艇に逃げで1着を取られた走（逃し率、オーナー 2026-11-25）。
 * 値は親（RaceWakuInfoTab）が持つ、レースより前の本人の走（records）から作る（まくられ・差されのカードと同じ材料と期間）。
 * records: undefined＝取得中、null＝取得失敗、配列＝取得済み。失敗を「0走」に倒さない。
 * 全国の基準は venue_course_technique_baseline から1行で添える。選手の特徴としては読ませない（注記）。
 * 事実の記録なので「結果を保証しない」の断りは付けない（オーナー 2026-11-25）。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import BoatBadge from "./BoatBadge";
import {
  buildNigashiBreakdown,
  nationalNigashiBaseline,
} from "../../pure/nigashiStats.js";
import { getNigashiBaselineRows } from "../../services/venueQueries3.js";
import { getDaysAgoJST } from "../../utils/dateUtils";
import { RACE_PAGE_FROM } from "../../utils/analogySimilarDisplay";
import "./Course1LossCard.css";

const COURSE = 2;
const slash = (date) => (date ? date.replaceAll("-", "/") : date);

/** 全国の基準。undefined＝取得中、null＝取得失敗、値＝取得済み（行が無ければ empty） */
function useNationalBaseline() {
  const [state, setState] = useState(undefined);
  useEffect(() => {
    let cancelled = false;
    getNigashiBaselineRows(COURSE)
      .then((rows) => {
        if (!cancelled)
          setState(nationalNigashiBaseline(rows) ?? { empty: true });
      })
      .catch((error) => {
        console.error("逃し率の全国の基準の取得に失敗:", error);
        if (!cancelled) setState(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

function BaselineLine({ text, baseline }) {
  if (baseline === undefined || baseline?.empty) return null;
  if (baseline === null)
    return (
      <p className="course1-loss-sub" role="alert">
        {text("baselineError")}
      </p>
    );
  return (
    <p className="course1-loss-sub">
      {text("baseline", {
        from: slash(baseline.from),
        to: slash(baseline.to),
        pct: baseline.pct,
      })}
    </p>
  );
}

export default function NigashiCard({ player, records, now }) {
  const { t } = useTranslation();
  const baseline = useNationalBaseline();
  if (!player) return null;
  const text = (key, options) => t(`wakuInfo.nigashi.${key}`, options);
  const body = () => {
    if (records === undefined)
      return <p className="rwit-loading">{t("wakuInfo.loading")}</p>;
    if (records === null)
      return (
        <p className="rwit-empty" role="alert">
          {text("fetchError")}
        </p>
      );
    const b = buildNigashiBreakdown(records, COURSE, { now });
    // 0走のときは期間の端が走から決まらないので、当社データの開始日とレースの前日を出す
    const range = {
      from: slash(b.from ?? RACE_PAGE_FROM),
      to: slash(b.to ?? getDaysAgoJST(1, now)),
    };
    if (b.n === 0)
      return <p className="course1-loss-sub">{text("empty", range)}</p>;
    return (
      <>
        <p className="course1-loss-sub">{text("sub", range)}</p>
        <dl className="course1-loss-rows">
          <div className="course1-loss-row">
            <dt>{text("row")}</dt>
            <dd data-testid="nigashi-value">
              {text("value", { n: b.n, count: b.count })}
              <small>{text("valuePct", { pct: b.pct })}</small>
            </dd>
          </div>
        </dl>
        <BaselineLine text={text} baseline={baseline} />
        <div className="course1-loss-notes">
          <p>{text("note1")}</p>
          <p>{text("note2")}</p>
        </div>
      </>
    );
  };
  return (
    // 右の列で決まり手のカードの上に積む。PC の下の段は子の余白を0にそろえる（RaceWakuInfoTabPc.css）ので、
    // ここだけ下の余白を持つ（値はスマホの .rwit-card の margin-bottom と同じ）
    <section
      className="rwit-card course1-loss"
      data-testid="nigashi-card"
      style={{ marginBottom: "var(--spacing-3)" }}
    >
      <h3 className="rwit-card-title">{text("title")}</h3>
      <p className="course1-loss-who">
        <BoatBadge n={COURSE} size="xs" />
        <span className="course1-loss-name" translate="no">
          {player.name?.replace(/\s+/g, "")}
        </span>
        {player.grade && (
          <span className="course1-loss-grade">{player.grade}</span>
        )}
      </p>
      {body()}
    </section>
  );
}
