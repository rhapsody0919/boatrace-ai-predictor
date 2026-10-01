import { Text } from "recharts";

/**
 * 横軸の目盛りラベルを、棒1本に割り当てられた幅（軸の幅 ÷ 目盛りの数）を超えたときだけ空白で折り返す。
 *
 * ko の「N번 보트」は ja の「N号艇」・en の「Boat N」より幅を取り、375px では
 * 隣のラベルと重なる（BOA-615）。幅を固定値で渡すと、収まる en や広い画面でも
 * 折り返してしまうため、棒1本ぶんの幅を基準にする。空白の無い ja・zh-TW は折り返さない。
 *
 * recharts の Text は折り返しの判定に `style` の文字サイズで幅を測る。`fontSize` 属性だけ、
 * または単位の無い数値だと既定の文字サイズ（16px）で測って過大に見積もり、収まるラベルまで
 * 折り返すため、`style` に px 付きで渡す。
 */
export default function BandWrapAxisTick({
  width,
  visibleTicksCount,
  payload,
  fontSize,
  ...rest
}) {
  const bandWidth =
    width > 0 && visibleTicksCount > 0 ? width / visibleTicksCount : undefined;
  return (
    <Text
      {...rest}
      fontSize={fontSize}
      style={{
        fontSize: typeof fontSize === "number" ? `${fontSize}px` : fontSize,
      }}
      width={bandWidth}
      className="recharts-cartesian-axis-tick-value"
    >
      {payload?.value}
    </Text>
  );
}
