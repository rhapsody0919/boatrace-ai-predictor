import { useRef, useState } from "react";
import "./MeetSparkline.css";
import { useBoxWidth, useDismissOnOutsidePointer } from "./MeetSparklineHooks";
import { readSparkInputs } from "./MeetSparklineLayout";
import MeetSparklineView from "./MeetSparklineView";

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
 * @param {Array<number>} [xPositions] 各点の横位置（0〜1の割合）。日付の横軸で
 *   6行をそろえるときに渡す（BOA-538）。省略すると走った順で左右いっぱい
 * @param {Array<number>} [xCenters] 各点の「日の位置」（0〜1）。渡すと、日の位置からの
 *   ずれを画面上で最大8pxにする。広い画面で同じ日の2走が離れすぎ、2点ずつの組に
 *   見えなくなるのを防ぐ（BOA-538 ファン評価2周目）
 * @param {Array<boolean>} [breakBefore] その点の前で線を切るか（走っていない日を
 *   またぐとき）。`points` と同じ並び
 * @param {boolean} [allowSinglePoint] 値が1つでも描く（既定 false）。6艇を
 *   並べる推移では、1走の選手の行が空白だと「取れていない」と読まれるので、
 *   前走の点を1つだけ右端（他の行の前走と同じ横位置）に置く
 * @param {boolean} [markLast] 最後の点を「前走」として大きく描く（既定 true）。
 *   前走が F・L（値が無い）のときは false にする。1つ前の走が前走に見えるため
 */

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
  xPositions = null,
  xCenters = null,
  breakBefore = null,
}) {
  // どの点に合わせているか。null は「どこにも合わせていない」
  const [activeIndex, setActiveIndex] = useState(null);
  const wrapRef = useRef(null);
  useDismissOnOutsidePointer(wrapRef, activeIndex, setActiveIndex);

  const { values, numeric, canDraw, hasLabels } = readSparkInputs({
    points,
    allowSinglePoint,
    pointLabels,
    xCenters,
  });

  const boxWidth = useBoxWidth(wrapRef, canDraw, hasLabels);

  if (!canDraw) return null;

  return (
    <MeetSparklineView
      points={points}
      values={values}
      numeric={numeric}
      baseline={baseline}
      referenceSeries={referenceSeries}
      domain={domain}
      color={color}
      upIsBetter={upIsBetter}
      height={height}
      pointLabels={pointLabels}
      markLast={markLast}
      xPositions={xPositions}
      xCenters={xCenters}
      breakBefore={breakBefore}
      boxWidth={boxWidth}
      wrapRef={wrapRef}
      activeIndex={activeIndex}
      setActiveIndex={setActiveIndex}
    />
  );
}

export default MeetSparkline;
