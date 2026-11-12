// 券種ごとのオッズの表（3連単・3連複・2連単系・単勝複勝）。RaceOddsListTabBody の render 関数を部品にしただけ
import { useTranslation } from "react-i18next";
import BoatBadge from "../BoatBadge";
import { BlockHead, ColFoot } from "./OddsCells";
import {
  compositeOdds,
} from "../../../utils/oddsMath";
import {
  formatValue,
  isNoVotes,
  triosOf,
  withPanelAfter,
} from "./oddsListHelpers";

// 3連単: 1着ブロック → 2着列 → 3着行（＋合成オッズ・2連単オッズ）
export function TrifectaTable({
  boats,
  nameByBoat,
  valueOf,
  oddsButton,
  trendPanel,
  selectedKey,
  liveResult,
  livePages,
  useFinal,
  finalOdds,
  latestSnapshot,
}) {
  const { t } = useTranslation();
  // 2連単オッズは、3連単と同じ時点の値を使う（別時刻の値が同じ列に並ばないように）。
  // ライブ表示中は2連単のライブ値（取得済みなら）、スナップショット表示中は同じ行の値
  // （2連単のページはチップを切り替えるまで取らないため、未取得の間はスナップショットの値を出す）
  // スナップショットの2連単でキーが無い組は、保存時に落ちた票0（セルと同じく「票なし」）
  // 締切時オッズ（公式）の表では、2連単も締切時オッズだけを使う（取れていなければ「-」。記録値を混ぜない）
  const liveResult2tf = !!(liveResult && livePages["2tf"]?.result);
  const exactaMap = useFinal
    ? (finalOdds.exactaAll ?? null)
    : ((liveResult ? livePages["2tf"]?.result?.data?.exactaAll : null) ??
      latestSnapshot?.exactaAll ??
      null);
  const blocks = boats.map((first) => {
    const seconds = boats.filter((n) => n !== first);
    return (
      <section className="rol-block" key={first}>
        <BlockHead n={first} name={nameByBoat.get(first)} />
        <div
          className="rol-cols"
          style={{ "--rol-col-count": seconds.length }}
        >
          {seconds.map((second) => {
            const thirds = boats.filter((n) => n !== first && n !== second);
            const composite = compositeOdds(
              thirds.map((third) => valueOf(`${first}-${second}-${third}`)),
            );
            const exacta = exactaMap?.[`${first}-${second}`] ?? null;
            return (
              <div className="rol-col" key={second}>
                <div className="rol-col-head">
                  <BoatBadge n={second} size="sm" />
                </div>
                {thirds.map((third) =>
                  oddsButton(
                    `${first}-${second}-${third}`,
                    <BoatBadge n={third} size="xs" />,
                  ),
                )}
                <ColFoot
                  label={t("oddsList.compositeLabel")}
                  value={formatValue(composite) ?? "-"}
                />
                <ColFoot
                  label={t("oddsList.exactaShortLabel")}
                  value={
                    exacta === 0 ||
                    (exacta === null &&
                      exactaMap &&
                      !liveResult2tf &&
                      !useFinal)
                      ? t("oddsList.noVotes")
                      : (formatValue(exacta) ?? "-")
                  }
                />
              </div>
            );
          })}
        </div>
      </section>
    );
  });
  const selectedFirst = selectedKey ? Number(selectedKey.split("-")[0]) : null;
  return (
    <div className="rol-block-grid">
      {withPanelAfter(blocks, boats.indexOf(selectedFirst), trendPanel())}
    </div>
  );
}

// 3連複: 艇番3つの組み合わせを2列で一覧
export function TrioTable({ boats, oddsButton, trendPanel, selectedKey }) {
  const combos = triosOf(boats).map((combo) => combo.join("-"));
  const items = combos.map((key) =>
    oddsButton(
      key,
      key
        .split("-")
        .map((n) => <BoatBadge key={n} n={Number(n)} size="xs" />),
    ),
  );
  return (
    <div className="rol-two-col-grid rol-trio-grid">
      {withPanelAfter(
        items,
        combos.indexOf(selectedKey),
        trendPanel(),
      )}
    </div>
  );
}

// 2連単/2連複/拡連複: 艇番ごとのブロック → 相手艇ごとの行
export function PairsTable({
  betType,
  boats,
  nameByBoat,
  oddsButton,
  trendPanel,
  selectedKey,
}) {
  const partnersOf = (head) =>
    betType.ordered
      ? boats.filter((n) => n !== head)
      : boats.filter((n) => n > head);
  // 順不同の券種では、最大の艇番は相手が残らないためブロックを作らない
  const heads = boats.filter((head) => partnersOf(head).length > 0);
  const items = heads.map((head) => {
    const partners = partnersOf(head);
    return (
      <section className="rol-block" key={head}>
        <BlockHead n={head} name={nameByBoat.get(head)} />
        <div className="rol-rows">
          {partners.map((partner) =>
            oddsButton(
              `${head}-${partner}`,
              <BoatBadge n={partner} size="sm" />,
            ),
          )}
        </div>
      </section>
    );
  });
  const selectedHead = selectedKey ? Number(selectedKey.split("-")[0]) : null;
  return (
    <div className="rol-two-col-grid">
      {withPanelAfter(
        items,
        heads.indexOf(selectedHead),
        trendPanel(),
      )}
    </div>
  );
}

// 単勝・複勝: 艇ごとの表
export function WinPlaceTable({
  boats,
  nameByBoat,
  latestMap,
  placeMap,
  liveResult,
  useFinal,
}) {
  const { t } = useTranslation();
  const winOf = (n) => latestMap?.[String(n)] ?? null;
  const placeOf = (n) => placeMap?.[String(n)] ?? null;
  const snapshotHasNull =
    !liveResult &&
    !useFinal &&
    boats.some((n) => winOf(n) === null || placeOf(n) === null);
  const cell = (value, range) => {
    if (value == null) return "-";
    if (isNoVotes(value, range)) {
      return <span className="rol-no-votes">{t("oddsList.noVotes")}</span>;
    }
    return formatValue(value, range);
  };
  return (
    <>
      <table className="rol-win-table">
        <thead>
          <tr>
            <th scope="col">{t("oddsList.boatColumn")}</th>
            <th scope="col">{t("result.payoutType.win")}</th>
            <th scope="col">{t("result.payoutType.place")}</th>
          </tr>
        </thead>
        <tbody>
          {boats.map((n) => (
            <tr key={n}>
              <th scope="row">
                <span className="rol-win-boat">
                  <BoatBadge n={n} />
                  {nameByBoat.get(n) && (
                    <span className="rol-block-name" translate="no">
                      {nameByBoat.get(n)}
                    </span>
                  )}
                </span>
              </th>
              <td>{cell(winOf(n), false)}</td>
              <td>{cell(placeOf(n), true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {snapshotHasNull && (
        <p className="rol-callout">{t("oddsList.winNoVotesOrMissing")}</p>
      )}
    </>
  );
}

// 券種に合う表を選ぶ
export function OddsTables({ betType, ...props }) {
  return (
    <>
      {betType.id === "trifecta" && <TrifectaTable {...props} />}
      {betType.id === "trio" && <TrioTable {...props} />}
      {betType.id === "winPlace" && <WinPlaceTable {...props} />}
      {["exacta", "quinella", "wide"].includes(betType.id) && (
        <PairsTable betType={betType} {...props} />
      )}
    </>
  );
}
