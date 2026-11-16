// ④の1着｜3着以内の棒（ScenarioFullResult から移した）
import { useTranslation } from "react-i18next";
import { BoatBars } from "../OutcomeBars";
import { fmtCount } from "../../../../utils/analogyFormat";
import {
  MIN_SCENARIO,
  boatCells,
  boatCountsDiffer,
} from "../../../../utils/analogyScenario";
import { k, share } from "./consts";

export default function ScenarioBoatPair({
  c,
  racePick,
  racePanel,
  togglePick,
  data,
  entry,
  slit,
  cells,
  cls,
  classScope,
}) {
  const { t } = useTranslation();
  // 2〜6号艇はその艇の級をそろえた範囲の値（BOA-806）。比べる点線も同じ艇の範囲の「形を問わない」値
  const cur = boatCells(cells, data.boats, entry, slit);
  const ref =
    slit !== "any"
      ? boatCells(cells, data.boats, entry, "any")
      : boatCells(cells, data.boats, "all", "any");
  const perBoat = boatCountsDiffer(cur);
  const boatN = perBoat ? cur.map((r) => r[0]) : c.n;
  const top3 = (r) => r[1] + r[2] + r[3];

  // 棒の左の札: 級・件数（艇ごとの範囲が無い・級をそろえない範囲は、1号艇の範囲の件数）
  // その艇の級でそろえた値が無い艇（朝のバッチの前の版など）は、1号艇の範囲の値に戻るので、その艇の級を書かない
  // （レビュー指摘: 札と中身が食い違っていた）
  const ownScope = [1, 2, 3, 4, 5, 6].map(
    (b) => b === 1 || Boolean(data.boats?.[b]?.data?.cells?.[entry]?.[slit]),
  );
  const boatTags = cur.map((r, i) =>
    classScope && ownScope[i]
      ? t(`${k}.boatTag`, { b: i + 1, cls: cls[i] ?? "—", n: fmtCount(r[0]) })
      : t(`${k}.boatTagAll`, { b: i + 1, n: fmtCount(r[0]) }),
  );

  return (
        <div className="af-pair">
          <div className="af-scn-blk">
            <h4 className="af-h4">{t(`${k}.firstBoat`)}</h4>
            {perBoat && <p className="af-foot">{t(`${k}.boatScopeLine`)}</p>}
            <BoatBars
              counts={cur.map((r) => r[1])}
              n={boatN}
              reference={ref.map((r) => share(r[1], r[0]))}
              fewBelow={MIN_SCENARIO}
              tags={boatTags}
              colored
              countChip
              selected={racePick?.kind === "first" ? racePick.boat : null}
              onSelect={(b) =>
                togglePick({ group: "first", kind: "first", boat: b })
              }
            />
            {racePanel("first")}
          </div>
          <div className="af-scn-blk">
            <h4 className="af-h4">{t(`${k}.top3Boat`)}</h4>
            <BoatBars
              counts={cur.map(top3)}
              n={boatN}
              reference={ref.map((r) => share(top3(r), r[0]))}
              fewBelow={MIN_SCENARIO}
              tags={boatTags}
              colored
            />
          </div>
        </div>
  );
}
