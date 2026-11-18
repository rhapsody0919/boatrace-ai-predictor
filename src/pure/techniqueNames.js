/**
 * 決まり手の英語キー → 日本語の名前。展開予測（src/utils/turnPrediction.js）をやめた後も、データ出走表などの
 * 決まり手の表示で使う（BOA-822）。src/pure の訳の関数からも読めるように本体をここに置く（RA41d）。
 * src/constants/techniqueNames.js は再 export の殻
 */
export const TECHNIQUE_NAMES = {
  nige: "逃げ",
  sashi: "差し",
  makuri: "まくり",
  makurizashi: "まくり差し",
  nuki: "抜き",
  megumare: "恵まれ",
};
