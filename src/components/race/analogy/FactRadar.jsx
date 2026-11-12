import { useState } from "react";
import { useTranslation } from "react-i18next";
import BoatBadge from "../BoatBadge";
import AnalogySplit from "./AnalogySplit";
import {
  RADAR_LINE,
  RADAR_TEXT,
  SCOPE_DASH,
  SCOPE_GRID,
  SCOPE_SUBTEXT,
  SCOPE_TEXT,
} from "./analogyColors";
import {
  factRankText,
  fmtCount,
  fmtFactValue,
  fmtPct,
} from "../../../utils/analogyFormat";
import { FACT_ITEMS, rateOf } from "../../../utils/analogyFacts";

const k = "aiPredictionTab.analogy.facts";
const BOATS = [1, 2, 3, 4, 5, 6];
// 図の大きさ（承認モック mock-compare-v3 の配置。項目名は外向きに寄せ、頂点に一番上の艇番を置く）
const W = 420;
const R = 88;
const CX = W / 2;
const CY = R * 1.38 + 24;
const H = CY + R * 1.38 + 24;
// 太くできる艇の数（2艇を真正面から比べる。3艇目を押すと先に押した艇が戻る。2026-10-09 ユーザー決定）
const MAX_PICKS = 2;

function angle(i, n) {
  return -Math.PI / 2 + (2 * Math.PI * i) / n;
}
function pt(i, n, f) {
  const a = angle(i, n);
  return [CX + R * f * Math.cos(a), CY + R * f * Math.sin(a)];
}
const fr = (rank) => (7 - rank) / 6;

/** 外周と内側の輪（六角形でなく項目数の多角形） */
function RadarRings({ items }) {
  const n = items.length;
  const ring = (f) => items.map((_, i) => pt(i, n, f).join(",")).join(" ");
  return [1, 2, 3, 4, 5, 6].map((r) => (
    <polygon
      key={r}
      points={ring(fr(r))}
      fill="none"
      stroke={`${SCOPE_GRID}${r === 1 ? 0.45 : 0.18})`}
    />
  ));
}

/** 中心から各項目の頂点への軸線 */
function RadarSpokes({ items }) {
  const n = items.length;
  return items.map((_, i) => {
    const [x, y] = pt(i, n, 1);
    return (
      <line
        key={i}
        x1={CX}
        y1={CY}
        x2={x}
        y2={y}
        stroke={`${SCOPE_GRID}0.2)`}
      />
    );
  });
}

/** 1艇の多角形（2枠は白い縁取り付き）。太くする艇は頂点の点も描く */
function RadarBoatShape({ b, cells, n, on }) {
  // 今日の値が無い項目（当地の記録なし等）は中心に落とさず、その項目を飛ばして結ぶ
  const ps = cells
    .map((c, i) => (c.bucket ? pt(i, n, fr(c.bucket)) : null))
    .filter(Boolean);
  const pts = ps.map((p) => p.join(",")).join(" ");
  const w = on ? 3.2 : 1.6;
  const op = on ? 1 : 0.5;
  return (
    <g data-boat={b}>
      {b === 2 && (
        <polygon
          points={pts}
          fill="none"
          stroke="#ffffff"
          strokeOpacity={op}
          strokeWidth={w + 2.4}
        />
      )}
      <polygon
        points={pts}
        fill={on ? RADAR_LINE[b] : "none"}
        fillOpacity={b <= 2 ? 0.14 : 0.22}
        stroke={RADAR_LINE[b]}
        strokeOpacity={op}
        strokeWidth={w}
      />
      {on &&
        ps.map(([px, py], i) => (
          <circle
            key={i}
            cx={px}
            cy={py}
            r={3.6}
            fill={RADAR_LINE[b]}
            stroke={b === 2 ? "#fff" : "#0d1b2e"}
          />
        ))}
    </g>
  );
}

/** 6艇の多角形。太くする艇を最後に描く（上に重なる）。2艇なら後に押した艇が一番上 */
function RadarBoatShapes({ boats, n, picks }) {
  const order = [...BOATS.filter((b) => !picks.includes(b)), ...picks];
  return order.map((b) => (
    <RadarBoatShape
      key={b}
      b={b}
      cells={boats[b - 1].cells}
      n={n}
      on={picks.includes(b)}
    />
  ));
}

/** 典型の破線（値が全部無ければ描かない） */
function RadarDash({ dash, dashBoat, n }) {
  if (dash.every((v) => v === null)) return null;
  return (
    <polygon
      points={dash
        .map((v, i) => (v === null ? null : pt(i, n, fr(v)).join(",")))
        .filter(Boolean)
        .join(" ")}
      fill="none"
      stroke={
        dashBoat === 2 || dashBoat === 1 ? SCOPE_DASH : RADAR_LINE[dashBoat]
      }
      strokeWidth={1.8}
      strokeDasharray="5 4"
    />
  );
}

/** 項目の頂点に置く、その項目で1位の艇番の丸（同順位は辺に沿って並べる） */
function RadarTopBadges({ tops, i, n }) {
  const [tx, ty] = pt(i, n, 1);
  return tops.map((b, j) => {
    // 同順位の艇番は辺に沿う向きに並べる（横の項目では縦に並び、項目名に重ならない）
    const off = (j - (tops.length - 1) / 2) * 16;
    const a = angle(i, n);
    const ox = tx - Math.sin(a) * off;
    const oy = ty + Math.cos(a) * off;
    return (
      <g key={b} data-top={b}>
        <circle
          cx={ox}
          cy={oy}
          r={7.5}
          fill={RADAR_LINE[b]}
          stroke={b === 2 ? "#fff" : "#0d1b2e"}
          strokeWidth={1.2}
        />
        <text
          x={ox}
          y={oy + 3.6}
          textAnchor="middle"
          fontSize="10"
          fontWeight="800"
          fill={RADAR_TEXT[b]}
        >
          {b}
        </text>
      </g>
    );
  });
}

/** 項目名のボタン（押すと項目の表） */
function RadarAxisButton({ it, i, n, sel, name, sub, onAxis }) {
  const { t } = useTranslation();
  const dx = Math.cos(angle(i, n));
  const mid = Math.abs(dx) < 0.3;
  const [x, y] = pt(i, n, mid ? 1.38 : 1.2);
  const anchor = mid ? "middle" : dx > 0 ? "start" : "end";
  const rx = mid ? x - 50 : dx > 0 ? x : x - 100;
  const act = () => onAxis(it.key);
  return (
    <g
      role="button"
      tabIndex={0}
      aria-pressed={sel}
      aria-label={t(`${k}.radar.axisAria`, { item: name })}
      data-af-control="facts_radar_item"
      data-af-toggle=""
      className="af-hep-axis"
      onClick={act}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        act();
      }}
    >
      <rect x={rx} y={y - 15} width={100} height={34} fill="transparent" />
      <text
        x={x}
        y={y}
        textAnchor={anchor}
        fontSize="12.5"
        fontWeight={sel ? 800 : 600}
        fill={sel ? "#ffffff" : SCOPE_TEXT}
        textDecoration={sel ? "underline" : undefined}
      >
        {name} ▼
      </text>
      <text
        x={x}
        y={y + 14}
        textAnchor={anchor}
        fontSize="11.5"
        fill={SCOPE_SUBTEXT}
      >
        {sub}
      </text>
    </g>
  );
}

/** 6艇の線・頂点の艇番・項目名（押すと項目の表） */
function RadarSvg({
  boats,
  items,
  picks,
  dashBoat,
  axisSel,
  onAxis,
  label,
  ariaLabel,
}) {
  const n = items.length;
  const dash = boats[dashBoat - 1].typical;
  return (
    // role="img" の子は読み上げで飾り扱いになり、項目名のボタンが消えるので group にする（ソナーと同じ）
    <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={ariaLabel}>
      <RadarRings items={items} />
      <RadarSpokes items={items} />
      <RadarBoatShapes boats={boats} n={n} picks={picks} />
      <RadarDash dash={dash} dashBoat={dashBoat} n={n} />
      {items.map((it, i) => {
        const tops = BOATS.filter(
          (b) => boats[b - 1].cells[i].rank?.from === 1,
        );
        const { name, sub } = label(i);
        return (
          <g key={it.key}>
            <RadarTopBadges tops={tops} i={i} n={n} />
            <RadarAxisButton
              it={it}
              i={i}
              n={n}
              sel={axisSel === it.key}
              name={name}
              sub={sub}
              onAxis={onAxis}
            />
          </g>
        );
      })}
    </svg>
  );
}

/** 図の中の順位の文（「N位」・同じ値は幅）と項目の短い名前。図・艇の行・項目の表で共用 */
function useRadarText() {
  const { t } = useTranslation();
  const rankText = (r) =>
    !r
      ? "—"
      : r.from === r.to
        ? t(`${k}.stripRank`, { rank: r.from })
        : t(`${k}.stripRankTie`, { from: r.from, to: r.to });
  const itemName = (key) => t(`${k}.items.${key}.short`);
  return { rankText, itemName };
}

/**
 * 七角形の暗い枠（図だけ）。太くする艇 picks の最後の艇の順位を項目名の下に出し、点線もその艇。
 * FactRadar と撮影用の頁（src/snsCapture、完全版 f01 の撮影）が同じ部品を描く
 * @param {{boats: ReturnType<import("../../../utils/analogyFacts").radarBoats>, items: {key: string}[],
 *   picks: number[], axisSel?: string|null, onAxis?: (key: string) => void}} props
 */
export function RadarFigure({ boats, items, picks, axisSel = null, onAxis }) {
  const { t } = useTranslation();
  const { rankText, itemName } = useRadarText();
  const lead = picks[picks.length - 1];
  const label = (i) => ({
    name: itemName(items[i].key),
    sub: t(`${k}.radar.axisSub`, {
      boat: lead,
      rank: rankText(boats[lead - 1].cells[i].rank),
    }),
  });
  // 読み上げは「6艇中N位」（図の中の短い「N位」ではなく。同じ値は幅）
  const ariaRank = (r, it) =>
    !r ? t(`${k}.hexNone`) : factRankText(t, r, it.bad);
  const ariaLabel = t(`${k}.hexLabel`, {
    boat: lead,
    list: items
      .map(
        (it, i) =>
          `${t(`${k}.items.${it.key}.label`)} ${ariaRank(
            boats[lead - 1].cells[i].rank,
            FACT_ITEMS.find((x) => x.key === it.key),
          )}`,
      )
      .join(t("aiPredictionTab.analogy.listSeparator")),
  });
  return (
    <div className="af-dark">
      <RadarSvg
        boats={boats}
        items={items}
        picks={picks}
        dashBoat={lead}
        axisSel={axisSel}
        onAxis={onAxis ?? (() => {})}
        label={label}
        ariaLabel={ariaLabel}
      />
    </div>
  );
}

/**
 * 艇の行（6艇の凡例。押すと太くなる）。行は上から1〜6号艇。FactRadar と撮影用の頁が同じ部品を描く
 * @param {{boats: ReturnType<import("../../../utils/analogyFacts").radarBoats>, items: {key: string}[],
 *   picks: number[], main: number, onPress?: (boat: number) => void}} props
 */
export function RadarBoatLegend({ boats, items, picks, main, onPress }) {
  const { t } = useTranslation();
  const swatch = (b) => (
    <svg className="af-hep-sw" viewBox="0 0 22 8" aria-hidden="true">
      {b === 2 && (
        <line x1="0" y1="4" x2="22" y2="4" stroke="#94a3b8" strokeWidth="5" />
      )}
      <line
        x1="0"
        y1="4"
        x2="22"
        y2="4"
        stroke={b === 1 ? "#cbd5e1" : RADAR_LINE[b]}
        strokeWidth="3"
      />
    </svg>
  );
  return (
    <div className="af-hep-legend" data-af-control="facts_radar_boat">
      {BOATS.map((b) => {
        const x = boats[b - 1];
        const on = picks.includes(b);
        return (
          <button
            key={b}
            type="button"
            aria-pressed={on}
            // 太い艇を押し直すと外れる（状態が変わる）ので数える。主役だけが太いときの主役の押し直しは変わらないので数えない
            data-af-toggle={
              on && picks.length === 1 && b === main ? undefined : ""
            }
            onClick={() => onPress?.(b)}
          >
            {swatch(b)}
            <BoatBadge n={b} size="xs" />
            <span>
              {t(`${k}.radar.boat`, { boat: b, cls: x.cls ?? "—" })}
              {b === main && (
                <small className="af-hep-main">{t(`${k}.radar.main`)}</small>
              )}
            </span>
            <span className="af-hep-cnt">
              {t(`${k}.radar.top2`, { n: items.length, k: x.top2 })}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** 項目の表の1艇の行 */
function RadarTableRow({ x, ix, on, rankText, withUnit }) {
  const { t } = useTranslation();
  const c = x.cells[ix];
  const r = rateOf(c.hit);
  const u = rateOf(x.usual);
  // 緑・赤は表示した値（その順位のときは整数、全レースは小数1桁）の差で決める
  const d =
    r !== null && u !== null
      ? Math.round(r * 100) - Math.round(u * 1000) / 10
      : null;
  return (
    <tr data-boat={x.boat} className={on ? "is-today" : undefined}>
      <th scope="row">
        <BoatBadge n={x.boat} size="xs" />
      </th>
      <td>{c.rank ? withUnit(c.key, c.rank.value) : "—"}</td>
      <td>{rankText(c.rank)}</td>
      <td
        className={
          d === null
            ? undefined
            : d >= 3
              ? "is-up"
              : d <= -3
                ? "is-down"
                : undefined
        }
        data-testid="analogy-radar-at"
      >
        {fmtPct(r)}
        {c.hit && (
          <small>
            {" "}
            {t(`${k}.pairCount`, {
              hits: fmtCount(c.hit[0]),
              n: fmtCount(c.hit[1]),
            })}
          </small>
        )}
      </td>
      <td>{fmtPct(u, 1)}</td>
    </tr>
  );
}

/** 選んだ項目の表（艇ごとの値・順位・今日の条件での率・全レースの率） */
function RadarTable({
  boats,
  ix,
  axisSel,
  picks,
  main,
  rateName,
  cardKeys,
  onCard,
  rankText,
  itemName,
  withUnit,
}) {
  const { t } = useTranslation();
  return (
    <div className="af-hep-table" data-testid="analogy-radar-table">
      <b>{itemName(axisSel)}</b>
      <p className="af-foot">{t(`${k}.radar.tableNote`, { rate: rateName })}</p>
      <div className="af-tbl">
        <table className="af-mk-t">
          <thead>
            <tr>
              <th scope="col">{t(`${k}.radar.colBoat`)}</th>
              <th scope="col">{t(`${k}.radar.colValue`)}</th>
              <th scope="col">{t(`${k}.radar.colRank`)}</th>
              <th scope="col">{t(`${k}.radar.colAt`)}</th>
              <th scope="col">{t(`${k}.radar.colAll`)}</th>
            </tr>
          </thead>
          <tbody>
            {boats.map((x) => (
              <RadarTableRow
                key={x.boat}
                x={x}
                ix={ix}
                on={picks.includes(x.boat)}
                rankText={rankText}
                withUnit={withUnit}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p className="af-foot">
        {t(`${k}.radar.tableFoot`)}
        {cardKeys.has(axisSel) && (
          <>
            {" "}
            <button
              type="button"
              className="af-link"
              onClick={() => onCard(axisSel)}
            >
              {t(`${k}.radar.toCard`, { boat: main })}
            </button>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * 差がつく材料の七角形（項目の数で角の数が変わる。承認モック mock-compare-v3、2026-10-09）。
 * 6艇を重ね、太く塗る艇は最初は主役（一番上で選んだ艇）。凡例の艇を押すと太くなり、2艇まで太くして真正面から比べる
 * （3艇目を押すと先に押した艇が戻る。太い艇をもう一度押すと外れ、0艇になったら主役に戻る。2026-10-09 ユーザー決定で
 * 「主役＋2艇」の切り替えを置き換え）。点線は最後に押した艇の1本。項目の名前を押すと6艇の表。
 * 6艇の値はどれも radarBoats（その艇を一番上で選んだときと同じ集めたレース）から出す
 * @param {{boats: ReturnType<import("../../../utils/analogyFacts").radarBoats>, items: {key:string}[], main: number,
 *   target: 1|2|3, cardKeys: Set<string>, collect: string, onCard: (key: string) => void}} props cardKeys は主役の
 *   カードがある項目、collect は集め方の1行
 */
export default function FactRadar({
  boats,
  items,
  main,
  target,
  cardKeys,
  collect,
  onCard,
  resetKey,
  children = null,
}) {
  const { t } = useTranslation();
  const [picks, setPicks] = useState([main]);
  const [axisSel, setAxisSel] = useState(null);
  // resetKey（主役・着順・時点・範囲）が変わったら選び直す（描画中に state を合わせる React の決まった形）
  const [seenKey, setSeenKey] = useState(resetKey);
  if (seenKey !== resetKey) {
    setSeenKey(resetKey);
    setPicks([main]);
    setAxisSel(null);
  }
  const lead = picks[picks.length - 1];
  const press = (b) =>
    setPicks((ps) => {
      if (!ps.includes(b)) return [...ps, b].slice(-MAX_PICKS);
      const rest = ps.filter((x) => x !== b);
      return rest.length ? rest : [main];
    });
  const finish = t(`aiPredictionTab.analogy.finishWord.${target}`);
  const rateName = t(`aiPredictionTab.analogy.rateName.${target}`);
  const { rankText, itemName } = useRadarText();
  const ix = items.findIndex((it) => it.key === axisSel);
  const unit = (key) => t(`${k}.units.${key}`, "");
  const withUnit = (key, v) => {
    const s = fmtFactValue(key, v);
    return s === "—" || s.endsWith("%") ? s : `${s}${unit(key)}`;
  };

  return (
    <div className="af-hep">
      {/* PC では七角形を左に止め、艇の行・項目の表・差のカード（children）を右に（BOA-813） */}
      <AnalogySplit
        fig={
          <>
            <RadarFigure
              boats={boats}
              items={items}
              picks={picks}
              axisSel={axisSel}
              onAxis={(key) => setAxisSel((s) => (s === key ? null : key))}
            />
            <p className="af-foot">{t(`${k}.radar.hint`)}</p>
          </>
        }
      >
        <RadarBoatLegend
          boats={boats}
          items={items}
          picks={picks}
          main={main}
          onPress={press}
        />
        <p className="af-foot">{collect}</p>
        <p className="af-foot af-hep-typ">
          <i className="is-dash" aria-hidden="true" />
          {t(`${k}.radar.typical`, { boat: lead, finish })}
          {t("aiPredictionTab.analogy.listComma")}
          {t(`${k}.hexFoot`)}
        </p>
        {ix < 0 ? (
          <p className="af-foot">
            {t(`${k}.radar.axisHint`, { rate: rateName })}
          </p>
        ) : (
          <RadarTable
            boats={boats}
            ix={ix}
            axisSel={axisSel}
            picks={picks}
            main={main}
            rateName={rateName}
            cardKeys={cardKeys}
            onCard={onCard}
            rankText={rankText}
            itemName={itemName}
            withUnit={withUnit}
          />
        )}
        {children}
      </AnalogySplit>
    </div>
  );
}
