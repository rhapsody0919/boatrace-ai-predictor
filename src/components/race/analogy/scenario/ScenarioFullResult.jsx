// ④の結果のうち、件数が足りるときの全体（ScenarioTab から移した）
import { useTranslation } from "react-i18next";
import FinishSankey from "../FinishSankey";
import AnalogySplit from "../AnalogySplit";
import TrifectaList from "../TrifectaList";
import { BoatBars, TechniqueBars } from "../OutcomeBars";
import { fmtCount } from "../../../../utils/analogyFormat";
import {
  MIN_SCENARIO,
  boatCells,
  boatCountsDiffer,
} from "../../../../utils/analogyScenario";
import { k } from "./consts";

export default function ScenarioFullResult({
  c,
  base,
  parens,
  baseName,
  scopeTag,
  bar2,
  racePick,
  racePanel,
  togglePick,
  data,
  entry,
  slit,
  cells,
  cls,
  classScope,
  first,
  setFirst,
  not1,
  setNot1,
  band,
  setBand,
}) {
  const { t } = useTranslation();
  const share = (x, n) => (n ? x / n : null);
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
      <>
        <div className="af-scn-tagrow">
          {scopeTag(1, c.n)}
          {parens.length > 0 && (
            <span className="af-foot">
              {parens.join(t("aiPredictionTab.analogy.listComma"))}
            </span>
          )}
        </div>
        <div className="af-key">
          <span>
            <i className="is-bar" />
            {t(`${k}.keyScenario`)}
          </span>
          <span>
            <i className="is-dot" />
            {baseName}
          </span>
          <span>
            <i className="is-err" />
            {t("aiPredictionTab.analogy.similar.keyErrShort")}
          </span>
          <span>{t(`${k}.keyThin`, { n: MIN_SCENARIO })}</span>
        </div>
        {/* PC では1着｜3着以内、決まり手｜万舟を左右に（BOA-813） */}
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
        <div className="af-pair">
          <div className="af-scn-blk">
            <h4 className="af-h4">{t(`${k}.techHeadingShort`)}</h4>
            <TechniqueBars
              counts={c.technique}
              n={c.n}
              reference={Object.fromEntries(
                Object.entries(base.technique).map(([kk, v]) => [
                  kk,
                  share(v, base.n),
                ]),
              )}
              selected={racePick?.kind === "tech" ? racePick.tech : null}
              onSelect={(tech) =>
                togglePick({ group: "tech", kind: "tech", tech })
              }
            />
            {racePanel("tech")}
          </div>
          <div className="af-scn-blk">
            <h4 className="af-h4">{t(`${k}.manshu`)}</h4>
            {bar2(t(`${k}.keyScenario`), share(c.manshu, c.payout_known))}
            {bar2(baseName, share(base.manshu, base.payout_known))}
            <p className="af-foot">
              {t(`${k}.manshuCount`, {
                hits: fmtCount(c.manshu),
                n: fmtCount(c.payout_known),
              })}
            </p>
            {c.manshu > 0 && (
              <button
                type="button"
                className="af-cnt-chip af-cnt-btn"
                aria-pressed={racePick?.kind === "manshu"}
                data-af-control="scenario_races_manshu"
                onClick={() => togglePick({ group: "manshu", kind: "manshu" })}
              >
                {t("aiPredictionTab.analogy.count", { n: fmtCount(c.manshu) })}{" "}
                ›
              </button>
            )}
            {racePanel("manshu")}
          </div>
        </div>
        {/* PC では着順の流れを左、よく出た3連単を右に（BOA-813） */}
        <AnalogySplit
          fig={
            <div className="af-scn-blk">
              <h4 className="af-h4">
                {t("aiPredictionTab.analogy.flow.heading")}
              </h4>
              <FinishSankey
                tri={c.tri}
                first={first}
                onFirst={setFirst}
                not1={not1}
                onNot1={setNot1}
                band={band}
                onBand={setBand}
                scenario
              />
            </div>
          }
        >
          <div className="af-scn-blk">
            <h4 className="af-h4">
              {t("aiPredictionTab.analogy.similar.triHeading")}
            </h4>
            <TrifectaList
              tri={c.tri}
              first={first}
              not1={not1}
              band={band}
              scenario
              picked={
                racePick?.kind === "tri" ? racePick.combo.join("-") : null
              }
              onPick={(combo) =>
                togglePick({ group: "tri", kind: "tri", combo })
              }
              bandPicked={racePick?.kind === "band"}
              onBandRaces={
                band
                  ? () =>
                      togglePick({
                        group: "tri",
                        kind: "band",
                        p: band.p,
                        a: band.a,
                        b: band.b,
                      })
                  : undefined
              }
            />
            {racePanel("tri")}
          </div>
        </AnalogySplit>
      </>
  );
}
