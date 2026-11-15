/**
 * raceIndicators の共通の小さな部品（翻訳・数値化・艇別の索引）。
 * raceIndicatorsRowDefs* と raceIndicators が共有する（循環 import を避けるため分けた）
 */
import { TECHNIQUE_NAMES } from "../../constants/techniqueNames";

export const TECHNIQUE_KEY_BY_NAME = Object.fromEntries(
  Object.entries(TECHNIQUE_NAMES).map(([key, name]) => [name, key]),
);

// 決まり手（DB値・日本語）を表示用に翻訳する。未知の値はそのまま返す
export const translateTechnique = (t, name) => {
  const key = TECHNIQUE_KEY_BY_NAME[name];
  return key ? t(`techniques.${key}`, name) : name;
};

// スマホ幅のデータ出走表の決まり手のマスに出す短い訳語（BOA-821）。英語は英語の部分、繁体字は漢字だけで、
// 括弧の補足（「Nige (Escape)」「外攻（Makuri）」）を外す。補足の単語が折れず列を押し広げ、表が枠からはみ出していた。
// 日本語・韓国語は今の訳語と同じ。未知の値はそのまま返す
export const translateTechniqueShort = (t, name) => {
  const key = TECHNIQUE_KEY_BY_NAME[name];
  return key ? t(`techniquesShort.${key}`, translateTechnique(t, name)) : name;
};

// 部品交換の部品名（公式表記・日本語）→ partsNames.* のキー（BOA-669）
const PART_KEY_BY_NAME = {
  リング: "ring",
  ピストン: "piston",
  キャブ: "carburetor",
  ギヤ: "gear",
  シリンダ: "cylinder",
  電気: "electrical",
  シャフト: "shaft",
  キャリボ: "carrierBody",
};

// 部品名を表示用に翻訳する。「リング×２」の「×２」は個数なのでそのまま付ける。未知の値はそのまま返す
export const translatePartName = (t, name) => {
  const [base, ...rest] = String(name).split(/(?=×)/);
  const key = PART_KEY_BY_NAME[base];
  return key ? `${t(`partsNames.${key}`, base)}${rest.join("")}` : name;
};

export const toNumber = (value) => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
};

// 艇の枠番別勝率（枠番での1着数/出走数）。racerStats から算出する。
// 枠番キーは BOA-284 で決定（実進入コースではない。src/utils/racerStats.js）
export function wakuRateOf(statsByBoat, boat) {
  const stats = statsByBoat.get(boat);
  if (!stats) return null;
  const counts = stats.wakuRaceCounts?.[String(boat)];
  if (!counts || !counts.total) return null;
  return {
    wins: counts.wins ?? 0,
    total: counts.total,
    rate: ((counts.wins ?? 0) / counts.total) * 100,
  };
}

export const byBoat = (rows) => {
  const map = new Map();
  (rows ?? []).forEach((row) => map.set(row.boat_number, row));
  return map;
};
