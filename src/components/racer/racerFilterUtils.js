// 選手検索・一覧（RacerSearchBox.jsx・RacersPage.jsx）で共有するフィルタ・
// ソート用ユーティリティ（docs/design/racer-search-and-list/参照）。
// 名前によるあいまい検索（ヘッダー検索のみが持つ）はここに含めない。

import { getTodayJST } from "../../utils/dateUtils.js";

// 「99期」のような登録期文字列から数値部分を抽出する（新しい順ソート用）。
// 抽出できない場合はnullを返す（0を返すと「未設定」が「0期」として
// ソート時に他列と異なり先頭に来てしまうバグになるため、2026-09-08修正）
export function extractPeriodNumber(period) {
  const match = /^(\d+)/.exec(period ?? "");
  return match ? Number(match[1]) : null;
}

// 選手の生年月日（"YYYY-MM-DD"）から年齢を算出する。
// Date文字列としてnew Date()に渡すとUTC解釈されるため、ブラウザのタイムゾーンが
// JSTより遅い場合に誕生日付近で1歳ずれることがあった。文字列を直接数値分解して
// タイムゾーン変換を経由しないようにする（2026-09-08修正）
export function calcAge(birthDate) {
  if (!birthDate) return null;
  const [birthYear, birthMonth, birthDay] = birthDate.split("-").map(Number);
  // 生年月日も今日も日本の暦日で比較する。
  const [todayYear, todayMonth, todayDay] = getTodayJST().split("-").map(Number);
  let age = todayYear - birthYear;
  if (
    todayMonth < birthMonth ||
    (todayMonth === birthMonth && todayDay < birthDay)
  ) {
    age -= 1;
  }
  return age;
}

export function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "ja"),
  );
}

// 範囲の下限・上限のどちらかを外れる（値なしも外れ）か。min / max が null なら見ない
function belowMin(value, min) {
  return min != null && (value == null || value < min);
}

function aboveMax(value, max) {
  return max != null && (value == null || value > max);
}

function outOfRange(value, range) {
  return belowMin(value, range.min) || aboveMax(value, range.max);
}

// 選択肢が空なら絞り込まない。選ばれていて値が含まれなければ外れ
function notInSelected(selected, value) {
  return selected.length > 0 && !selected.includes(value);
}

/**
 * 支部・身長範囲・体重範囲・級別・登録期・出身地のフィルタ条件に
 * 選手が一致するかを判定する（名前検索は含まない、呼び出し側でAND合成する）。
 * filters: { branch, heightRange:{min,max}, weightRange:{min,max}, grade, period, hometown }
 */
export function matchesRacerFilters(racer, filters) {
  const { branch, heightRange, weightRange, grade, period, hometown } = filters;
  if (branch && racer.branch !== branch) return false;
  if (outOfRange(racer.height_cm, heightRange)) return false;
  if (outOfRange(racer.weight_kg, weightRange)) return false;
  if (notInSelected(grade, racer.grade)) return false;
  if (notInSelected(period, racer.registration_period)) return false;
  if (notInSelected(hometown, racer.hometown)) return false;
  return true;
}
