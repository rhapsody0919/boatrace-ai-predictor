import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabaseDataService } from "../../services/supabaseDataService";
import { computeFrontTaking } from "../../utils/frontTaking";
import RacerLink from "./assist/RacerLink";
import BoatBadge from "./BoatBadge";
import { entrantRowsOf } from "../../utils/raceEntrants";
import "./RaceEntrantsSummary.css";

/**
 * レース詳細のタブの上に置く出走6艇の1〜2行（BOA-1189 GS01-c）。艇番・選手名（/racer/N へのリンク）・級別だけ。
 *
 * 2026-11-01 オーナー決定（A案）で、着順・展示タイムと順位・展示前の案内を外した。中身が結果タブ・直前情報・
 * 出走表と重なり、タブが下がりすぎたため（基本情報タブが 375px で y=708 → 1242）。並びは艇番のまま、色付けなし。
 * 行はボット向け HTML（api/_lib/botRace.js）と同じ entrantRowsOf で組む
 *
 * イン屋の札（2026-11-03 オーナー承認、docs/design/inya-racer/mock/race-mock.html）: 級別の横に級別と同じ小ささで。
 * 判定は直前情報の進入カードと同じ（このレースより前の1年の4〜6号艇の走、src/utils/frontTaking.js）。
 * 走の行は基本情報タブ・直前情報タブと同じ getRacerScopedRaceStats で、同時の呼び出しはキャッシュで1回にまとまる。
 * 「イン屋」に対訳が無いので ja だけ。取得に失敗した選手は札を出さない（表示は名前と級別のまま）
 */
export default function RaceEntrantsSummary({ players, raceId }) {
  const { t, i18n } = useTranslation();
  const rows = entrantRowsOf(players);
  const isJa = i18n.language === "ja";
  const racerKey = rows.map((p) => p.racerId ?? "").join(",");
  // { raceId, boats: Set<艇番> }。raceId つきで持ち、前のレースの札を混ぜない
  const [inya, setInya] = useState(null);

  useEffect(() => {
    if (!isJa || !/^\d{4}-\d{2}-\d{2}-/.test(raceId ?? "")) return undefined;
    let cancelled = false;
    const targets = racerKey
      .split(",")
      .map((id, i) => ({ racerId: id, number: rows[i]?.number }))
      .filter((r) => r.racerId);
    Promise.all(
      targets.map((r) =>
        supabaseDataService
          .getRacerScopedRaceStats(r.racerId)
          .then((records) =>
            Array.isArray(records) &&
            computeFrontTaking(records, {
              today: raceId.slice(0, 10),
              beforeRaceId: raceId,
            }).status === "inya"
              ? r.number
              : null,
          )
          .catch((err) => {
            console.error(
              `イン屋の判定の取得エラー（${r.racerId}）:`,
              err?.message ?? err,
            );
            return null;
          }),
      ),
    ).then((numbers) => {
      if (cancelled) return;
      setInya({ raceId, boats: new Set(numbers.filter(Boolean)) });
    });
    return () => {
      cancelled = true;
    };
    // rows は players から毎回作り直すので、選手の並び（racerKey）で見る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isJa, raceId, racerKey]);

  const inyaBoats = isJa && inya?.raceId === raceId ? inya.boats : null;
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
          {inyaBoats?.has(p.number) && (
            <span
              className="race-entrants__inya"
              title="ファンの呼び名です。公式の用語ではありません"
              data-testid={`race-entrants-inya-${p.number}`}
            >
              イン屋
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
