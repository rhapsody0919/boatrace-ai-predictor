import { useState } from "react";
import { baseVerdict } from "../../../utils/assistModel";
import { wilsonInterval } from "../../../utils/wilson";
import {
  BaseBarLabel,
  BaseBarTrack,
  BaseBarValue,
  BaseBarMore,
} from "./BaseBarParts";

/**
 * 基準つきバー（spec D-21）と普通のバー（base を渡さない）。値・ぶれ幅・全国の全レースの太い点線・
 * 参考の細い点線（refRate）・3段階の言葉。件数・ぶれ幅・ポイント差はバーを押すと開く（D-32）。
 * 件数が0なら出さない（Codex U02）。few のときは高め・低めを付けず「件数少なめ」（D-37）。
 * labelRate=false は名前の横の割合を出さない（右端の割合だけ。決まり手の棒のように同じ割合を2回書かない）
 * showBase=true は名前の横の割合に基準の値を添える（「58.0%（全国 55%）」。堅い？荒れる？の材料のシート、BOA-801 4）
 */
export default function BaseBar({
  label,
  k,
  n,
  base = null,
  refRate = null,
  few = false,
  labelRate = true,
  showBase = false,
}) {
  const [open, setOpen] = useState(false);
  if (!n) return null;
  const v = base == null ? null : baseVerdict(k, n, base);
  const [lo, hi] = v ? [v.lo, v.hi] : wilsonInterval(k, n);
  const rate = k / n;
  const verdict = v && !few ? v.verdict : null;
  return (
    <div className="ta-bar">
      <button
        type="button"
        className="ta-bar-btn"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <BaseBarLabel
          label={label}
          rate={rate}
          base={base}
          v={v}
          few={few}
          verdict={verdict}
          labelRate={labelRate}
          showBase={showBase}
        />
        <BaseBarTrack
          rate={rate}
          lo={lo}
          hi={hi}
          base={base}
          refRate={refRate}
        />
        <BaseBarValue rate={rate} open={open} />
      </button>
      {open && (
        <BaseBarMore
          v={v}
          k={k}
          n={n}
          rate={rate}
          base={base}
          lo={lo}
          hi={hi}
        />
      )}
    </div>
  );
}
