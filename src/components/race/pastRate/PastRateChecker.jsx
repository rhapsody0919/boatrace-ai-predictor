/**
 * PastRateChecker - 「あなたの予想」（BOA-635「過去に発生した割合を見る」、spec FR-1〜FR-5・screens S-1）
 *
 * ユーザーが入れた予想が、今日と同じ条件の過去レース（layer API の rows、新しい順最大2,000件）で
 * 何回起きたかを数えて見せる。数えるのは画面側（ボタンを押しても通信しない）。結果を出したときに、
 * 締切前なら端末内に保存する（結果タブの振り返りに出す）。型ごとの入力は型を切り替えても残し、
 * 型や入力を変えたら結果を隠す（モックどおり）。
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import OrderInput from "./OrderInput";
import {
  Boat1Input,
  EntryInput,
  PayoutBandInput,
  TenkaiInput,
} from "./ChoiceInputs";
import SlitInput from "./SlitInput";
import PastRateResult from "./PastRateResult";
import {
  countPastRate,
  orderPoints,
  TYPES,
} from "../../../utils/pastRate/count.js";
import { isTruncated, layerKey } from "../../../utils/pastRate/layer.js";
import { rateLabel } from "../../../utils/pastRate/label.js";
import { saveEntry } from "../../../utils/pastRate/storage.js";
import "./PastRate.css";

const K = "aiPredictionTab.pastRate";

const INITIAL = {
  order: { first: null, second: [], third: [], nagashi: false },
  boat1: { outcome: null },
  tenkai: { boat: null, technique: null },
  slit: {
    mode: "pattern",
    patterns: [],
    level: 1,
    courses: [0, 0, 0, 0, 0, 0],
  },
  entry: { boat: null, target: null },
  payout: { band: null },
};

/** 入力が判定できる形になっているか */
function ready(type, v) {
  switch (type) {
    case "order":
      return (
        v.first != null &&
        v.second.length > 0 &&
        v.third.length > 0 &&
        orderPoints(v) > 0
      );
    case "boat1":
      return v.outcome != null;
    case "tenkai":
      return v.boat != null && v.technique != null;
    case "slit":
      return v.mode === "custom"
        ? v.courses.some((c) => c !== 0)
        : v.patterns.length > 0;
    case "entry":
      return v.boat != null && v.target != null;
    default:
      return v.band != null;
  }
}

/** 保存・数え方に渡す形（spec FR-5 の input の表）。スリットは使う方の項目だけ */
function canonical(type, v) {
  if (type !== "slit") return v;
  return v.mode === "custom"
    ? { mode: "custom", courses: [...v.courses] }
    : { mode: "pattern", patterns: [...v.patterns], level: v.level };
}

const INPUTS = {
  order: OrderInput,
  boat1: Boat1Input,
  tenkai: TenkaiInput,
  slit: SlitInput,
  entry: EntryInput,
  payout: PayoutBandInput,
};

/**
 * @param {{layer: object, raceId: string, deadline: Date|null, finished: boolean}} props
 *   layer は使える layer（usableLayer を満たすもの）。deadline は締切（不明なら null）
 */
export default function PastRateChecker({ layer, raceId, deadline, finished }) {
  const { t } = useTranslation();
  const [type, setType] = useState("order");
  const [inputs, setInputs] = useState(INITIAL);
  const [result, setResult] = useState(null);
  const truncated = isTruncated(layer);
  const key = useMemo(() => layerKey(layer), [layer]);

  const value = inputs[type];
  const Input = INPUTS[type];

  const change = (next) => {
    setInputs((prev) => ({ ...prev, [type]: next }));
    setResult(null);
  };

  const submit = () => {
    const input = canonical(type, value);
    const counted = countPastRate(layer.rows, type, input);
    const label = rateLabel(counted, type, input);
    setResult({ type, input, counted, label });
    saveEntry(
      {
        raceId,
        type,
        input,
        savedAt: new Date().toISOString(),
        snapshot: {
          runId: layer.run_id,
          poolCutoff: layer.pool_cutoff,
          layerKey: key,
        },
        result: {
          n: counted.n,
          count: counted.count,
          excluded: counted.excluded,
          label,
          truncated,
        },
      },
      { deadline, finished },
    );
  };

  return (
    <section
      className="prc"
      aria-labelledby="prc-title"
      data-testid="past-rate-checker"
    >
      <h2 className="prc-title" id="prc-title">
        {t(`${K}.title`)}
      </h2>
      <div
        className="prc-types"
        role="tablist"
        aria-label={t(`${K}.typesLabel`)}
      >
        {TYPES.map((ty) => (
          <button
            key={ty}
            type="button"
            role="tab"
            className="prc-type"
            aria-selected={type === ty}
            onClick={() => {
              setType(ty);
              setResult(null);
            }}
          >
            {t(`${K}.types.${ty}`)}
          </button>
        ))}
      </div>
      <Input value={value} onChange={change} />
      <button
        type="button"
        className="prc-submit"
        disabled={!ready(type, value)}
        onClick={submit}
      >
        {t(`${K}.submit`)}
      </button>
      <div className="prc-result" aria-live="polite" hidden={!result}>
        {result && (
          <PastRateResult
            layer={layer}
            truncated={truncated}
            type={result.type}
            input={result.input}
            counted={result.counted}
            label={result.label}
          />
        )}
      </div>
    </section>
  );
}
