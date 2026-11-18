/**
 * レース分析指標の字の小さな部品（決まり手・部品名の訳、数値化）。画面の部品
 * （components/race/raceIndicatorsHelpers.jsx が再 export）と、表の字を作るフック（useAiCopyText）が
 * 同じ関数を読むために src/pure に置く（RA41d）
 */
import { TECHNIQUE_NAMES } from "./techniqueNames.js";

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
