import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import AnalogySplit from "./AnalogySplit";
import { fmtCount } from "../../../utils/analogyFormat";
import { sonarRings } from "../../../utils/analogySonar";
import {
  SonarSectors,
  SonarRings,
  SonarDots,
  SonarOverlays,
  SonarRingLabels,
  SonarBoatButtons,
  SonarSweep,
  SonarTip,
  SonarPicks,
} from "./SimilarSonarParts";
import { CX, CY, R, ang } from "./SimilarSonarGeometry";

/** 指の大きさ（画面上の半径。この中の点をまとめて拾う） */
const FINGER_PX = 20;
/** 一度に並べる点の数 */
const MAX_PICKS = 5;
/** 長押しと判定するまでの時間と、スクロールとみなす指の動き */
const LONG_PRESS_MS = 400;
const MOVE_PX = 10;
const BOATS = [1, 2, 3, 4, 5, 6];

/** 外周＝今の件数（拡大・縮小）。100件未満は等間隔、それ以上は対数で中心付近を広げる */
const makeRadius = (n) => (rk) =>
  n < 100
    ? 18 + ((R - 24) * Math.max(1, rk)) / Math.max(n, 1)
    : 18 + ((R - 24) * Math.log10(Math.max(1, rk))) / Math.log10(n);

const placePoint = (x, i, rOf) => {
  const b = x.finish?.[0];
  if (!b || b < 1 || b > 6) return null;
  const rank = i + 1;
  const frac = ((rank * 0.6180339) % 1) * 0.84 + 0.08;
  const a = ((ang(b) - 30 + 60 * frac) * Math.PI) / 180;
  const rr = rOf(rank);
  return { x, b, rank, cx: CX + rr * Math.cos(a), cy: CY + rr * Math.sin(a) };
};

/** 件数から、輪・扇ごとの件数・点の大きさ・点の位置を作る */
const sonarGeometry = (neighbors) => {
  const n = neighbors.length;
  const rOf = makeRadius(n);
  return {
    n,
    rOf,
    rings: sonarRings(n, rOf),
    counts: BOATS.map(
      (b) => neighbors.filter((x) => x.finish?.[0] === b).length,
    ),
    dotR: n > 300 ? 2.4 : n > 100 ? 3.2 : 4.2,
    pts: neighbors.map((x, i) => placePoint(x, i, rOf)).filter(Boolean),
  };
};

/** 画面の座標 → SVG の座標と、画面1pxあたりの SVG の長さ */
const toSvgPoint = (svg, e) => {
  const m = svg?.getScreenCTM();
  if (!m) return null;
  const p = svg.createSVGPoint();
  p.x = e.clientX;
  p.y = e.clientY;
  const q = p.matrixTransform(m.inverse());
  return { x: q.x, y: q.y, unit: 440 / svg.getBoundingClientRect().width };
};

const nearPoints = (pts, loc) => {
  const rad = FINGER_PX * loc.unit;
  return pts
    .map((p) => ({ p, d: Math.hypot(p.cx - loc.x, p.cy - loc.y) }))
    .filter((o) => o.d <= rad)
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_PICKS)
    .map((o) => o.p);
};

/** 吹き出しは指の約50px上。上に場所が無ければ左右の広い方へ */
const tipPosition = (br, e) => {
  const x = e.clientX - br.left;
  const y = e.clientY - br.top;
  const W = 224;
  const above = y - 50 - 72 >= 0;
  const side =
    x > br.width / 2
      ? Math.max(4, x - W - 40)
      : Math.min(br.width - W - 4, x + 40);
  return {
    left: above ? Math.max(4, Math.min(br.width - W - 4, x - W / 2)) : side,
    top: above ? y - 50 - 72 : Math.max(4, y - 36),
  };
};

/** 選んだ点・吹き出しは、作ったときの件数でだけ有効にする（スライダー・扇の絞り込みで件数が変わると
 * 同じ点が別の位置に動くため、外す） */
function useSonarTip(n, svgRef) {
  const [tipState, setTip] = useState(null);
  const [picksState, setPicks] = useState(null);
  const tip = tipState?.n === n ? tipState : null;
  const picks = picksState?.n === n ? picksState : null;
  // 画面を送るか、図の外をタップしたら吹き出しを閉じる（図の中のタップは onClickCapture が閉じる）
  const tipOpen = Boolean(tip);
  useEffect(() => {
    if (!tipOpen) return;
    const close = () => setTip(null);
    const outside = (e) => {
      if (!svgRef.current?.contains(e.target)) setTip(null);
    };
    window.addEventListener("scroll", close, { passive: true });
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("scroll", close);
      document.removeEventListener("pointerdown", outside);
    };
  }, [tipOpen, svgRef]);
  return { tip, picks, setTip, setPicks };
}

/** 指・マウスの操作（長押し・移動・タップ） */
function useSonarPointer(n, pts, svgRef, box, { tip, setTip, setPicks }) {
  const [press, setPress] = useState(null);
  const timer = useRef(null);
  const start = useRef(null);
  const longPressed = useRef(false);
  // 最後に押した指・マウスの種類。click の pointerType はブラウザによって無い（Safari）ので pointerdown で覚える
  const lastPointer = useRef("mouse");
  useEffect(() => () => clearTimeout(timer.current), []);
  // 点の操作は button ではないので、節の計測（analogy_control_change）へ DOM のイベントで知らせる
  const report = (control) =>
    svgRef.current?.dispatchEvent(
      new CustomEvent("af-control", { bubbles: true, detail: control }),
    );
  const showTip = (p, e) => {
    const br = box.current?.getBoundingClientRect();
    if (!br) return;
    setTip({ n, p, ...tipPosition(br, e) });
  };
  const cancelPress = () => {
    clearTimeout(timer.current);
    setPress(null);
  };
  const onPointerDown = (e) => {
    lastPointer.current = e.pointerType || "mouse";
    longPressed.current = false;
    start.current = { x: e.clientX, y: e.clientY };
    clearTimeout(timer.current);
    if (e.pointerType === "mouse") return;
    const loc = toSvgPoint(svgRef.current, e);
    if (!loc) return;
    setPress({ x: loc.x, y: loc.y, r: FINGER_PX * loc.unit });
    const ev = { clientX: e.clientX, clientY: e.clientY };
    timer.current = setTimeout(() => {
      setPress(null);
      const hit = nearPoints(pts, loc);
      if (hit.length) {
        longPressed.current = true;
        showTip(hit[0], ev);
        report("similar_point_hold");
      }
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e) => {
    if (
      start.current &&
      Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) >
        MOVE_PX
    )
      cancelPress();
    if (e.pointerType !== "mouse") return;
    const loc = toSvgPoint(svgRef.current, e);
    const hit = loc ? nearPoints(pts, loc) : [];
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
    if (tip && lastPointer.current !== "mouse") {
      setTip(null);
      e.stopPropagation();
      return;
    }
    const loc = toSvgPoint(svgRef.current, e);
    const hit = loc ? nearPoints(pts, loc) : [];
    if (!hit.length) return;
    e.stopPropagation();
    setPicks({ n, list: hit, x: loc.x, y: loc.y, r: FINGER_PX * loc.unit });
    report("similar_point");
  };
  const onPointerLeave = (e) => {
    cancelPress();
    if (e.pointerType === "mouse") setTip(null);
  };
  return {
    press,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: cancelPress,
      onPointerCancel: cancelPress,
      onPointerLeave,
      onClickCapture,
    },
  };
}

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
 *   picked: string|null, onPick: (raceId: string)=>void, todayLabel: string, legend?: import("react").ReactNode}} props
 */
export default function SimilarSonar({
  neighbors,
  selectedBoat,
  onBoat,
  picked,
  onPick,
  todayLabel,
  legend = null,
  figTop = null,
  children = null,
}) {
  const { t } = useTranslation();
  const k = "aiPredictionTab.analogy.similar";
  const box = useRef(null);
  const svgRef = useRef(null);
  const { n, rOf, rings, counts, dotR, pts } = sonarGeometry(neighbors);
  const tipApi = useSonarTip(n, svgRef);
  const { tip, picks, setTip } = tipApi;
  const { press, handlers } = useSonarPointer(n, pts, svgRef, box, tipApi);
  const pickedIds = new Set((picks?.list ?? []).map((p) => p.x.race_id));
  const first = picks?.list?.[0]?.x.race_id ?? null;

  // PC ではスライダー（figTop）とソナーを左に止め、点の近くの類似レースと結果（children）を右に（BOA-813）
  return (
    <AnalogySplit
      fig={
        <>
          {figTop}
          <div className="af-dark af-sonar" ref={box}>
            <svg
              ref={svgRef}
              viewBox="0 0 440 440"
              role="group"
              aria-label={t(`${k}.sonarLabel`, { n: fmtCount(n) })}
              onContextMenu={(e) => e.preventDefault()}
              data-testid="analogy-sonar"
              {...handlers}
            >
              <SonarSectors
                selectedBoat={selectedBoat}
                counts={counts}
                onBoat={onBoat}
              />
              <SonarRings rings={rings} n={n} rOf={rOf} />
              <SonarDots
                pts={pts}
                picked={picked}
                first={first}
                pickedIds={pickedIds}
                dotR={dotR}
              />
              <SonarOverlays picks={picks} press={press} />
              <SonarRingLabels rings={rings} n={n} rOf={rOf} />
              <SonarBoatButtons onBoat={onBoat} closeTip={() => setTip(null)} />
              <SonarSweep />
            </svg>
            {tip && <SonarTip tip={tip} />}
            <div className="af-dark-cap">
              <span>{todayLabel}</span>
              <span>{t(`${k}.shown`, { n: fmtCount(n) })}</span>
            </div>
          </div>
          {/* 図の見方は文ではなく絵の凡例で、図の真下に（承認モック sonar-tab v3） */}
          {legend}
        </>
      }
    >
      <div className="af-sonar-picks" aria-live="polite">
        <SonarPicks picks={picks} first={first} onPick={onPick} />
      </div>
      {children}
    </AnalogySplit>
  );
}
