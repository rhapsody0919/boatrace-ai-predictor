import { useTranslation } from "react-i18next";
import BoatBadge from "../BoatBadge";
import RateBar from "./RateBar";
import { SCOPE_LINE } from "./analogyColors";
import { fmtCount, fmtPct } from "../../../utils/analogyFormat";

/**
 * 艇番ごとの割合の棒（どの艇が勝った？・3着以内に入った艇。タブ2・タブ3で共用）
 * @param {{counts: number[], n: number, reference?: (number|null)[]|null, selected?: number|null,
 *   onSelect?: (boat: number) => void, colored?: boolean}} props
 *   onSelect があれば棒はボタン（名前「{n}号艇 {p}% {k}件」。screens「類似レースの決まり方」）
 */
export function BoatBars({
  counts,
  n,
  reference = null,
  selected = null,
  onSelect,
  colored = false,
}) {
  const { t } = useTranslation();
  return (
    <div className="af-bars">
      {[1, 2, 3, 4, 5, 6].map((b) => {
        const hits = counts[b - 1] ?? 0;
        return (
          <RateBar
            key={b}
            label={
              <>
                <BoatBadge n={b} size="sm" />{" "}
                {t("aiPredictionTab.analogy.boat", { n: b })}
              </>
            }
            hits={hits}
            n={n}
            reference={reference?.[b - 1] ?? null}
            color={colored ? SCOPE_LINE[b] : undefined}
            selected={selected === b}
            onClick={onSelect ? () => onSelect(b) : undefined}
            ariaLabel={
              onSelect
                ? `${t("aiPredictionTab.analogy.boat", { n: b })} ${fmtPct(n ? hits / n : null)} ${fmtCount(hits)}件`
                : undefined
            }
          />
        );
      })}
    </div>
  );
}

/** 決まり手の棒（0件の決まり手は、その他だけ出さない） */
export function TechniqueBars({ counts, n, reference = null }) {
  const { t } = useTranslation();
  const TECH = ["逃げ", "差し", "まくり", "まくり差し", "抜き", "恵まれ"];
  return (
    <div className="af-bars">
      {TECH.map((k) => (
        <RateBar
          key={k}
          label={t(`aiPredictionTab.analogy.techniques.${k}`, k)}
          hits={counts?.[k] ?? 0}
          n={n}
          reference={reference?.[k] ?? null}
        />
      ))}
    </div>
  );
}
