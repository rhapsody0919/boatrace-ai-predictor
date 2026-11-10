import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import RacerLink from "./assist/RacerLink";
import BoatBadge from "./BoatBadge";
import { entrantRowsOf } from "../../utils/raceEntrants";
import { supabaseDataService } from "../../services/supabaseDataService";
import { summarizeFrontTaking } from "../../utils/frontTaking";
import "./RaceEntrantsSummary.css";

// 札の対象の選手。既存の getRacerScopedRaceStats（選手単位のキャッシュ）だけを使い、このレースより前の走で判定する。
// 結果は「raceId:racerId」の集合で持ち、別のレースの値を混ぜない。取得に失敗した選手は札なし（欄そのものは崩さない）
function useInyaRacerIds(rows, raceId) {
  const [found, setFound] = useState(() => new Set());
  const racerKey = rows.map((r) => r.racerId ?? "").join(",");
  useEffect(() => {
    if (!raceId) return undefined;
    let cancelled = false;
    racerKey
      .split(",")
      .filter(Boolean)
      .forEach((racerId) => {
        supabaseDataService
          .getRacerScopedRaceStats(racerId)
          .then((records) => {
            if (cancelled) return;
            if (!summarizeFrontTaking(records, { beforeRaceId: raceId }).isInya)
              return;
            setFound((prev) => new Set(prev).add(`${raceId}:${racerId}`));
          })
          .catch((err) => {
            console.error("前付けの傾向の取得エラー:", err?.message);
          });
      });
    return () => {
      cancelled = true;
    };
  }, [racerKey, raceId]);
  return found;
}

/**
 * レース詳細のタブの上に置く出走6艇の1〜2行（BOA-1189 GS01-c）。艇番・選手名（/racer/N へのリンク）・級別だけ。
 *
 * 2026-11-01 オーナー決定（A案）で、着順・展示タイムと順位・展示前の案内を外した。中身が結果タブ・直前情報・
 * 出走表と重なり、タブが下がりすぎたため（基本情報タブが 375px で y=708 → 1242）。並びは艇番のまま、色付けなし。
 * 行はボット向け HTML（api/_lib/botRace.js）と同じ entrantRowsOf で組む
 */
export default function RaceEntrantsSummary({ players, raceId = null }) {
  const { t } = useTranslation();
  const rows = entrantRowsOf(players);
  const inyaIds = useInyaRacerIds(rows, raceId);
  if (rows.length === 0) return null;
  return (
    <ul
      className="race-entrants"
      data-testid="race-entrants"
      aria-label={t("raceSummary.title")}
    >
      {rows.map((p) => (
        <li key={p.number} className="race-entrants__item">
          <BoatBadge n={p.number} size="sm" />
          <RacerLink racerId={p.racerId} className="race-entrants__name">
            {p.name}
          </RacerLink>
          {p.grade && (
            <span className="race-entrants__grade" translate="no">
              {p.grade}
            </span>
          )}
          {p.racerId && inyaIds.has(`${raceId}:${p.racerId}`) && (
            <span
              className="race-entrants__inya"
              data-testid={`race-entrants-inya-${p.number}`}
              aria-label={t("frontTaking.badgeAria")}
            >
              {t("frontTaking.badge")}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
