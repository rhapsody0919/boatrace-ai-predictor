/**
 * FlyingBadge - 出走表に載っている今期のF（フライング）本数バッジ（phase a T5-3）
 *
 * 出所は `race_entries.f_count` に統一する。以前ST考察カードが出していた値は
 * `race_start_timings.is_flying` を「約296日の窓 × そのコース」で数えた回数で、
 * ツールチップの「今期のフライング」という説明と実際の数字が食い違っていた
 * （期のリセットが効かない）。基本情報タブのバッジと違う数字を出し続けるため、
 * 説明文だけを直す案は採らず出所ごと差し替えた（tasks.md T5-3）。
 *
 * 色は **F1が金・F2が赤**。F2は同じ期に2本目で合計90日のあっせん停止になり、
 * 1本目（30日）とは意味の重さが違うため（実測の分布は F0 74.4% / F1 23.9% /
 * F2 1.8%、2026-09-21以降3,246艇）。
 *
 * `f_count` はレース単位で all-or-none（2026-09以降で all 825レース /
 * none 2,943レース / partial 0件）。2026-09-20以前のレースでは値が無く
 * バッジも空欄も出さない。
 */
import { useTranslation } from "react-i18next";
import "./FlyingBadge.css";

function FlyingBadge({ count }) {
  const { t } = useTranslation();
  if (!count || count <= 0) return null;
  return (
    <span
      className={`flying-badge${count >= 2 ? " is-f2" : ""}`}
      title={t("flyingBadge.title", { n: count })}
    >
      F{count}
    </span>
  );
}

export default FlyingBadge;
