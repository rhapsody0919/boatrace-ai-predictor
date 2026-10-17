import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import InCautionBadge from "./InCautionBadge";
import { IN_CAUTION_CONFIG } from "../../constants/inCautionConfig";
import {
  bandRange,
  boat1Rank,
  signedText as signed,
  slashDate,
} from "../../utils/inCautionLevel";
import { supabaseDataService } from "../../services/supabaseDataService";
import { trackEvent } from "../../utils/analytics";
import { useVisibleOnce } from "../../hooks/useVisibleOnce";
import {
  cautionClickEvent,
  cautionVisibleEvent,
} from "../../utils/cautionEvents";
import "./InCautionCard.css";

/** 姓だけ（承認モックの「1号艇 澤崎（B1）」の形。全角・半角の空白の前） */
const surnameOf = (name) => (name ?? "").trim().split(/\s+/)[0] ?? "";

/**
 * 直前情報で1号艇が欠場になったか（朝の生成の後の欠場。一覧・ホームは朝の値のまま、詳細だけカードを隠す。plan §1）。
 * 取得に失敗したときは分からないので隠さない（カードの値自体は朝の時点で正しい）
 */
function useBoat1Absent(raceId) {
  const [state, setState] = useState({ raceId: null, absent: false });
  useEffect(() => {
    if (!raceId) return undefined;
    let alive = true;
    supabaseDataService
      .getRaceExhibitionBasics(raceId)
      .then((rows) => {
        if (alive)
          setState({
            raceId,
            absent: rows.some((r) => r.boat === 1 && r.absent),
          });
      })
      .catch((error) => {
        // 補助の信号なので画面の失敗にはしない。原因を追えるよう記録だけ残す
        console.warn(
          `直前情報の欠場の取得に失敗（${raceId}）: ${error?.message}`,
        );
      });
    return () => {
      alive = false;
    };
  }, [raceId]);
  return state.raceId === raceId && state.absent;
}

/**
 * イン崩れ注意度のカード（BOA-822、screens S-1、承認モック mock/1-ai-tab-375.png）。AI予想タブの先頭に置く。
 * 値（inCaution）は朝の生成が保存した値をそのまま出す（段・%を画面でかけ直さない）。
 *
 * @param {{inCaution: object|null, players: object[], result: object|null, raceId: string,
 *   onOpenSonar: (() => void)|null}} props
 */
export default function InCautionCard({
  inCaution,
  players,
  result,
  raceId,
  onOpenSonar,
}) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const boat1Absent = useBoat1Absent(inCaution ? raceId : null);
  const shown = inCaution && !boat1Absent ? inCaution : null;
  // 注意度（値が無い空の表示も）が画面に入ったら、レースごとに1回 caution_visible（BOA-822 task 27）
  const visibleRef = useVisibleOnce(
    raceId ? `race_detail|${raceId}` : null,
    () => {
      const ev = cautionVisibleEvent({
        surface: "race_detail",
        raceId,
        inCaution: shown,
      });
      if (ev) trackEvent(ev.name, ev.params);
    },
  );
  /** 注意度から次へ（ソナー・思考アシスト・/accuracy）。押した時点の段で送る */
  const sendClick = (target) => {
    const ev = cautionClickEvent({
      surface: "race_detail",
      target,
      raceId,
      inCaution: shown,
    });
    if (ev) trackEvent(ev.name, ev.params);
  };

  if (!shown) {
    return (
      <p className="in-caution-empty" role="status" ref={visibleRef}>
        {t("inCaution.empty")}
      </p>
    );
  }

  const ic = inCaution;
  const range = bandRange(ic.band);
  const bandText =
    range.from === null
      ? t("inCaution.bandBelow", { v: signed(range.to, 1) })
      : range.to === null
        ? t("inCaution.bandAbove", { v: signed(range.from, 1) })
        : t("inCaution.bandRange", {
            from: signed(range.from, 1),
            to: signed(range.to, 1),
          });
  const byNumber = (n) => players?.find((p) => p.number === n) ?? null;
  const boat1 = byNumber(1);
  const top = byNumber(ic.topOtherBoat);
  const [lowEdge, highEdge] = IN_CAUTION_CONFIG.thresholds;
  const finished = Boolean(result?.finished);
  const rank = finished ? boat1Rank(result) : null;
  const notes = [
    ic.round === "junyu" && t("inCaution.noteJunyu"),
    ic.round === "yusho" && t("inCaution.noteYusho"),
    ic.absentBoats?.length > 0 &&
      t("inCaution.noteAbsent", { boats: 6 - ic.absentBoats.length }),
    ic.lowSample &&
      t("inCaution.noteLowSample", { n: ic.n.toLocaleString("ja-JP") }),
  ].filter(Boolean);

  return (
    <section
      className="in-caution-card"
      aria-labelledby={titleId}
      ref={visibleRef}
    >
      {/* 左（数字・棒・範囲）と右（理由・導線・免責）。1200px 以上で左右に並べる（承認モック 1-ai-tab-1440.png） */}
      <div className="in-caution-card-main">
        <div className="in-caution-card-head">
          <h3 className="in-caution-card-title" id={titleId}>
            {t("inCaution.title")}
          </h3>
          <InCautionBadge level={ic.level} />
        </div>
        <p className="in-caution-card-figure">
          <span className="in-caution-card-lead">{t("inCaution.lead")}</span>
          <span className="in-caution-card-pct">
            <span>{ic.pct}</span>%
          </span>
        </p>

        <div className="in-caution-card-bar">
          <span
            className="in-caution-card-base-label"
            style={{ left: `${ic.basePct}%` }}
          >
            {t("inCaution.base", { p: ic.basePct })}
          </span>
          <span className="in-caution-card-track" aria-hidden="true">
            <span
              className={`in-caution-card-fill in-caution-card-fill--${ic.level}`}
              style={{ width: `${ic.pct}%` }}
            />
            <span
              className="in-caution-card-base"
              style={{ left: `${ic.basePct}%` }}
            />
          </span>
          <span className="in-caution-card-zones" aria-hidden="true">
            <span
              className="in-caution-card-zone--low"
              style={{ width: `${lowEdge}%` }}
            />
            <span
              className="in-caution-card-zone--high"
              style={{ left: `${highEdge}%` }}
            />
          </span>
          <span className="in-caution-card-edges">
            <span>{t("inCaution.edgeLow", { p: lowEdge })}</span>
            <span>{t("inCaution.edgeHigh", { p: highEdge })}</span>
          </span>
        </div>

        <p className="in-caution-card-range">
          {t("inCaution.range", {
            band: bandText,
            n: ic.n.toLocaleString("ja-JP"),
            from: slashDate(IN_CAUTION_CONFIG.from),
            through: slashDate(ic.through),
          })}
        </p>

        {notes.length > 0 && (
          <ul className="in-caution-card-notes">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}

        {finished && rank !== null && (
          <p className="in-caution-card-result">
            {t("inCaution.result", { rank })}
            {rank !== 1 && result.rank1 != null && (
              <span>{t("inCaution.resultWinner", { boat: result.rank1 })}</span>
            )}
          </p>
        )}
      </div>

      <div className="in-caution-card-side">
        <div className="in-caution-card-reason">
          <h4>{t("inCaution.reasonHeading")}</h4>
          <dl>
            <div>
              <dt>
                {t("inCaution.reasonBoat1")}{" "}
                <span translate="no">{surnameOf(boat1?.name)}</span>
                {boat1?.grade ? `（${boat1.grade}）` : ""}
              </dt>
              <dd>{ic.boat1WinRate.toFixed(2)}</dd>
            </div>
            <div>
              <dt>
                {t("inCaution.reasonTop", { boat: ic.topOtherBoat })}{" "}
                <span translate="no">{surnameOf(top?.name)}</span>
                {top?.grade ? `（${top.grade}）` : ""}
              </dt>
              <dd>{ic.topOtherWinRate.toFixed(2)}</dd>
            </div>
            <div>
              <dt>{t("inCaution.reasonDiff")}</dt>
              <dd>{signed(ic.gapCents / 100, 2)}</dd>
            </div>
          </dl>
          <p className="in-caution-card-note">{t("inCaution.otherMaterial")}</p>
        </div>

        <p className="in-caution-card-note in-caution-card-disclaimer">
          {t("inCaution.disclaimer")}
        </p>

        <div className="in-caution-card-links">
          {onOpenSonar && (
            // 行き先を URL で表せる導線なのでリンクにする（新しいタブでも開ける）。ふつうに押したときは同じ画面の中で切り替える
            <a
              className="in-caution-card-link"
              href={`/race/${raceId}?tab=sonar&sonar=similar`}
              onClick={(e) => {
                sendClick("sonar");
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)
                  return;
                e.preventDefault();
                onOpenSonar();
              }}
            >
              <span>{t("inCaution.sonarButton")}</span>
              <span className="in-caution-card-link-go">
                {t("inCaution.sonarGo")} ›
              </span>
            </a>
          )}
          {i18n.language === "ja" && (
            <Link
              className="in-caution-card-link"
              to={`/race/${raceId}/assist`}
              onClick={() => sendClick("assist")}
            >
              <span>{t("inCaution.assistButton")}</span>
              <span className="in-caution-card-link-go">
                {t("inCaution.assistGo")} ›
              </span>
            </Link>
          )}
        </div>
        <Link
          className="in-caution-card-accuracy"
          to="/accuracy"
          onClick={() => sendClick("accuracy")}
        >
          {t("inCaution.accuracyLink")} ›
        </Link>
      </div>
    </section>
  );
}
