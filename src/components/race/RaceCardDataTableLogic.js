// RaceCardDataTable の純な計算（並び・行の振り分け・セルの class）
export const ALWAYS_VISIBLE_KEYS = ["winRate", "localWinRate", "motor"];

export const sortPlayers = (players) =>
  [...(players ?? [])].sort((a, b) => a.number - b.number);

export const partitionRows = (rows) => ({
  alwaysRows: rows.filter((r) => ALWAYS_VISIBLE_KEYS.includes(r.key)),
  collapsedRows: rows.filter((r) => !ALWAYS_VISIBLE_KEYS.includes(r.key)),
});

export const cellClass = (boat, best) =>
  `rcdt-cell ${best?.has(boat) ? "rcdt-best" : ""}`;
