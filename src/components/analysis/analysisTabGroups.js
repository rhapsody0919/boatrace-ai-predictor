// タブの組（#3258 の #4）。2段目は20個すべてを組の順に1行で並べ、選んだ組へ横にスクロールする。
// 組の外の項目も DOM と押せる状態に残す（?tab= のリンクと既存の E2E がどのタブも直接押せるように）
export const TAB_GROUPS = [
  { key: "venue", tabs: ["outcome", "technique", "losing", "nige", "venueranking", "venuegrade", "weather"] },
  { key: "motor", tabs: ["motor", "motorranking"] },
  { key: "racer", tabs: ["racer", "formranking", "techprofile", "returnrate"] },
  { key: "start", tabs: ["st", "topstart", "extime", "extrend"] },
  { key: "race", tabs: ["attackdefense", "racecard", "volatility"] },
];
