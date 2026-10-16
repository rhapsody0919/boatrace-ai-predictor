import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import InCautionBadge from "./InCautionBadge";
import { IN_CAUTION_CONFIG } from "../../constants/inCautionConfig";
import { bandRange } from "../../utils/inCautionLevel";
import { DEFAULT_STEP as SONAR_DEFAULT_COUNT } from "../../utils/analogyAggregate";
import { supabaseDataService } from "../../services/supabaseDataService";
import { normalizeRacerName } from "../../utils/digestMetrics";
import "./InCautionCard.css";

/** 勝率差・帯の数字。負は全角のマイナス（−）、正は「+」 */
function signed(v, digits) {
  if (v === 0) return (0).toFixed(digits);
  return `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(digits)}`;
}

/** "2019-04-01" → "2019/4/1" */
function slashDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}/${m}/${d}`;
}

/** 1号艇の着順（rank1〜rank6 は「その着の艇番」）。取れなければ null */
function boat1Rank(result) {
  for (let k = 1; k <= 6; k++) if (result?.[`rank${k}`] === 1) return k;
  return null;
}

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

  if (!inCaution || boat1Absent) {
    return (
      <p className="in-caution-empty" role="status">
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
    ic.round !== "other" && t("inCaution.noteFinal"),
    ic.absentBoats?.length > 0 &&
      t("inCaution.noteAbsent", { boats: 6 - ic.absentBoats.length }),
    ic.lowSample &&
      t("inCaution.noteLowSample", { n: ic.n.toLocaleString("ja-JP") }),
  ].filter(Boolean);

  return (
    <section className="in-caution-card" aria-labelledby={titleId}>
      <div className="in-caution-card-head">
        <h3 className="in-caution-card-title" id={titleId}>
          {t("inCaution.title")}
        </h3>
        <InCautionBadge level={ic.level} />
      </div>
      <p className="in-caution-card-lead">{t("inCaution.lead")}</p>
      <p className="in-caution-card-pct">
        <span>{ic.pct}</span>%
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

      <div className="in-caution-card-reason">
        <h4>{t("inCaution.reasonHeading")}</h4>
        <dl>
          <div>
            <dt>
              {t("inCaution.reasonBoat1")}{" "}
              <span translate="no">{normalizeRacerName(boat1?.name ?? "")}</span>
              {boat1?.grade ? `（${boat1.grade}）` : ""}
            </dt>
            <dd>{ic.boat1WinRate.toFixed(2)}</dd>
          </div>
          <div>
            <dt>
              {t("inCaution.reasonTop", { boat: ic.topOtherBoat })}{" "}
              <span translate="no">{normalizeRacerName(top?.name ?? "")}</span>
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

      {finished && rank !== null && (
        <p className="in-caution-card-result">
          {t("inCaution.result", { rank })}
          {rank !== 1 && result.rank1 != null && (
            <span>{t("inCaution.resultWinner", { boat: result.rank1 })}</span>
          )}
        </p>
      )}

      <p className="in-caution-card-note">{t("inCaution.disclaimer")}</p>

      <div className="in-caution-card-links">
        {onOpenSonar && (
          <button
            type="button"
            className="in-caution-card-link"
            onClick={onOpenSonar}
          >
            <span>
              {t("inCaution.sonarButton", {
                n: SONAR_DEFAULT_COUNT.toLocaleString("ja-JP"),
              })}
            </span>
            <span className="in-caution-card-link-go">
              {t("inCaution.sonarGo")} ›
            </span>
          </button>
        )}
        {i18n.language === "ja" && (
          <Link className="in-caution-card-link" to={`/race/${raceId}/assist`}>
            <span>{t("inCaution.assistButton")}</span>
            <span className="in-caution-card-link-go">
              {t("inCaution.assistGo")} ›
            </span>
          </Link>
        )}
      </div>
      <Link className="in-caution-card-accuracy" to="/accuracy">
        {t("inCaution.accuracyLink")} ›
      </Link>
    </section>
  );
}
