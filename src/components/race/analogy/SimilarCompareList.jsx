import { useState } from "react";
import { Link } from "react-router-dom";
import { useLocalizedPath } from "../../../hooks/useLocalizedPath";
import { useTranslation } from "react-i18next";
import BoatBadge from "../BoatBadge";
import { fmtDate, fmtEntry, venueLabel } from "../../../utils/analogyFormat";
import {
  ITEM_GROUPS,
  inDistance,
  neighborCounts,
} from "../../../utils/analogyAggregate";
import {
  itemValue,
  similarRaceLink,
} from "../../../utils/analogySimilarDisplay";

const k = "aiPredictionTab.analogy.similar";
const MARK = { 2: "○", 1: "△", 0: "×" };
const MARK_CLASS = { 2: "is-same", 1: "is-near", 0: "is-diff" };
const FIRST_ROWS = 20;

/** ST の順位（1号艇から。F・出遅れは null）。コース順の ST と艇番順のコースから */
function stOrder(x) {
  if (!Array.isArray(x.st_by_course) || !Array.isArray(x.course_by_boat))
    return null;
  const byBoat = x.course_by_boat.map((c) =>
    c ? x.st_by_course[c - 1] : null,
  );
  return byBoat.map((v) =>
    v === null || v === undefined
      ? null
      : 1 + byBoat.filter((o) => o !== null && o !== undefined && o < v).length,
  );
}

function Detail({ x, items, exhibitionStage, today, t }) {
  const st = stOrder(x);
  const localize = useLocalizedPath();
  const link = similarRaceLink(x.race_id);
  return (
    <div className="af-nbd">
      {/* そのレースのページへ。龍神レーダーにレースページが無い古いレースは公式サイトの結果ページ（新しいタブ） */}
      {link?.internal && (
        <Link className="af-nb-link" to={localize(link.href)}>
          {t(`${k}.openRace`)}
        </Link>
      )}
      {link && !link.internal && (
        <a
          className="af-nb-link"
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t(`${k}.openOfficial`)}
        </a>
      )}
      <p className="af-res">
        {t(`${k}.result`)}{" "}
        <span className="af-bnrow">
          {(x.finish ?? []).map((b, i) => (
            <BoatBadge key={i} n={b} size="xs" />
          ))}
        </span>{" "}
        {x.technique
          ? t(`aiPredictionTab.analogy.techniques.${x.technique}`, x.technique)
          : ""}
        {x.payout_3tan
          ? `\u3000${t(`${k}.payout`, { yen: x.payout_3tan.toLocaleString("ja-JP") })}`
          : ""}
        <small>
          {t(`${k}.finishDetail`, {
            order: (x.finish ?? []).join("-"),
            all: [1, 2, 3, 4, 5, 6]
              .map((b) => {
                const pos = (x.finish ?? []).indexOf(b);
                return t(`${k}.boatFinish`, {
                  b,
                  f:
                    pos >= 0
                      ? t(`${k}.place`, { n: pos + 1 })
                      : t(`${k}.placeOut`),
                });
              })
              .join(t("aiPredictionTab.analogy.listSeparator")),
          })}
          {st &&
            `\u3000${t(`${k}.stOrder`, { order: st.map((v) => v ?? "—").join("/") })}`}
          {x.course_by_boat &&
            `\u3000${t(`${k}.entry`, { e: fmtEntry(x.course_by_boat) })}`}
        </small>
      </p>
      {ITEM_GROUPS.map((g) => {
        const its = items.filter((it) => it.group === g);
        if (!its.length) return null;
        const usedAny = its.some((it) => inDistance(it, exhibitionStage));
        return (
          <div key={g} className="af-cg">
            <div className="af-lbl">
              {t(`${k}.groups.${g}`)}
              {!usedAny && t(`${k}.groupNotUsed`)}
            </div>
            {its.map((it) => {
              const m = x.items?.[it.key];
              const ok = m === 0 || m === 1 || m === 2;
              return (
                <div key={it.key} className="af-ci">
                  <span className={`af-mk ${ok ? MARK_CLASS[m] : "af-muted"}`}>
                    {ok ? MARK[m] : "—"}
                  </span>
                  <span>{t(`${k}.items.${it.key}.label`)}</span>
                  <span className="af-cv">
                    {itemValue(it.key, x.display ?? null, t)}
                    <small>
                      {t(`${k}.todayValue`, { v: itemValue(it.key, today, t) })}
                    </small>
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/**
 * 1件ずつ見比べる（spec B-7）。行を押すと今日と全項目を並べる。open・onOpen は親が持つ（ソナーの点から開くため）
 */
export default function SimilarCompareList({
  neighbors,
  items,
  exhibitionStage,
  today,
  open,
  onOpen,
  expanded,
  onExpanded,
}) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const shownAll =
    all || neighbors.findIndex((x) => x.race_id === open) >= FIRST_ROWS;
  const shown = shownAll ? neighbors : neighbors.slice(0, FIRST_ROWS);
  return (
    <details
      className="af-details"
      open={expanded}
      onToggle={(e) => onExpanded(e.currentTarget.open)}
    >
      <summary>{t(`${k}.cmpSummary`)}</summary>
      <p className="af-sub">{t(`${k}.cmpLede`)}</p>
      <div className="af-nb-list">
        {shown.map((x, i) => {
          const c = neighborCounts(x, exhibitionStage);
          const isOpen = open === x.race_id;
          return (
            <div
              key={x.race_id}
              className={`af-nbr${isOpen ? " is-open" : ""}`}
              id={`af-nb-${x.race_id}`}
            >
              <button
                type="button"
                className="af-nbh"
                aria-expanded={isOpen}
                onClick={() => onOpen(isOpen ? null : x.race_id)}
              >
                <span className="af-nb-rk">{i + 1}</span>
                <span className="af-nb-nm">
                  {fmtDate(x.date)} {venueLabel(x.venue_code, t)}
                  {x.race_number}R
                  <small>
                    {[
                      x.grade
                        ? t(
                            `aiPredictionTab.analogy.grades.${x.grade}`,
                            x.grade,
                          )
                        : null,
                      x.round
                        ? t(
                            `aiPredictionTab.analogy.outlook.roundNames.${x.round}`,
                          )
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  </small>
                </span>
                <span className="af-nb-sc">
                  {t(`${k}.counts`, {
                    same: c.same,
                    near: c.near,
                    diff: c.diff,
                  })}
                </span>
                <span className="af-bnrow" aria-hidden="true">
                  {(x.finish ?? []).map((b, j) => (
                    <BoatBadge key={j} n={b} size="xs" />
                  ))}
                </span>
              </button>
              {isOpen && (
                <Detail
                  x={x}
                  items={items}
                  exhibitionStage={exhibitionStage}
                  today={today}
                  t={t}
                />
              )}
            </div>
          );
        })}
      </div>
      {neighbors.length > FIRST_ROWS && (
        <button
          type="button"
          className="af-btn"
          onClick={() => setAll(!shownAll)}
        >
          {shownAll
            ? t(`${k}.cmpLess`, { n: FIRST_ROWS })
            : t(`${k}.cmpMore`, { n: neighbors.length - FIRST_ROWS })}
        </button>
      )}
    </details>
  );
}
