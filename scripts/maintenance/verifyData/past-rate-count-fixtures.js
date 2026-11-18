/**
 * verify-past-rate-count.js の固定の行データ。大きさの関所のため、本文を字のまま移した。verify ではない。
 */

// ---------------------------------------------------------------------------
// 固定の行データ（layer の rows と同じ形）
// ---------------------------------------------------------------------------
const WAKU = [1, 2, 3, 4, 5, 6];
const EVEN = [0.15, 0.15, 0.15, 0.15, 0.15, 0.15];
let seq = 0;
export function row({
  rank = [1, 2, 3],
  tech = "逃げ",
  cb = WAKU,
  st = EVEN,
  pay = 1500,
  date = "2026-09-01",
} = {}) {
  seq += 1;
  return {
    race_id: `${date}-01-${String((seq % 12) + 1).padStart(2, "0")}`,
    race_date: date,
    rank1: rank[0],
    rank2: rank[1],
    rank3: rank[2],
    winning_technique: tech,
    course_by_boat: cb,
    st_by_course: st,
    payout_3tan: pay,
  };
}

// 着順・1号艇・展開・配当・進入の行（ST はそろっている）
export const ROWS = [
  row({ rank: [1, 2, 3], tech: "逃げ", pay: 999 }),
  row({ rank: [1, 3, 2], tech: "逃げ", pay: 1000 }),
  row({ rank: [1, 3, 4], tech: "逃げ", pay: 9999 }),
  row({ rank: [1, 4, 2], tech: "逃げ", pay: 10000 }),
  row({ rank: [2, 1, 3], tech: "差し", pay: 2500 }),
  row({ rank: [3, 1, 4], tech: "まくり", pay: 4800, cb: [1, 2, 3, 4, 5, 6] }),
  row({ rank: [3, 4, 1], tech: "まくり", pay: 31000 }),
  row({ rank: [4, 1, 2], tech: "まくり差し", pay: null }),
  row({ rank: [5, 6, 4], tech: null, pay: 88000, cb: [1, 2, 4, 3, 5, 6] }),
  row({ rank: [1, 2, 4], tech: "抜き", pay: 1900, cb: [1, 2, 3, 5, 4, 6] }),
  row({ rank: [1, 5, 2], tech: "逃げ", pay: 3000, cb: [2, 1, 3, 4, 6, 5] }),
  row({
    rank: [6, 1, 2],
    tech: "まくり",
    pay: 51000,
    cb: [1, 2, 3, 4, null, 6],
  }),
];
