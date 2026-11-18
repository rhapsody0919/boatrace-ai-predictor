/**
 * verify-kb-gap-fill.js の入力（K・B の写しの日・払戻・着順コードの表）。大きさの関所のため、本文を字のまま移した。verify ではない。
 */

export const show = (v) => JSON.stringify(v);
export const same = (a, b) => show(a) === show(b);

export const DATE = "2026-02-10";
export const R1 = `${DATE}-01-01`;
export const R2 = `${DATE}-01-02`;
export const R3 = `${DATE}-01-03`;
export const kRow = (boat, extra = {}) => ({
  boat_number: boat,
  racer_id: 4000 + boat,
  course: boat,
  start_timing: 0.15,
  is_flying: false,
  is_late_start: false,
  exhibition_time: 6.7,
  ...extra,
});
export const DAY = {
  date: DATE,
  k: {
    venues: [
      {
        venue_code: 1,
        races: [
          {
            race_number: 1,
            weather: "晴",
            wind_direction: "南西",
            wind_speed: 3,
            wave_height: 2,
            stage: "予選",
            stage_raw: "予選　　　　  進入固定",
            rows: [
              kRow(1),
              kRow(2, { start_timing: -0.03, is_flying: true }), // パーサーは F を負の値で返す
              kRow(3, {
                course: null,
                start_timing: null,
                exhibition_time: null,
              }), // 欠場
            ],
          },
          {
            race_number: 2,
            weather: "雨",
            wind_direction: "北",
            wind_speed: 5,
            wave_height: 4,
            stage: "優勝戦",
            stage_raw: "優勝戦",
            rows: [kRow(1)],
          },
          {
            race_number: 3,
            weather: "晴",
            wind_direction: null,
            wind_speed: 0,
            wave_height: 1,
            stage: "一般",
            stage_raw: "一般",
            rows: [kRow(1)],
          },
        ],
      },
    ],
  },
  b: {
    venues: [
      {
        venue_code: 1,
        races: [
          {
            race_number: 1,
            entries: [
              {
                boat_number: 1,
                racer_id: 4001,
                national_2rate: 40.5,
                local_2rate: 38.2,
              },
              {
                boat_number: 2,
                racer_id: 9999,
                national_2rate: 30.0,
                local_2rate: 29.0,
              }, // 登録番号が違う
              {
                boat_number: 3,
                racer_id: 4003,
                national_2rate: 20.0,
                local_2rate: 21.0,
              },
            ],
          },
        ],
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// (g) BOA-480: race_status・refund_boats を K から導く（正解3,084件で100%一致した規則）
// ---------------------------------------------------------------------------
export const kr = (codes, payouts, extra = []) => ({
  rows: codes.map((c, i) => ({ boat_number: i + 1, finish_raw: c })),
  payouts,
  extra_lines: extra,
});
export const PAID = [{ special: null }, { special: null }];

// ---------------------------------------------------------------------------
// (h) BOA-553/582: 成績コードと着欄・着（項目7）
// ---------------------------------------------------------------------------
export const FC_DAY = {
  date: DATE,
  k: {
    venues: [
      {
        venue_code: 1,
        races: [
          {
            race_number: 1,
            rows: ["01", "F", "S1", "02", "K1", "03"].map((c, i) => ({
              boat_number: i + 1,
              finish_raw: c,
            })),
          },
          {
            race_number: 2,
            rows: ["S0", "L0", "00", "S2", "04", "01"].map((c, i) => ({
              boat_number: i + 1,
              finish_raw: c,
            })),
          },
        ],
      },
    ],
  },
};
export const fcEmpty = {
  official_finish_code: null,
  finish_mark: null,
  finish_rank: null,
};
