import { useEffect, useRef, useState } from "react";
import "./MeetSparkline.css";

/**
 * 今節の走順に並べた小さな折れ線（軸なし）。
 *
 * ## なぜ数字の羅列ではなく線なのか
 *
 * 今節のST・展示は「上がってきたか」を読むための数字で、値そのものより
 * **並びの形**が意味を持つ。表の列に数字が縦に並ぶだけだと、8走ぶんの
 * 上下を頭の中で組み立てることになる（2026-09-27、ファン視点の議論）。
 *
 * ## 上ほど良い（速い）向きで描く
 *
 * ST・展示タイムは**小さいほど速い**。素の値をそのまま縦位置にすると
 * 「速い＝下」になり、同じPRで直した展示タイムの棒グラフ（長いほど速い）と
 * 逆になる。「上がり調子」という日常語とも合わないので、**値を反転して
 * 上ほど速い**に統一する。`upIsBetter` を false にすると素の向きになる。
 *
 * ## 点に合わせると、その走が何だったかを出す（2026-09-28）
 *
 * 線の形は「上がってきたか」を読むためのもので、そこまでは軸が無くても読める。
 * ただし「この山は何走目の、どのレースだったのか」は線だけでは分からず、
 * 下の「日別の走り」表と目で突き合わせることになっていた。
 * 点に合わせたら日付・R・その点の値・着順を出す。
 *
 * **ホバーだけにしない。** 390px幅が主戦場で、そこにホバーは無い。
 * タップでも出し、外側をタップすると消える。指を横に滑らせている間は
 * 追従するが、縦のスクロールは奪わない（`touch-action: pan-y`）。
 *
 * **点そのものを狙わせない。** 点は半径2px（前走だけ3.2px）で、指でも
 * 細いポインタでも直接は当たらない。横方向で最も近い点を選ぶので、
 * グラフのどこに合わせても必ず1つ選ばれる。
 *
 * ## 断定はしない
 *
 * 「上向き/下向き」の判定文は出さない。初日と直近の2点だけで断定して
 * 実態と逆の結論を出していた反省（同PR）から、形と基準線を見せて
 * 読み手に委ねる。
 *
 * @param {Array<{value: number|null, label?: string}>} points 走順（古い→新しい）。
 *   `label` を渡すと、その点に合わせたときに出す文字列として使う。
 *   文言の組み立て（i18n）は呼び出し側の責任で、この部品は表示するだけ
 * @param {number|null} [baseline] 破線の水平線で引く基準（STはその選手の
 *   通常平均）
 * @param {Array<number|null>} [referenceSeries] 破線の**折れ線**で引く基準。
 *   走ごとに動く基準（展示の「その日の会場平均」）に使う。水面は日ごとに
 *   0.08秒動くため、水平線1本では重い日と軽い日を同じ物差しで比べてしまう
 * @param {string} [color] 線の色（CSS値）
 * @param {[number, number]|null} [domain] 縦の物差しを外から固定する
 *   （6艇を同じ尺で並べるとき）。省略すると自分の最小〜最大に伸びる
 * @param {boolean} [upIsBetter] 値が小さいほど上に描く（既定 true）
 * @param {number} [height] 高さ（px）
 * @param {Array<{text: string|number, win?: boolean, mark?: boolean}|null>} [pointLabels]
 *   各点の下に出す短い文字（6艇の推移では着順）。`points` と同じ並び。
 *   値（ST・展示）が無い走でも、その横位置に出す（欠場・フライングも並びに残す）
 * @param {boolean} [allowSinglePoint] 値が1つでも描く（既定 false）。6艇を
 *   並べる推移では、1走の選手の行が空白だと「取れていない」と読まれるので、
 *   前走の点を1つだけ右端（他の行の前走と同じ横位置）に置く
 * @param {boolean} [markLast] 最後の点を「前走」として大きく描く（既定 true）。
 *   前走が F・L（値が無い）のときは false にする。1つ前の走が前走に見えるため
 */
// 点の下の文字（着順）の帯の高さ（px）
const LABEL_STRIP_HEIGHT = 13;

function MeetSparkline({
  points,
  baseline = null,
  referenceSeries = null,
  domain = null,
  color = "var(--brand-accent-primary)",
  upIsBetter = true,
  height = 56,
  allowSinglePoint = false,
  pointLabels = null,
  markLast = true,
}) {
  // どの点に合わせているか。null は「どこにも合わせていない」
  const [activeIndex, setActiveIndex] = useState(null);
  const wrapRef = useRef(null);

  // タップで出した吹き出しは、外側をタップするまで消さない（読ませるため）。
  // マウスは onPointerLeave で消えるので、この後始末は主にタッチ向け
  useEffect(() => {
    if (activeIndex === null) return undefined;
    const onDocDown = (event) => {
      if (!wrapRef.current?.contains(event.target)) setActiveIndex(null);
    };
    document.addEventListener("pointerdown", onDocDown);
    return () => document.removeEventListener("pointerdown", onDocDown);
  }, [activeIndex]);

  const values = (points ?? []).map((p) => p.value);
  const numeric = values.filter((v) => typeof v === "number");
  const canDraw = numeric.length >= (allowSinglePoint ? 1 : 2);

  // 箱の実際の幅（px）。点の下の着順の間隔を実寸で測り、詰まる行だけ字を小さくする
  // （BOA-537 ファン評価2周目。走数で一律に字を小さくすると、PCでも小さくなった）
  const [boxWidth, setBoxWidth] = useState(0);
  const hasLabels = Boolean(pointLabels);
  useEffect(() => {
    const el = wrapRef.current;
    if (!canDraw || !hasLabels || !el) return undefined;
    setBoxWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver((entries) => {
      setBoxWidth(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [canDraw, hasLabels]);

  if (!canDraw) return null;

  const refNumeric = (referenceSeries ?? []).filter(
    (v) => typeof v === "number",
  );
  const candidates = [
    ...numeric,
    ...refNumeric,
    ...(baseline === null ? [] : [baseline]),
  ];
  // domain を渡すと縦の物差しを外から固定できる。6艇を並べるときは
  // 全艇共通にしないと、各艇が自分の最小〜最大に伸びて比較にならない
  const min = domain ? domain[0] : Math.min(...candidates);
  const max = domain ? domain[1] : Math.max(...candidates);
  // 全点が同値でも線が潰れないように最小の幅を持たせる
  const span = max - min < 0.005 ? 0.005 : max - min;

  // viewBoxの幅。`preserveAspectRatio="none"` で横いっぱいに伸ばすため、
  // この値が実際の表示幅から離れるほど点（circle）が楕円に歪む。
  // 390px幅の端末での実表示が約340pxなので、それに近い値にして歪みを消す
  // （100にしていたときは3.4倍に引き伸ばされて明らかに潰れていた）
  const W = 340;
  const padY = 6;
  // 左右にも余白を取る。0だと両端の点（前走を含む）が半分見切れる
  const padX = 5;
  const innerH = height - padY * 2;
  const innerW = W - padX * 2;
  // 1走だけのときは右端（他の行の「前走」と同じ横位置）に置く
  const x = (i) =>
    values.length === 1 ? W - padX : padX + (i / (values.length - 1)) * innerW;
  const y = (v) => {
    const ratio = (v - min) / span;
    // upIsBetter: 小さい値（速い）を上に
    return padY + (upIsBetter ? ratio : 1 - ratio) * innerH;
  };

  // null は線を切らずに前後をつなぐ（欠測で線が分断されると形が読めない）
  const drawn = values
    .map((v, i) => (typeof v === "number" ? { i, v } : null))
    .filter(Boolean);
  const path = drawn.map((d) => `${x(d.i).toFixed(2)},${y(d.v).toFixed(2)}`);
  const lastIndex = drawn.length - 1;
  // 点の下の着順の間隔（px）
  const labelGapPx =
    values.length > 1 && boxWidth > 0
      ? (boxWidth * (innerW / W)) / (values.length - 1)
      : Infinity;
  // 間隔が足りない行は、間引かずに字を小さくして全走を1段に並べる。2段に振り分けると
  // 段ごとに左から読んで順番を読み違える（BOA-537 ファン評価3周目）。
  // 全角1文字は字の大きさとほぼ同じ幅なので、間隔より3px小さくすれば隣と接しない。
  // 7px を下限にする（それ以下は読めない）。375px（線の幅149px）では、12走までは10px、
  // 13〜15走で小さくなり、16走以上は7pxのまま数字どうしが接しうる。1節は多くて12走前後
  const labelFontPx =
    pointLabels && labelGapPx < 13
      ? Math.max(7, Math.floor((labelGapPx - 3) * 2) / 2)
      : null;

  // 値のある点のうち、ポインタの横位置に最も近いものを選ぶ。
  // viewBox は `preserveAspectRatio="none"` で横に引き伸ばされるため、
  // SVG座標ではなく**実表示幅に対する割合**で比べる
  const pickNearest = (event) => {
    const el = wrapRef.current;
    if (!el || drawn.length === 0) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    let best = drawn[0];
    let bestDist = Infinity;
    for (const d of drawn) {
      const dist = Math.abs(x(d.i) / W - ratio);
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    setActiveIndex(best.i);
  };

  const active =
    activeIndex === null
      ? null
      : (drawn.find((d) => d.i === activeIndex) ?? null);
  const activeLabel = active ? (points[active.i]?.label ?? null) : null;
  const activeRatio = active ? x(active.i) / W : 0;
  // 吹き出しは**点に追従させず、近い方の端に寄せる**。点の位置に置くと
  // 長い文言で箱からはみ出す（390pxでの実測: 箱308pxに対して
  // ja「9/26 11R・展示 6.69(3)・着外(順位不明)」が241px、
  // en「9/26 R11 · Trial 6.69(3) · Unplaced (rank unknown)」が302px。
  // 点が左から20%の位置だと、中央寄せで左へ89pxはみ出す）。
  // どの点を見ているかは点を囲う輪が示すので、位置で示さなくてよい
  const tipX = activeRatio > 0.5 ? "right" : "left";
  // 吹き出しは**線の箱の中**に置く。上に出すと見出し（平均・通常値・前検）に、
  // 下に出すと「9/26 / 前走 0.09」の行に重なる。箱は56pxあり、1行の
  // 吹き出し（約22px）なら収まる。合わせている点と反対側の半分に置けば、
  // 見ている点そのものを隠さない
  const tipSide = active && y(active.v) > height / 2 ? "top" : "bottom";

  return (
    <div
      className="meet-sparkline-wrap"
      ref={wrapRef}
      style={{ height: pointLabels ? height + LABEL_STRIP_HEIGHT : height }}
      onPointerMove={pickNearest}
      onPointerDown={pickNearest}
      onPointerLeave={() => setActiveIndex(null)}
      onPointerCancel={() => setActiveIndex(null)}
    >
      <svg
        className="meet-sparkline"
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        /* 同じ内容は下の「日別の走り」表にあるので、支援技術には出さない。
           ここは形を読むための絵で、点の値は表が正になる */
        role="presentation"
        style={{ height }}
      >
        {refNumeric.length >= 2 && (
          // 基準が日ごとに動く場合（展示のその日の会場平均）は折れ線で引く。
          // 1本の水平線にすると、水面が重い日と軽い日を同じ物差しで比べてしまう
          <polyline
            className="meet-sparkline-baseline"
            fill="none"
            points={(referenceSeries ?? [])
              .map((v, i) =>
                typeof v === "number"
                  ? `${x(i).toFixed(2)},${y(v).toFixed(2)}`
                  : null,
              )
              .filter(Boolean)
              .join(" ")}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {baseline !== null && (
          <line
            className="meet-sparkline-baseline"
            x1={padX}
            x2={W - padX}
            y1={y(baseline)}
            y2={y(baseline)}
            vectorEffect="non-scaling-stroke"
          />
        )}
        <polyline
          className="meet-sparkline-line"
          points={path.join(" ")}
          stroke={color}
          vectorEffect="non-scaling-stroke"
        />
        {drawn.map((d, idx) => (
          <circle
            key={d.i}
            cx={x(d.i)}
            cy={y(d.v)}
            // 前走だけ大きくする（「今どこにいるか」が一番知りたい点）
            r={markLast && idx === lastIndex ? 3.2 : 2}
            fill={color}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {active && (
          // 合わせている点を囲う。点そのものを大きくすると「前走だけ大きい」の
          // 意味が壊れるので、外側に輪を足す
          <circle
            className="meet-sparkline-active"
            cx={x(active.i)}
            cy={y(active.v)}
            r={5}
            fill="none"
            stroke={color}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {pointLabels && (
        // 点の下の文字は HTML で置く。SVG は横に引き伸ばす（preserveAspectRatio none）
        // ので、SVG の text にすると文字が横に潰れる。横位置は点と同じ割合で合わせる
        // 走数が多い（10走以上）と375pxで数字の間隔が10px前後まで詰まる。字を
        // 小さくして、全角の記号（落・欠など）どうしが接しないようにする（BOA-537）
        <div className="meet-sparkline-labels" aria-hidden="true">
          {pointLabels.map((lab, i) =>
            lab === null || lab === undefined ? null : (
              <span
                key={i}
                className={[
                  "meet-sparkline-label",
                  lab.win ? "is-win" : "",
                  lab.mark ? "is-mark" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{
                  left: `${((x(i) / W) * 100).toFixed(2)}%`,
                  ...(labelFontPx ? { fontSize: `${labelFontPx}px` } : {}),
                }}
              >
                {lab.text}
              </span>
            ),
          )}
        </div>
      )}
      {activeLabel && (
        <span
          className={`meet-sparkline-tip x-${tipX} at-${tipSide}`}
          aria-hidden="true"
        >
          {activeLabel}
        </span>
      )}
    </div>
  );
}

export default MeetSparkline;
