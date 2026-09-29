/**
 * 会場別ルールの定義（唯一の正本）と判定関数（BOA-567）
 *
 * 2026-01-01〜2026-02-04のデータ再分析により、回収率100%以上のルールのみ厳選
 * 有効ルール: 34件（単勝12件 + 複勝10件 + 3連複3件 + 3連単9件）／対象会場: 15会場
 *
 * 以前は ruleMatchService.js にクロージャ（check 関数）で書いていた。管理画面の運用成績を
 * DB側の集計RPC（get_admin_rule_performance）で出すため、条件を宣言的なデータに移した。
 * 本日・履歴タブの判定（ruleMatches）も、RPCに渡す定義（toRpcRules）も、このデータ1つから作る。
 *
 * 条件の意味（未指定＝条件なし）:
 *   topPick   1着予想の艇番が一致する
 *   confMin   confidence（NULLは0）>= confMin
 *   confLt    confidence（NULLは0）<  confLt
 *   raceMin   レース番号 >= raceMin
 *   raceMax   レース番号 <= raceMax
 *   needHas1  予想の上位3艇に1号艇を含む
 *   needHas2  予想の上位3艇に2号艇を含む
 *
 * betType の名前と払戻の列は逆になっている（歴史的経緯）:
 *   trio（3連複）→ payout_trifecta、exacta（3連単）→ payout_trio
 *
 * ⚠️ scripts/daily-rule-tracking.js・scripts/analysis/recalculate-*-rules.js には
 *    このルールのコピーが残っている（このファイルとは同期していない）。
 *
 * Node（scripts/・api/）からも読むため、import は拡張子付きで書き、ブラウザ固有のAPIを使わない。
 */

// 会場コードから会場名への変換
export const VENUE_NAMES = {
  "01": "桐生",
  "02": "戸田",
  "03": "江戸川",
  "04": "平和島",
  "05": "多摩川",
  "06": "浜名湖",
  "07": "蒲郡",
  "08": "常滑",
  "09": "津",
  10: "三国",
  11: "びわこ",
  12: "住之江",
  13: "尼崎",
  14: "鳴門",
  15: "丸亀",
  16: "児島",
  17: "宮島",
  18: "徳山",
  19: "下関",
  20: "若松",
  21: "芦屋",
  22: "福岡",
  23: "唐津",
  24: "大村",
};

// 会場内の並びは旧定義と同じ（管理画面の同率時の並びに効く。会場の並びは下の VENUE_RULES_BY_VENUE を参照）
export const VENUE_RULES = [
  // 江戸川（03）
  {
    id: "E03-W001",
    venueCode: "03",
    patternName: "EDOGAWA-WIN-TOP2-MC",
    description: "2号艇1着×conf70-80",
    betType: "win",
    stats: { samples: 12, hits: 6, recovery: 203 },
    reliability: "highest",
    topPick: 2,
    confMin: 70,
    confLt: 80,
  },
  {
    id: "E03-W002",
    venueCode: "03",
    patternName: "EDOGAWA-WIN-TOP2-EARLY",
    description: "2号艇1着×4R以前",
    betType: "win",
    stats: { samples: 17, hits: 8, recovery: 172 },
    reliability: "highest",
    topPick: 2,
    raceMin: 1,
    raceMax: 4,
  },
  {
    id: "E03-P001",
    venueCode: "03",
    patternName: "EDOGAWA-PLACE-TOP2-EARLY",
    description: "2号艇1着×4R以前",
    betType: "place",
    stats: { samples: 17, hits: 14, recovery: 101 },
    reliability: "medium",
    topPick: 2,
    raceMin: 1,
    raceMax: 4,
  },
  {
    id: "E03-P004",
    venueCode: "03",
    patternName: "EDOGAWA-PLACE-TOP1-HC",
    description: "1号艇1着×conf80+",
    betType: "place",
    stats: { samples: 201, hits: 137, recovery: 103 },
    reliability: "high",
    topPick: 1,
    confMin: 80,
  },
  // 平和島（04）
  {
    id: "HW04-EX001",
    venueCode: "04",
    patternName: "HEIWAJIMA-EXACTA-R712",
    description: "3連単：後半レース(7-12R)",
    betType: "exacta",
    stats: { samples: 158, hits: 12, recovery: 131 },
    reliability: "high",
    raceMin: 7,
    raceMax: 12,
  },
  // 浜名湖（06）
  {
    id: "H06-W002",
    venueCode: "06",
    patternName: "HAMANAKO-WIN-TOP3-INC1",
    description: "3号艇1着+1号艇含む",
    betType: "win",
    stats: { samples: 27, hits: 7, recovery: 207 },
    reliability: "highest",
    topPick: 3,
    needHas1: true,
  },
  {
    id: "H06-EX001",
    venueCode: "06",
    patternName: "HAMANAKO-EXACTA-R712",
    description: "3連単：後半レース(7-12R)",
    betType: "exacta",
    stats: { samples: 228, hits: 18, recovery: 281 },
    reliability: "highest",
    raceMin: 7,
    raceMax: 12,
  },
  // 蒲郡（07）
  {
    id: "G07-P002",
    venueCode: "07",
    patternName: "GAMAGORI-PLACE-TOP4-LATE",
    description: "4号艇1着×7R以降",
    betType: "place",
    stats: { samples: 13, hits: 6, recovery: 229 },
    reliability: "highest",
    topPick: 4,
    raceMin: 7,
  },
  {
    id: "G07-P003",
    venueCode: "07",
    patternName: "GAMAGORI-PLACE-TOP2-INC1",
    description: "2号艇1着+1号艇含む",
    betType: "place",
    stats: { samples: 60, hits: 36, recovery: 102 },
    reliability: "high",
    topPick: 2,
    needHas1: true,
  },
  // 津（09）
  {
    id: "TS09-EX001",
    venueCode: "09",
    patternName: "TSU-EXACTA-TP1",
    description: "3連単：1着予想=1号艇",
    betType: "exacta",
    stats: { samples: 200, hits: 23, recovery: 110 },
    reliability: "high",
    topPick: 1,
  },
  // 三国（10）
  {
    id: "M10-W002",
    venueCode: "10",
    patternName: "MIKUNI-WIN-TOP3-INC1",
    description: "3号艇1着+1号艇含む",
    betType: "win",
    stats: { samples: 16, hits: 6, recovery: 108 },
    reliability: "high",
    topPick: 3,
    needHas1: true,
  },
  {
    id: "M10-P002",
    venueCode: "10",
    patternName: "MIKUNI-PLACE-TOP3-HC",
    description: "3号艇1着×conf75+",
    betType: "place",
    stats: { samples: 25, hits: 17, recovery: 162 },
    reliability: "highest",
    topPick: 3,
    confMin: 75,
  },
  {
    id: "M10-P003",
    venueCode: "10",
    patternName: "MIKUNI-PLACE-TOP4-INC1",
    description: "4号艇1着+1号艇含む",
    betType: "place",
    stats: { samples: 14, hits: 7, recovery: 112 },
    reliability: "high",
    topPick: 4,
    needHas1: true,
  },
  {
    id: "M10-T003",
    venueCode: "10",
    patternName: "MIKUNI-TRIO-INC12-HC",
    description: "1号艇含む×2号艇含む×conf75+",
    betType: "trio",
    stats: { samples: 196, hits: 52, recovery: 101 },
    reliability: "medium",
    confMin: 75,
    needHas1: true,
    needHas2: true,
  },
  // びわこ（11）
  {
    id: "B11-W002",
    venueCode: "11",
    patternName: "BIWAKO-WIN-TOP3-INC1",
    description: "3号艇1着+1号艇含む",
    betType: "win",
    stats: { samples: 24, hits: 10, recovery: 122 },
    reliability: "high",
    topPick: 3,
    needHas1: true,
  },
  {
    id: "B11-W003",
    venueCode: "11",
    patternName: "BIWAKO-WIN-TOP1-HC",
    description: "1号艇1着×conf85+",
    betType: "win",
    stats: { samples: 216, hits: 142, recovery: 102 },
    reliability: "high",
    topPick: 1,
    confMin: 85,
  },
  {
    id: "B11-T003",
    venueCode: "11",
    patternName: "BIWAKO-TRIO-INC12",
    description: "1号艇含む×2号艇含む",
    betType: "trio",
    stats: { samples: 211, hits: 52, recovery: 102 },
    reliability: "high",
    needHas1: true,
    needHas2: true,
  },
  {
    id: "B11-T005",
    venueCode: "11",
    patternName: "BIWAKO-TRIO-INC1-LATE",
    description: "1号艇含む×10R以降",
    betType: "trio",
    stats: { samples: 95, hits: 20, recovery: 114 },
    reliability: "high",
    raceMin: 10,
    needHas1: true,
  },
  // 鳴門（14）
  {
    id: "N14-W002",
    venueCode: "14",
    patternName: "NARUTO-WIN-TOP3-INC1",
    description: "3号艇1着+1号艇含む",
    betType: "win",
    stats: { samples: 21, hits: 10, recovery: 121 },
    reliability: "high",
    topPick: 3,
    needHas1: true,
  },
  {
    id: "N14-P002",
    venueCode: "14",
    patternName: "NARUTO-PLACE-TOP3-HC",
    description: "3号艇1着×conf75+",
    betType: "place",
    stats: { samples: 20, hits: 14, recovery: 109 },
    reliability: "high",
    topPick: 3,
    confMin: 75,
  },
  {
    id: "N14-EX001",
    venueCode: "14",
    patternName: "NARUTO-EXACTA-TP1-HC",
    description: "3連単：1着予想=1号艇×conf85+",
    betType: "exacta",
    stats: { samples: 182, hits: 20, recovery: 115 },
    reliability: "high",
    topPick: 1,
    confMin: 85,
  },
  // 丸亀（15）
  {
    id: "R15-P001",
    venueCode: "15",
    patternName: "MARUGAME-PLACE-TOP2-HC",
    description: "2号艇1着×conf80+",
    betType: "place",
    stats: { samples: 34, hits: 19, recovery: 105 },
    reliability: "high",
    topPick: 2,
    confMin: 80,
  },
  // 児島（16）
  {
    id: "K16-W001",
    venueCode: "16",
    patternName: "KOJIMA-WIN-TOP2-HC",
    description: "2号艇1着×conf80+",
    betType: "win",
    stats: { samples: 47, hits: 15, recovery: 114 },
    reliability: "high",
    topPick: 2,
    confMin: 80,
  },
  {
    id: "K16-W002",
    venueCode: "16",
    patternName: "KOJIMA-WIN-TOP3-INC1",
    description: "3号艇1着+1号艇含む",
    betType: "win",
    stats: { samples: 28, hits: 9, recovery: 102 },
    reliability: "medium",
    topPick: 3,
    needHas1: true,
  },
  {
    id: "K16-P002",
    venueCode: "16",
    patternName: "KOJIMA-PLACE-TOP3-HC",
    description: "3号艇1着×conf75+",
    betType: "place",
    stats: { samples: 36, hits: 27, recovery: 137 },
    reliability: "highest",
    topPick: 3,
    confMin: 75,
  },
  {
    id: "K16-P003",
    venueCode: "16",
    patternName: "KOJIMA-PLACE-TOP4-INC1",
    description: "4号艇1着+1号艇含む",
    betType: "place",
    stats: { samples: 21, hits: 7, recovery: 134 },
    reliability: "high",
    topPick: 4,
    needHas1: true,
  },
  // 宮島（17）
  {
    id: "MY17-EX001",
    venueCode: "17",
    patternName: "MIYAJIMA-EXACTA-TP1-HC",
    description: "3連単：1着予想=1号艇×conf85+",
    betType: "exacta",
    stats: { samples: 189, hits: 18, recovery: 115 },
    reliability: "high",
    topPick: 1,
    confMin: 85,
  },
  // 徳山（18）
  {
    id: "TY18-EX001",
    venueCode: "18",
    patternName: "TOKUYAMA-EXACTA-R712",
    description: "3連単：後半レース(7-12R)",
    betType: "exacta",
    stats: { samples: 233, hits: 22, recovery: 127 },
    reliability: "high",
    raceMin: 7,
    raceMax: 12,
  },
  // 芦屋（21）
  {
    id: "AS21-EX001",
    venueCode: "21",
    patternName: "ASHIYA-EXACTA-R712",
    description: "3連単：後半レース(7-12R)",
    betType: "exacta",
    stats: { samples: 174, hits: 10, recovery: 1074 },
    reliability: "highest",
    raceMin: 7,
    raceMax: 12,
  },
  // 福岡（22）
  {
    id: "F22-W003",
    venueCode: "22",
    patternName: "FUKUOKA-WIN-TOP1-HC",
    description: "1号艇1着×conf85+",
    betType: "win",
    stats: { samples: 196, hits: 140, recovery: 101 },
    reliability: "high",
    topPick: 1,
    confMin: 85,
  },
  {
    id: "F22-W004",
    venueCode: "22",
    patternName: "FUKUOKA-WIN-TOP4-LATE",
    description: "4号艇1着×10R以降",
    betType: "win",
    stats: { samples: 6, hits: 2, recovery: 252 },
    reliability: "highest",
    topPick: 4,
    raceMin: 10,
  },
  {
    id: "F22-W005",
    venueCode: "22",
    patternName: "FUKUOKA-WIN-TOP2-EARLY",
    description: "2号艇1着×4R以前",
    betType: "win",
    stats: { samples: 15, hits: 8, recovery: 158 },
    reliability: "highest",
    topPick: 2,
    raceMin: 1,
    raceMax: 4,
  },
  {
    id: "F22-EX001",
    venueCode: "22",
    patternName: "FUKUOKA-EXACTA-R16-HC",
    description: "3連単：前半(1-6R)×conf85+",
    betType: "exacta",
    stats: { samples: 150, hits: 15, recovery: 144 },
    reliability: "high",
    confMin: 85,
    raceMin: 1,
    raceMax: 6,
  },
  // 大村（24）
  {
    id: "OM24-EX001",
    venueCode: "24",
    patternName: "OMURA-EXACTA-TP1-HC",
    description: "3連単：1着予想=1号艇×conf85+",
    betType: "exacta",
    stats: { samples: 216, hits: 24, recovery: 105 },
    reliability: "high",
    topPick: 1,
    confMin: 85,
  },
];

/**
 * 会場コード → その会場のルール配列（定義順）
 *
 * ⚠️ 会場の列挙順は JS のオブジェクトのキー順になる。"10"〜"24" は整数とみなされて先に昇順で並び、
 *    "03"〜"09"（先頭0）は後ろに挿入順で並ぶ（10,11,14,…,24,03,04,06,07,09）。旧実装の管理画面
 *    （ルール一覧の同率時の並び・会場の選択肢）はこの順だったので、列挙はこのオブジェクト経由で行う
 */
export const VENUE_RULES_BY_VENUE = VENUE_RULES.reduce((acc, rule) => {
  (acc[rule.venueCode] ||= []).push(rule);
  return acc;
}, {});

/**
 * ルールが予想にマッチするか（旧 check クロージャと同じ判定）
 * @param {Object} rule - VENUE_RULES の要素
 * @param {Object} prediction - { confidence, topPick, top3: [1着, 2着, 3着] }
 * @param {string} venueCode - 会場コード（2桁の文字列）
 * @param {number} raceNo - レース番号
 */
export function ruleMatches(rule, prediction, venueCode, raceNo) {
  if (rule.venueCode !== venueCode) return false;
  const conf = prediction.confidence || 0;
  const top3 = prediction.top3 || [];
  if (rule.topPick != null && prediction.topPick !== rule.topPick) return false;
  if (rule.confMin != null && !(conf >= rule.confMin)) return false;
  if (rule.confLt != null && !(conf < rule.confLt)) return false;
  if (rule.raceMin != null && !(raceNo >= rule.raceMin)) return false;
  if (rule.raceMax != null && !(raceNo <= rule.raceMax)) return false;
  if (rule.needHas1 && !top3.includes(1)) return false;
  if (rule.needHas2 && !top3.includes(2)) return false;
  return true;
}

/** RPC get_admin_rule_performance の p_rules に渡す形（snake_case・未指定は null） */
export function toRpcRules(rules = VENUE_RULES) {
  return rules.map((r) => ({
    rule_id: r.id,
    venue_code: r.venueCode,
    bet_type: r.betType,
    top_pick: r.topPick ?? null,
    conf_min: r.confMin ?? null,
    conf_lt: r.confLt ?? null,
    race_min: r.raceMin ?? null,
    race_max: r.raceMax ?? null,
    need_has1: Boolean(r.needHas1),
    need_has2: Boolean(r.needHas2),
  }));
}
