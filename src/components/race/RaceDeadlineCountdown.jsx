/**
 * RaceDeadlineCountdown - レースカード内の秒単位締切カウントダウン（BOA-243）
 *
 * 1秒毎のsetIntervalをこのコンポーネント内のローカルstateに閉じ込めることで、
 * 親のRaceCard・VenueRaceListPage・他のレースカードの再レンダーを誘発しない
 * （spec.mdの非機能要件、BOA-254 ADR 0041と同じレンダー範囲局所化の方針）
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getDeadlineDate } from "../../utils/raceDeadlineStatus";

function RaceDeadlineCountdown({ raceId, startTime }) {
  const { t } = useTranslation();
  const deadline = getDeadlineDate(raceId, startTime);
  const deadlineTime = deadline ? deadline.getTime() : null;
  const [remainingMs, setRemainingMs] = useState(() =>
    deadlineTime != null ? deadlineTime - Date.now() : null,
  );

  useEffect(() => {
    if (deadlineTime == null) return undefined;
    setRemainingMs(deadlineTime - Date.now());
    const id = setInterval(() => {
      setRemainingMs(deadlineTime - Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [deadlineTime]);

  if (deadlineTime == null || remainingMs == null || remainingMs <= 0) {
    return null;
  }

  const totalSec = Math.floor(remainingMs / 1000);
  const ss = String(totalSec % 60).padStart(2, "0");
  const totalMin = Math.floor(totalSec / 60);
  // 締切まで1時間以上ある場合はMM:SSが3桁以上になり見た目が崩れるため、
  // H:MM:SS表記に切り替える（1R目を早朝に開くと発生しうる、レビュー指摘で発見）
  const time =
    totalMin >= 60
      ? `${Math.floor(totalMin / 60)}:${String(totalMin % 60).padStart(2, "0")}:${ss}`
      : `${String(totalMin).padStart(2, "0")}:${ss}`;

  return (
    <span
      className="race-deadline-countdown"
      style={{
        fontSize: "0.75rem",
        color: "var(--text-secondary)",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {t("raceCard.deadlineCountdown", { time })}
    </span>
  );
}

export default RaceDeadlineCountdown;
