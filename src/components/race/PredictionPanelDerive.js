/**
 * PredictionPanel の表示用の値（日付・公式URL・状態の旗）を求める純関数
 */
import { isRaceCancelled } from "../../utils/raceCancellation";
import { RACE_STATUS } from "../../utils/raceStatus";

// 日付（明示的に渡されるか、raceIdから抽出）
export function resolveRaceDate(date, selectedRace) {
  if (date) return date;
  const raceId = selectedRace?.id || "";
  const parts = raceId.split("-").slice(0, 3);
  return parts.length === 3 ? parts.join("-") : "";
}

// 公式サイトリンクURL
export function buildOfficialUrl(venueCode, raceDate, selectedRace) {
  return venueCode && raceDate
    ? `https://www.boatrace.jp/owpc/pc/race/racelist?rno=${selectedRace.raceNumber}&jcd=${String(venueCode).padStart(2, "0")}&hd=${raceDate.replace(/-/g, "")}`
    : null;
}

export function deriveRaceFlags(prediction, status) {
  // 結果確定済みレースでは未来志向のAIデータ分析（展開予測/イン崩れ）を表示しない。
  // 過去レースの検証は「結果」タブ（RaceResult）が担う
  const isFinished = Boolean(prediction?.result?.finished);
  // 中止・順延の確定検知（BOA-254）。暫定検知（"tentative"）はまだ誤検出の
  // 可能性があるため、既存の受付中/結果反映待ち表示のまま変更しない
  const isCancelled = isRaceCancelled(prediction);
  return {
    isFinished,
    // 確定前は基本情報、確定後は結果で開く（URL の ?tab= が無いとき）
    defaultMainTab: isFinished ? "result" : "basic",
    // 締切は過ぎたが結果はまだ反映されていない状態（1時間おきのスクレイピングバッチのラグ）。
    // AI分析パネル自体は表示を維持しつつ、案内バナーのみ追加する
    isAwaitingResult: status === RACE_STATUS.AWAITING_RESULT,
    isCancelled,
    // AI用にコピー（BOA-194）はこれから走るレースを外部AIで分析するためのもの。
    // 結果確定済みと中止確定（BOA-424）では出さない
    showAiCopy: !isFinished && !isCancelled,
  };
}
