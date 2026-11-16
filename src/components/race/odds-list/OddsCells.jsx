// オッズ一覧の小さな表示部品（ブロック見出し・列の下の1行・オッズのボタン）。RaceOddsListTab.jsx から移しただけ
import { useTranslation } from "react-i18next";
import BoatBadge from "../BoatBadge";
import {
  approxEm,
  formatValue,
  heatBucket,
  isNoVotes,
  valueToNumber,
} from "./oddsListHelpers";

// ブロック見出し（艇番バッジ＋選手名）
export function BlockHead({ n, name }) {
  return (
    <div className="rol-block-head">
      <BoatBadge n={n} />
      {name && (
        <span className="rol-block-name" translate="no">
          {name}
        </span>
      )}
    </div>
  );
}

// 3連単の列の下の1行（「合成 144.6」「2単 963.7」）。見出し＋すき間＋値のおおよその幅を CSS に渡し、
// 値が長い（4〜5桁）列や狭い画面では、列の幅に収まるまで文字を小さくする（BOA-552）
export function ColFoot({ label, value }) {
  const em = approxEm(label) + 0.4 + approxEm(value);
  return (
    <div className="rol-col-foot" style={{ "--rol-foot-em": em }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

// オッズ1件のタップ領域（左に艇番バッジ群、右にオッズ。人気度で色分け）
export function OddsButton({
  comboKey,
  label,
  value,
  isRange,
  selected,
  onSelect,
  badges,
}) {
  const { t } = useTranslation();
  const noVotes = isNoVotes(value, isRange);
  const bucket = heatBucket(valueToNumber(value, isRange));
  const text = noVotes
    ? t("oddsList.noVotes")
    : (formatValue(value, isRange) ?? "-");
  return (
    <button
      type="button"
      className={`rol-odds${bucket !== null ? ` rol-heat-${bucket}` : ""}${noVotes ? " is-no-votes" : ""}${selected ? " is-selected" : ""}`}
      onClick={() => onSelect(comboKey)}
      disabled={value == null}
      aria-label={`${label} ${text}`}
      aria-pressed={selected}
      style={{ "--rol-odds-em": approxEm(text) }}
    >
      <span className="rol-odds-badges">{badges}</span>
      <span className="rol-odds-value">{text}</span>
    </button>
  );
}
