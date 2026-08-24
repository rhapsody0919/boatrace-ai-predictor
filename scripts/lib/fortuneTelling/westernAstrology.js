/**
 * 西洋占星術（太陽星座ベースのトランジット計算）
 * 出生チャートとの重ね合わせではなく、出生時点の太陽星座(natal)と対象日の太陽星座(transit)の
 * アスペクト(星座間の角度関係)でスコアを代用する（spec.md「出生時刻不要な代用方式」準拠）
 */

const ZODIAC_SIGNS = [
  { name: "牡羊座", startMonth: 3, startDay: 21, endMonth: 4, endDay: 19 },
  { name: "牡牛座", startMonth: 4, startDay: 20, endMonth: 5, endDay: 20 },
  { name: "双子座", startMonth: 5, startDay: 21, endMonth: 6, endDay: 20 },
  { name: "蟹座", startMonth: 6, startDay: 21, endMonth: 7, endDay: 22 },
  { name: "獅子座", startMonth: 7, startDay: 23, endMonth: 8, endDay: 22 },
  { name: "乙女座", startMonth: 8, startDay: 23, endMonth: 9, endDay: 22 },
  { name: "天秤座", startMonth: 9, startDay: 23, endMonth: 10, endDay: 22 },
  { name: "蠍座", startMonth: 10, startDay: 23, endMonth: 11, endDay: 21 },
  { name: "射手座", startMonth: 11, startDay: 22, endMonth: 12, endDay: 21 },
  { name: "山羊座", startMonth: 12, startDay: 22, endMonth: 1, endDay: 19 },
  { name: "水瓶座", startMonth: 1, startDay: 20, endMonth: 2, endDay: 18 },
  { name: "魚座", startMonth: 2, startDay: 19, endMonth: 3, endDay: 20 },
];

function getZodiacIndex(dateStr) {
  const [, monthStr, dayStr] = dateStr.split("-");
  const month = Number(monthStr);
  const day = Number(dayStr);

  return ZODIAC_SIGNS.findIndex(
    ({ startMonth, startDay, endMonth, endDay }) => {
      if (startMonth <= endMonth) {
        if (month < startMonth || month > endMonth) return false;
        if (month === startMonth && day < startDay) return false;
        if (month === endMonth && day > endDay) return false;
        return true;
      }
      // 年またぎ（山羊座: 12/22-1/19）
      if (month === startMonth) return day >= startDay;
      if (month === endMonth) return day <= endDay;
      return false;
    },
  );
}

// アスペクト距離（0=同星座 〜 6=正反対）ごとのスコア。トライン(4)を最良、オポジション(6)を最悪とする
const ASPECT_SCORES = [80, 55, 75, 30, 90, 40, 25];

function getAspectDistance(indexA, indexB) {
  const diff = Math.abs(indexA - indexB) % 12;
  return diff > 6 ? 12 - diff : diff;
}

/**
 * @param {string} birthDate YYYY-MM-DD
 * @param {string} targetDate YYYY-MM-DD
 * @returns {{ score: number, label: string }}
 */
export function calculateScore(birthDate, targetDate) {
  const natalIndex = getZodiacIndex(birthDate);
  const transitIndex = getZodiacIndex(targetDate);
  const distance = getAspectDistance(natalIndex, transitIndex);

  return {
    score: ASPECT_SCORES[distance],
    label: `${ZODIAC_SIGNS[natalIndex].name}×${ZODIAC_SIGNS[transitIndex].name}`,
  };
}
