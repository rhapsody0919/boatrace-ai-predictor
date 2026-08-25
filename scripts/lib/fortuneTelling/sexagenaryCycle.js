/**
 * 六十干支（日柱）の共通計算ロジック
 * shichuSuimei.js・rokuseiSenjutsu.js で共有する。
 * 基準日: 2007-01-01=乙未(60干支の31番目、0=甲子起点)。
 * 1873-01-12=甲子、2008-02-06=丙子、2008-10-05=戊寅の3点でも一致することを確認済み。
 */

export const STEMS = [
  "甲",
  "乙",
  "丙",
  "丁",
  "戊",
  "己",
  "庚",
  "辛",
  "壬",
  "癸",
];
export const BRANCHES = [
  "子",
  "丑",
  "寅",
  "卯",
  "辰",
  "巳",
  "午",
  "未",
  "申",
  "酉",
  "戌",
  "亥",
];

const ANCHOR_DATE_UTC = Date.UTC(2007, 0, 1);
const ANCHOR_INDEX = 31; // 乙未

/**
 * @param {string} dateStr YYYY-MM-DD
 * @returns {number} 60干支インデックス(0-59、0=甲子)
 */
export function getDayGanzhiIndex(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const daysDiff = Math.round((t - ANCHOR_DATE_UTC) / 86400000);
  return (((ANCHOR_INDEX + daysDiff) % 60) + 60) % 60;
}

export function getGanzhiLabel(ganzhiIndex) {
  return STEMS[ganzhiIndex % 10] + BRANCHES[ganzhiIndex % 12];
}
