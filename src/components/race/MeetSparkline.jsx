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
 */
function MeetSparkline({
  points,
  baseline = null,
  referenceSeries = null,
  domain = null,
  color = "var(--brand-accent-primary)",
  upIsBetter = true,
  height = 56,
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
  if (numeric.length < 2) return null;

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
  const x = (i) =>
    values.length === 1 ? W / 2 : padX + (i / (values.length - 1)) * innerW;
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
  // 端の点では吹き出しが箱からはみ出す。中央寄せをやめて端に寄せる
  const tipAlign =
    activeRatio < 0.15 ? "start" : activeRatio > 0.85 ? "end" : "center";
  // 吹き出しは**線の箱の中**に置く。上に出すと見出し（平均・通常値・前検）に、
  // 下に出すと「9/26 / 前走 0.09」の行に重なる。箱は56pxあり、1行の
  // 吹き出し（約22px）なら収まる。合わせている点と反対側の半分に置けば、
  // 見ている点そのものを隠さない
  const tipSide = active && y(active.v) > height / 2 ? "top" : "bottom";

  return (
    <div
      className="meet-sparkline-wrap"
      ref={wrapRef}
      style={{ height }}
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
            r={idx === lastIndex ? 3.2 : 2}
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
      {activeLabel && (
        <span
          className={`meet-sparkline-tip is-${tipAlign} at-${tipSide}`}
          style={{ left: `${(activeRatio * 100).toFixed(2)}%` }}
          aria-hidden="true"
        >
          {activeLabel}
        </span>
      )}
    </div>
  );
}

export default MeetSparkline;
