import { useTranslation } from "react-i18next";
import BoatBadge from "../BoatBadge";
import RateBar from "./RateBar";
import { SCOPE_LINE } from "./analogyColors";
import { fmtCount, fmtPct, fmtRateCount } from "../../../utils/analogyFormat";

/**
 * 艇番ごとの割合の棒（どの艇が勝った？・3着以内に入った艇。タブ2・タブ3で共用）。
 * n が配列なら艇ごとの件数（タブ3で艇ごとに級別をそろえたとき。BOA-806）で、棒の右に当たり/件数を出し、
 * fewBelow 件未満の艇は薄く出す
 * @param {{counts: number[], n: number|number[], reference?: (number|null)[]|null, selected?: number|null,
 *   onSelect?: (boat: number) => void, colored?: boolean, fewBelow?: number}} props
 */
export function BoatBars({
  counts,
  n,
  reference = null,
  selected = null,
  onSelect,
  colored = false,
  fewBelow = 0,
}) {
  const { t } = useTranslation();
  const perBoat = Array.isArray(n);
  return (
    <div className="af-bars">
      {[1, 2, 3, 4, 5, 6].map((b) => {
        const hits = counts[b - 1] ?? 0;
        const nb = perBoat ? (n[b - 1] ?? 0) : n;
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
            n={nb}
            reference={reference?.[b - 1] ?? null}
            color={colored ? SCOPE_LINE[b] : undefined}
            value={perBoat ? fmtRateCount([hits, nb]) : undefined}
            few={perBoat && nb < fewBelow}
            selected={selected === b}
            onClick={onSelect ? () => onSelect(b) : undefined}
            ariaLabel={
              onSelect
                ? t("aiPredictionTab.analogy.barLabel", {
                    boat: b,
                    p: fmtPct(nb ? hits / nb : null),
                    n: fmtCount(hits),
                  })
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
