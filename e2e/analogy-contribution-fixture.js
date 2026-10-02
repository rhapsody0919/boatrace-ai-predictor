/**
 * アナロジー・ファインダーの寄与度 API（/api/analogy/contribution）の応答の差し替え用（BOA-271）。
 * analogy-contribution.spec.js と layout.spec.js で共有する。テーマとシェアの値は
 * Phase M の実測（docs/design/analogy-finder/spec.md FR-1）に近づけた固定値
 */
export const THEMES = [
  ["venueCourse", "会場×枠・進入", ["venue", "boatNumber", "raceNumber"]],
  [
    "racerRecord",
    "選手・基礎成績",
    ["class", "national", "local", "recent", "boat1"],
  ],
  ["startExhibition", "ST・直前情報", ["exhibitionTime", "pastSt"]],
  ["machine", "機力", ["motor", "boat"]],
  [
    "environment",
    "環境",
    ["weather", "wind", "wave", "grade", "round", "seriesDay"],
  ],
  ["racerProfile", "選手・属性", ["age", "weight", "branch"]],
].map(([key, name, groups]) => ({
  key,
  name,
  description: "",
  features: [],
  groups: groups.map((g) => ({ key: g, label: g })),
}));
const BASE = [0.345, 0.38, 0.142, 0.051, 0.027, 0.055];

export function boatRow(boat, target, nRaces, themes, slice = {}) {
  // 艇番・着順ごとに値を少しずらす（切り替えで表示が変わることを見るため）
  const raw = themes.map(
    (_, i) => (BASE[i] ?? 0.05) * (1 + 0.1 * ((boat + target + i) % 3)),
  );
  const sum = raw.reduce((a, b) => a + b, 0);
  const shares = Object.fromEntries(
    themes.map((t, i) => [t.key, raw[i] / sum]),
  );
  return {
    venue_code: 9,
    grade: "G1",
    round: "junyu",
    ...slice,
    boat_number: boat,
    n_races: nRaces,
    n_boats: boat === 0 ? nRaces * 6 : nRaces,
    period_from: "2025-10-02",
    period_to: "2026-10-01",
    shares,
    share_sd: Object.fromEntries(themes.map((t) => [t.key, 0.003])),
    breakdown: Object.fromEntries(
      themes.map((t) => [
        t.key,
        t.groups.map((g, j) => ({
          key: g.key,
          share: shares[t.key] / (j + 2),
        })),
      ]),
    ),
  };
}

export function contribution(
  params,
  { themes = THEMES, nRaces = 1234, widened = [] } = {},
) {
  const boats = Object.fromEntries(
    [0, 1, 2, 3, 4, 5, 6].map((b) => [
      b,
      boatRow(b, params.target, nRaces, themes),
    ]),
  );
  return {
    available: true,
    modelVersion: "2026-10-05",
    trainedAt: "2026-10-05T00:00:00Z",
    themes,
    testPeriod: ["2025-10-02", "2026-10-01"],
    requested: params,
    resolved: { venue: params.venue, grade: params.grade, round: params.round },
    widened,
    smallSample: nRaces < 30,
    boats,
  };
}
