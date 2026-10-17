/**
 * 1号艇・展開・進入・配当の帯の入力（spec FR-1、screens「画面の構造と操作要素」）
 */
import { useTranslation } from "react-i18next";
import BoatToggle from "./BoatToggle";
import { TENKAI_TECHNIQUES } from "../../../utils/pastRate/count.js";

const K = "aiPredictionTab.pastRate";
const BOATS = [1, 2, 3, 4, 5, 6];

function Pills({ options, value, label, onPick }) {
  return (
    <div className="prc-ctrl">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          className="prc-pill"
          aria-pressed={value === o}
          onClick={() => onPick(o)}
        >
          {label(o)}
        </button>
      ))}
    </div>
  );
}

export function Boat1Input({ value, onChange }) {
  const { t } = useTranslation();
  return (
    <Pills
      options={["win", "top3", "out"]}
      value={value.outcome}
      label={(o) => t(`${K}.boat1.${o}`)}
      onPick={(outcome) => onChange({ outcome })}
    />
  );
}

export function TenkaiInput({ value, onChange }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="prc-row">
        <span className="prc-row-label">{t(`${K}.tenkai.start`)}</span>
        <div className="prc-boats">
          {BOATS.map((b) => (
            <BoatToggle
              key={b}
              n={b}
              pressed={value.boat === b}
              onClick={() => onChange({ ...value, boat: b })}
            />
          ))}
        </div>
      </div>
      <Pills
        options={TENKAI_TECHNIQUES}
        value={value.technique}
        label={(o) => t(`techniques.${o}`)}
        onPick={(technique) => onChange({ ...value, technique })}
      />
      <p className="prc-note">{t(`${K}.tenkai.note`)}</p>
    </>
  );
}

export function EntryInput({ value, onChange }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="prc-row">
        <span className="prc-row-label">{t(`${K}.entry.boatLabel`)}</span>
        <div className="prc-boats">
          {BOATS.map((b) => (
            <BoatToggle
              key={b}
              n={b}
              pressed={value.boat === b}
              disabled={b < 3}
              onClick={() => onChange({ ...value, boat: b })}
            />
          ))}
        </div>
      </div>
      <Pills
        options={["within3", "within4", "waku"]}
        value={value.target}
        label={(o) => t(`${K}.entry.${o}`)}
        onPick={(target) => onChange({ ...value, target })}
      />
    </>
  );
}

export function PayoutBandInput({ value, onChange }) {
  const { t } = useTranslation();
  return (
    <Pills
      options={["low", "mid", "high"]}
      value={value.band}
      label={(o) => t(`${K}.payout.${o}`)}
      onPick={(band) => onChange({ band })}
    />
  );
}
