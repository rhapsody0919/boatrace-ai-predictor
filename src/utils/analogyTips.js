/**
 * アナロジー・ファインダー v16 の吹き出しの文（spec B-8）。純粋関数
 */
import { fmtCount, fmtPct } from "./analogyFormat.js";
import { wilsonInterval } from "./wilson.js";

/** 吹き出し「4号艇: 14件中1件（7%、ぶれ幅1〜32%）。全国10%・…」の文 */
export function boatTip(t, boat, hits, n, extras) {
  const ci = n ? wilsonInterval(hits, n) : [0, 0];
  return `${t("aiPredictionTab.analogy.similar.tip", {
    boat,
    n: fmtCount(n),
    hits: fmtCount(hits),
    pct: fmtPct(n ? hits / n : null),
    lo: Math.round(ci[0] * 100),
    hi: Math.round(ci[1] * 100),
  })}${extras.length ? `。${extras.join(t("aiPredictionTab.analogy.listSeparator"))}` : ""}`;
}
