import { Link } from "react-router-dom";
import { useLocalizedPath } from "../../../hooks/useLocalizedPath";
import BoatBadge from "../BoatBadge";
import { fmtEntry } from "../../../utils/analogyFormat";
import { ITEM_GROUPS, inDistance } from "../../../utils/analogyAggregate";
import {
  itemValue,
  similarRaceLink,
} from "../../../utils/analogySimilarDisplay";

const k = "aiPredictionTab.analogy.similar";
const MARK = { 2: "○", 1: "△", 0: "×" };
const MARK_CLASS = { 2: "is-same", 1: "is-near", 0: "is-diff" };

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

export default function SimilarCompareDetail({
  x,
  items,
  exhibitionStage,
  today,
  t,
}) {
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
