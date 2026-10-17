/**
 * BOA-635 の表示の文（要約・主文・注記）。AI予想タブの結果と結果タブの振り返りで共用する
 * （docs/design/past-rate-check/spec.md FR-2）。文言は aiPredictionTab.pastRate.*（4言語）
 */
import { SLIT_FORMS } from "../../../utils/analogyScenario.js";
import { describeAnalogyLayer } from "../../../utils/analogyLayer.js";
import { orderPoints } from "../../../utils/pastRate/count.js";

const K = "aiPredictionTab.pastRate";
const fmtN = (n) => Number(n).toLocaleString("ja-JP");

/** 着順の組の書き方「1-3,4-2,3,4」 */
export const orderComboText = ({ first, second, third }) =>
  [[first], second, third]
    .map((xs) => [...xs].sort((a, b) => a - b).join(","))
    .join("-");

/** 入力の要約（「3連単 1-3,4-2,3,4（4点）」「3号艇のまくり」等） */
export function summaryOf(type, input, t) {
  switch (type) {
    case "order":
      return t(`${K}.summary.order`, {
        combo: orderComboText(input),
        points: orderPoints(input),
      });
    case "boat1":
      return t(`${K}.summary.boat1.${input.outcome}`);
    case "tenkai":
      return t(`${K}.summary.tenkai`, {
        boat: input.boat,
        technique: t(`techniques.${input.technique}`),
      });
    case "slit": {
      if (input.mode === "custom")
        return input.courses
          .map((s, i) =>
            s === 0
              ? null
              : t(`${K}.slit.customSummary`, {
                  course: i + 1,
                  state: t(`${K}.slit.states.${s}`),
                }),
          )
          .filter(Boolean)
          .join(t(`${K}.slit.customSep`));
      const forms = SLIT_FORMS.filter((f) => input.patterns.includes(f));
      const names = forms
        .map((f) => t(`${K}.slit.formsShort.${f}`))
        .join(t(`${K}.slit.summarySep`));
      const strong = forms.some((f) => f !== "flat" && f !== "wall");
      return strong
        ? t(`${K}.summary.slitLevel`, {
            forms: names,
            level: t(`${K}.slit.levels.${input.level}.summary`),
          })
        : names;
    }
    case "entry":
      return t(`${K}.summary.entry.${input.target}`, { boat: input.boat });
    default:
      return t(`${K}.summary.payout.${input.band}`);
  }
}

/** 割合（%、小数1桁、四捨五入）。N=0 は null */
export const pctText = ({ n, count }) =>
  n ? (Math.round((count * 1000) / n) / 10).toFixed(1) : null;

/** 主文「過去{N}レース中 {c}回（{p}%）」。truncated なら「同じ条件の新しい{N}レース中」 */
export function mainText({ n, count }, truncated, t) {
  return t(`${K}.main`, {
    prefix: t(truncated ? `${K}.prefixNewest` : `${K}.prefixAll`),
    n: fmtN(n),
    count: fmtN(count),
    pct: pctText({ n, count }),
  });
}

/** 期間「2019-04〜2025-11」（同じ月なら1つ） */
function periodText(from, to) {
  const a = String(from).slice(0, 7);
  const b = String(to).slice(0, 7);
  return a === b ? a : `${a}〜${b}`;
}

/**
 * 比べた相手の注記。切り詰めていなければ母集団の期間、切り詰めたら数えた行の期間（最古の race_date〜前日）
 * @param {object} layer layer API の応答
 * @param {{standard: number|null, rare: number|null}|null} lines 出す線（thresholdNote）
 */
export function noteText(layer, truncated, lines, t) {
  const desc = describeAnalogyLayer(layer.conditions, t, {
    count: layer.n_total,
  });
  const from = truncated
    ? layer.rows.reduce(
        (m, r) => (r.race_date < m ? r.race_date : m),
        layer.rows[0].race_date,
      )
    : layer.pool_from;
  const period = periodText(from, layer.pool_cutoff);
  const head = truncated
    ? t(`${K}.noteTruncated`, {
        layer: desc,
        n: fmtN(layer.n_returned),
        period,
      })
    : t(`${K}.note`, { layer: desc, period });
  if (!lines) return head;
  const key =
    lines.standard !== null && lines.rare !== null
      ? "both"
      : lines.standard !== null
        ? "standard"
        : "rare";
  return `${head}。${t(`${K}.lines.${key}`, lines)}`;
}

export const excludedText = ({ reason, count }, t) =>
  t(`${K}.excluded.${reason}`, { count: fmtN(count) });

/** 内訳の1行（着順の上位4組、展開の2着の艇） */
export function breakdownText(type, breakdown, t) {
  if (!breakdown || breakdown.items.length === 0) return null;
  const sep = t(`${K}.listSep`);
  if (type === "order") {
    const items = breakdown.items
      .map((x) =>
        t(`${K}.breakdownItem`, { key: x.combo, count: fmtN(x.count) }),
      )
      .join(sep);
    return t(
      breakdown.more ? `${K}.breakdownOrderMore` : `${K}.breakdownOrder`,
      {
        items,
      },
    );
  }
  const items = breakdown.items
    .map((x) => t(`${K}.breakdownBoat`, { boat: x.boat, count: fmtN(x.count) }))
    .join(sep);
  return t(`${K}.breakdownTenkai`, { items });
}
