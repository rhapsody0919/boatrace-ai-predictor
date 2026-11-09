import { useTranslation } from "react-i18next";
import { useLocalizedPath } from "../../../hooks/useLocalizedPath";
import RecentRunsTable from "../RecentRunsTable";
import { getRecentRaces, recordsBeforeRace } from "../basicInfoStats";

// 「直近◯走」の件数。今節タブ（FR-3）と内容が重なりすぎたため5→10にした
// （2026-09-26ユーザーフィードバック。今節は節の区切りで、こちらは節をまたぐ流れを見る）
const RECENT_RACES_COUNT = 10;

export default function TrendView({ records, raceId }) {
  const { t } = useTranslation();
  const localize = useLocalizedPath();
  if (records === undefined || records === null) {
    return <p className="rbit-expanded-loading">{t("basicInfo.loading")}</p>;
  }
  // 表示中のレースより前の走だけ（BOA-602）。過去のレースのページで、
  // そのレース自身や後日の走が「直近」に混ざっていた。
  // 並びは新しい順（いちばん上が前走）。選手ページのレース一覧と向きを
  // そろえる（BOA-623 ファン評価1周目。375px で前走が下に隠れていた）
  const recent = getRecentRaces(
    recordsBeforeRace(records, raceId),
    RECENT_RACES_COUNT,
  ).reverse();
  if (recent.length === 0) {
    return <p className="rbit-expanded-empty">{t("basicInfo.noHistory")}</p>;
  }
  return (
    <div className="rbit-trend">
      <p className="rbit-trend-note">{t("basicInfo.trendNote")}</p>
      <RecentRunsTable
        rows={recent}
        buildRaceHref={(raceId) => localize(`/race/${raceId}`)}
      />
    </div>
  );
}
