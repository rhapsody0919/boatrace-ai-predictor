// 選手検索・一覧（RacerSearchBox.jsx・RacersPage.jsx）で共有するフィルタ・
// ソート用ユーティリティ（docs/design/racer-search-and-list/参照）。
// 名前によるあいまい検索（ヘッダー検索のみが持つ）はここに含めない。

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
  const today = new Date();
  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth() + 1;
  const todayDay = today.getDate();
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

/**
 * 支部・身長範囲・体重範囲・級別・登録期・出身地のフィルタ条件に
 * 選手が一致するかを判定する（名前検索は含まない、呼び出し側でAND合成する）。
 * filters: { branch, heightRange:{min,max}, weightRange:{min,max}, grade, period, hometown }
 */
export function matchesRacerFilters(racer, filters) {
  const { branch, heightRange, weightRange, grade, period, hometown } = filters;
  if (branch && racer.branch !== branch) return false;
  if (
    heightRange.min != null &&
    (racer.height_cm == null || racer.height_cm < heightRange.min)
  )
    return false;
  if (
    heightRange.max != null &&
    (racer.height_cm == null || racer.height_cm > heightRange.max)
  )
    return false;
  if (
    weightRange.min != null &&
    (racer.weight_kg == null || racer.weight_kg < weightRange.min)
  )
    return false;
  if (
    weightRange.max != null &&
    (racer.weight_kg == null || racer.weight_kg > weightRange.max)
  )
    return false;
  if (grade.length > 0 && !grade.includes(racer.grade)) return false;
  if (period.length > 0 && !period.includes(racer.registration_period))
    return false;
  if (hometown.length > 0 && !hometown.includes(racer.hometown)) return false;
  return true;
}
