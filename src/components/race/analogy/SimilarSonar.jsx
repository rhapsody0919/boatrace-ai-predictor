import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import BoatBadge from "../BoatBadge";
import { BOAT_COLORS } from "../../../utils/colors";
import { SCOPE_FLOW, SCOPE_SUBTEXT } from "./analogyColors";
import { fmtDate, fmtCount, venueLabel } from "../../../utils/analogyFormat";
import { sonarRings } from "../../../utils/analogySonar";

const CX = 220;
const CY = 220;
const R = 188;
const ang = (b) => -90 + (b - 1) * 60;
/** 指の大きさ（画面上の半径。この中の点をまとめて拾う） */
const FINGER_PX = 20;
/** 一度に並べる点の数 */
const MAX_PICKS = 5;
/** 長押しと判定するまでの時間と、スクロールとみなす指の動き */
const LONG_PRESS_MS = 400;
const MOVE_PX = 10;
/** 輪のラベルを置く向き（1号艇と2号艇の扇の境目の線上。点が一番集まる1号艇の扇の中に置かない） */
const LABEL_ANGLE = (-60 * Math.PI) / 180;

/**
 * ソナー（spec B-5、承認モック sonar-tab v3）。中心＝今日、点＝類似レース（類似度の高い順の何番目かで中心からの
 * 距離。外周＝今出している件数なので、件数のスライダーで図が拡大・縮小する）、扇＝1着の艇の方向。
 * - タップ: 指の大きさの範囲にある点を近い順に最大5件、図の下に並べる（各行から一覧で見比べる）
 * - 長押し: 一番近い1件の情報をその場の吹き出しに出す。押している間は指の周りに輪が満ちる。指が動いたら
 *   スクロールとみなしてやめる。吹き出しは外をタップするか画面を送ると閉じる
 * - パソコン: マウスを重ねると同じ吹き出し
 * - 点が無い所をタップすると、今までどおり扇（その艇が勝ったレースで絞る）
 * 点は小さいままにし、当たり判定だけ指の大きさにする（2026-10-08 ユーザー指摘「押しづらい・長押ししづらい」）
 * @param {{neighbors: object[], selectedBoat: number|null, onBoat: (b:number)=>void,
 *   picked: string|null, onPick: (raceId: string)=>void, todayLabel: string}} props
 */
export default function SimilarSonar({
  neighbors,
  selectedBoat,
  onBoat,
  picked,
  onPick,
  todayLabel,
}) {
  const { t } = useTranslation();
  const k = "aiPredictionTab.analogy.similar";
  // 選んだ点・吹き出しは、作ったときの件数でだけ有効にする（スライダー・扇の絞り込みで件数が変わると
  // 同じ点が別の位置に動くため、外す）
  const [tipState, setTip] = useState(null);
  const [picksState, setPicks] = useState(null);
  const [press, setPress] = useState(null);
  const box = useRef(null);
  const svgRef = useRef(null);
  const timer = useRef(null);
  const start = useRef(null);
  const longPressed = useRef(false);
  const n = neighbors.length;
  const tip = tipState?.n === n ? tipState : null;
  const picks = picksState?.n === n ? picksState : null;
  useEffect(() => () => clearTimeout(timer.current), []);
  // 画面を送ったら吹き出しを閉じる
  useEffect(() => {
    if (!tip) return;
    const close = () => setTip(null);
    window.addEventListener("scroll", close, { passive: true });
    return () => window.removeEventListener("scroll", close);
  }, [tip]);

  // 外周＝今の件数（拡大・縮小）。100件未満は等間隔、それ以上は対数で中心付近を広げる
  const lin = n < 100;
  const rOf = (rk) =>
    lin
      ? 18 + ((R - 24) * Math.max(1, rk)) / Math.max(n, 1)
      : 18 + ((R - 24) * Math.log10(Math.max(1, rk))) / Math.log10(n);
  const rings = sonarRings(n, rOf);
  const counts = [1, 2, 3, 4, 5, 6].map(
    (b) => neighbors.filter((x) => x.finish?.[0] === b).length,
  );
  const dotR = n > 300 ? 2.4 : n > 100 ? 3.2 : 4.2;
  const pts = neighbors
    .map((x, i) => {
      const b = x.finish?.[0];
      if (!b || b < 1 || b > 6) return null;
      const rank = i + 1;
      const frac = ((rank * 0.6180339) % 1) * 0.84 + 0.08;
      const a = ((ang(b) - 30 + 60 * frac) * Math.PI) / 180;
      const rr = rOf(rank);
      return {
        x,
        b,
        rank,
        cx: CX + rr * Math.cos(a),
        cy: CY + rr * Math.sin(a),
      };
    })
    .filter(Boolean);

  const pointLabel = (x) =>
    t(`${k}.point`, {
      date: fmtDate(x.date),
      venue: venueLabel(x.venue_code, t),
      r: x.race_number,
      b: x.finish?.[0],
    });
  // 画面の座標 → SVG の座標と、画面1pxあたりの SVG の長さ
  const toSvg = (e) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!m) return null;
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const q = p.matrixTransform(m.inverse());
    return { x: q.x, y: q.y, unit: 440 / svg.getBoundingClientRect().width };
  };
  const near = (loc) => {
    const rad = FINGER_PX * loc.unit;
    return pts
      .map((p) => ({ p, d: Math.hypot(p.cx - loc.x, p.cy - loc.y) }))
      .filter((o) => o.d <= rad)
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_PICKS)
      .map((o) => o.p);
  };
  // 吹き出しは指の約50px上。上に場所が無ければ左右の広い方へ
  const showTip = (p, e) => {
    const br = box.current?.getBoundingClientRect();
    if (!br) return;
    const x = e.clientX - br.left;
    const y = e.clientY - br.top;
    const W = 224;
    const above = y - 50 - 72 >= 0;
    setTip({
      n,
      p,
      left: above
        ? Math.max(4, Math.min(br.width - W - 4, x - W / 2))
        : x > br.width / 2
          ? Math.max(4, x - W - 40)
          : Math.min(br.width - W - 4, x + 40),
      top: above ? y - 50 - 72 : Math.max(4, y - 36),
    });
  };

  const onPointerDown = (e) => {
    longPressed.current = false;
    start.current = { x: e.clientX, y: e.clientY };
    clearTimeout(timer.current);
    if (e.pointerType === "mouse") return;
    const loc = toSvg(e);
    if (!loc) return;
    setPress({ x: loc.x, y: loc.y, r: FINGER_PX * loc.unit });
    const ev = { clientX: e.clientX, clientY: e.clientY };
    timer.current = setTimeout(() => {
      setPress(null);
      const hit = near(loc);
      if (hit.length) {
        longPressed.current = true;
        showTip(hit[0], ev);
        report("similar_point_hold");
      }
    }, LONG_PRESS_MS);
  };
  const cancelPress = () => {
    clearTimeout(timer.current);
    setPress(null);
  };
  const onPointerMove = (e) => {
    if (
      start.current &&
      Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) >
        MOVE_PX
    )
      cancelPress();
    if (e.pointerType !== "mouse") return;
    const loc = toSvg(e);
    const hit = loc ? near(loc) : [];
    if (hit.length) showTip(hit[0], e);
    else setTip(null);
  };
  // タップ。点の上なら近い点を並べて扇には渡さない（capture で止める）。点が無ければ扇の操作に任せる
  const onClickCapture = (e) => {
    if (e.target.closest?.("[data-testid^='analogy-sonar-boat-']")) return;
    if (longPressed.current) {
      longPressed.current = false;
      e.stopPropagation();
      return;
    }
    if (tip && e.nativeEvent.pointerType !== "mouse") {
      setTip(null);
      e.stopPropagation();
      return;
    }
    const loc = toSvg(e);
    const hit = loc ? near(loc) : [];
    if (!hit.length) return;
    e.stopPropagation();
    setPicks({ n, list: hit, x: loc.x, y: loc.y, r: FINGER_PX * loc.unit });
    report("similar_point");
  };
  // 点の操作は button ではないので、節の計測（analogy_control_change）へ DOM のイベントで知らせる
  const report = (control) =>
    svgRef.current?.dispatchEvent(
      new CustomEvent("af-control", { bubbles: true, detail: control }),
    );

  const pickedIds = new Set((picks?.list ?? []).map((p) => p.x.race_id));
  const first = picks?.list?.[0]?.x.race_id ?? null;
  const raceInfo = (x) =>
    [
      `${fmtDate(x.date)} ${venueLabel(x.venue_code, t)}${x.race_number}R`,
      x.grade ? t(`aiPredictionTab.analogy.grades.${x.grade}`, x.grade) : null,
      x.round
        ? t(`aiPredictionTab.analogy.outlook.roundNames.${x.round}`)
        : null,
    ]
      .filter(Boolean)
      .join(" ");
  const result = (x) => (
    <>
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
    </>
  );

  return (
    <>
      <div className="af-dark af-sonar" ref={box}>
        <svg
          ref={svgRef}
          viewBox="0 0 440 440"
          role="group"
          aria-label={t(`${k}.sonarLabel`, { n: fmtCount(n) })}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={cancelPress}
          onPointerCancel={cancelPress}
          onPointerLeave={(e) => {
            cancelPress();
            if (e.pointerType === "mouse") setTip(null);
          }}
          onContextMenu={(e) => e.preventDefault()}
          onClickCapture={onClickCapture}
          data-testid="analogy-sonar"
        >
          {[1, 2, 3, 4, 5, 6].map((b) => {
            const a0 = ((ang(b) - 30) * Math.PI) / 180;
            const a1 = ((ang(b) + 30) * Math.PI) / 180;
            return (
              <path
                key={`s${b}`}
                d={`M${CX},${CY}L${CX + R * Math.cos(a0)},${CY + R * Math.sin(a0)}A${R},${R} 0 0 1 ${CX + R * Math.cos(a1)},${CY + R * Math.sin(a1)}Z`}
                fill={SCOPE_FLOW[b]}
                fillOpacity={selectedBoat === b ? 0.16 : 0.05}
                stroke="#0d1b2e"
                role="button"
                tabIndex={0}
                aria-label={t(`${k}.sector`, {
                  b,
                  n: fmtCount(counts[b - 1]),
                })}
                aria-pressed={selectedBoat === b}
                data-af-control="similar_boat"
                data-af-toggle
                style={{ cursor: "pointer" }}
                onClick={() => onBoat(b)}
                onKeyDown={(e) =>
                  (e.key === "Enter" || e.key === " ") &&
                  (e.preventDefault(), onBoat(b))
                }
              />
            );
          })}
          {rings.map((r) => (
            <circle
              key={`r${r}`}
              cx={CX}
              cy={CY}
              r={rOf(r)}
              fill="none"
              stroke="#c9a227"
              strokeOpacity="0.45"
              pointerEvents="none"
            />
          ))}
          <circle
            cx={CX}
            cy={CY}
            r={rOf(n)}
            fill="none"
            stroke="#c9a227"
            strokeOpacity="0.7"
            pointerEvents="none"
          />
          {pts.map(({ x, b, cx, cy }) => {
            const hl = picked === x.race_id || first === x.race_id;
            const sub = !hl && pickedIds.has(x.race_id);
            return (
              <circle
                key={x.race_id}
                cx={cx.toFixed(1)}
                cy={cy.toFixed(1)}
                r={hl ? 6 : sub ? 4.6 : dotR}
                fill={SCOPE_FLOW[b]}
                stroke={hl || sub ? "#fff" : "#0d1b2e"}
                strokeWidth={hl ? 2.5 : sub ? 1.5 : 0.8}
                pointerEvents="none"
                aria-label={pointLabel(x)}
              />
            );
          })}
          {picks && (
            <circle
              cx={picks.x}
              cy={picks.y}
              r={picks.r}
              fill="rgba(232,208,137,.12)"
              stroke={SCOPE_SUBTEXT}
              strokeDasharray="3 3"
              pointerEvents="none"
            />
          )}
          {press && (
            <circle
              className="af-sonar-press"
              cx={press.x}
              cy={press.y}
              r={press.r}
              fill="none"
              stroke="#f3ead0"
              strokeWidth="3"
              pathLength="100"
              strokeDasharray="100"
              strokeDashoffset="100"
              pointerEvents="none"
            />
          )}
          {/* 輪の目安。1号艇と2号艇の扇の境目の線上に、縁取りを付けて置く（点の上でも読める） */}
          {[...rings, n].map((r) => (
            <text
              key={`l${r}`}
              x={CX + rOf(r) * Math.cos(LABEL_ANGLE) + 4}
              y={CY + rOf(r) * Math.sin(LABEL_ANGLE) - 3}
              fill={r === n ? "#f3ead0" : SCOPE_SUBTEXT}
              fontSize="14"
              fontWeight={r === n ? 700 : 400}
              paintOrder="stroke"
              stroke="#0d1b2e"
              strokeWidth="3.5"
              pointerEvents="none"
            >
              {t(`${k}.ring`, { n: fmtCount(r) })}
            </text>
          ))}
          {[1, 2, 3, 4, 5, 6].map((b) => {
            const a = (ang(b) * Math.PI) / 180;
            const x = CX + (R + 18) * Math.cos(a);
            const y = CY + (R + 18) * Math.sin(a);
            // 図の外の艇番も押せる（点が密な扇は、扇を押しても点のタップになるため）。
            // 読み上げ・キーボードは扇の role="button" が受け持つので、ここは指・マウスだけ
            return (
              <g
                key={`b${b}`}
                style={{ cursor: "pointer" }}
                onClick={(e) => {
                  e.stopPropagation();
                  onBoat(b);
                }}
                data-af-control="similar_boat"
                data-af-toggle
                data-af-tap
                data-testid={`analogy-sonar-boat-${b}`}
              >
                <rect
                  x={x - 11}
                  y={y - 11}
                  width="22"
                  height="22"
                  rx="4"
                  fill={BOAT_COLORS[b].bg}
                  stroke="#94a3b8"
                />
                <text
                  x={x}
                  y={y + 5}
                  textAnchor="middle"
                  fontSize="13"
                  fontWeight="700"
                  fill={BOAT_COLORS[b].text}
                >
                  {b}
                </text>
              </g>
            );
          })}
          {/* 回る線は飾り。1着の扇（押せる）と同じ形・色にすると特定の艇を指しているように見えるので、細い線にする（BOA-778） */}
          <g className="af-sweep" pointerEvents="none" aria-hidden="true">
            <line
              x1={CX}
              y1={CY}
              x2={CX + R}
              y2={CY}
              stroke={SCOPE_SUBTEXT}
              strokeOpacity=".35"
              strokeWidth="1"
            />
          </g>
          <circle
            cx={CX}
            cy={CY}
            r="6"
            fill={SCOPE_SUBTEXT}
            pointerEvents="none"
          />
        </svg>
        {tip && (
          <div
            className="af-sonar-tip"
            role="status"
            style={{ left: tip.left, top: tip.top }}
            data-testid="analogy-sonar-tip"
          >
            <b>{t(`${k}.tipRank`, { n: tip.p.rank })}</b>
            <br />
            {raceInfo(tip.p.x)}
            <br />
            {result(tip.p.x)}
          </div>
        )}
        <div className="af-dark-cap">
          <span>{todayLabel}</span>
          <span>{t(`${k}.shown`, { n: fmtCount(n) })}</span>
        </div>
      </div>
      <div className="af-sonar-picks" aria-live="polite">
        {picks ? (
          <>
            {picks.list.length > 1 && (
              <p className="af-sub">
                {t(`${k}.picksLede`, { n: picks.list.length })}
              </p>
            )}
            {[...picks.list]
              .sort((a, b) => a.rank - b.rank)
              .map((p) => (
                <div
                  key={p.x.race_id}
                  className={`af-sonar-pick${p.x.race_id === first ? " is-first" : ""}`}
                  data-testid="analogy-sonar-pick"
                >
                  <span className="af-sonar-pick-rank">
                    {t(`${k}.ring`, { n: p.rank })}
                  </span>
                  <span className="af-sonar-pick-race">{raceInfo(p.x)}</span>
                  <button
                    type="button"
                    className="af-btn"
                    data-af-control="similar_point_open"
                    onClick={() => onPick(p.x.race_id)}
                  >
                    {t(`${k}.pickCompare`)}
                  </button>
                  <span className="af-sonar-pick-res">{result(p.x)}</span>
                </div>
              ))}
          </>
        ) : (
          <p className="af-sub">{t(`${k}.picksEmpty`)}</p>
        )}
      </div>
    </>
  );
}
