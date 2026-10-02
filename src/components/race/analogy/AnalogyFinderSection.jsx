/**
 * アナロジー・ファインダー節（BOA-271）。レース詳細の AI予想タブの既存ブロックの下に置く。
 *
 * 今は寄与度（FR-1）だけを出す。類似レース（FR-2）・組み合わせ（FR-3）は類似の定義が決まってから
 * 同じ節に切り替えとして足す（docs/design/analogy-finder/screens.md）。
 * 学習前（is_active の版が無い・テーブル未適用）は節ごと出さない。最初の結果が出るまでは枠も描かない。
 * 予想（predictions）の有無とは切り離す。
 */
import { useCallback, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { getRaceStageCategory } from "../../../constants/raceStageConfig";
import {
  GRADES,
  roundFromStageCategory,
} from "../../../utils/analogyContribution";
import ContributionView from "./ContributionView";
import "./AnalogyFinder.css";

export default function AnalogyFinderSection({
  venueCode,
  venueName,
  raceGrade,
  raceStage,
}) {
  const { t } = useTranslation();
  const headingId = useId();
  // 最初の結果が出るまでは枠ごと隠す（学習前・テーブル未適用のとき、見出しが一瞬出て消えるのを防ぐ）
  const [phase, setPhase] = useState("pending");
  const handleStatus = useCallback((status) => {
    if (status === "unavailable") setPhase("unavailable");
    else if (status === "ready" || status === "error") setPhase("shown");
  }, []);
  if (phase === "unavailable") return null;
  const defaultGrade = GRADES.includes(raceGrade) ? raceGrade : "all";
  const defaultRound =
    roundFromStageCategory(
      getRaceStageCategory(raceStage)?.key,
      Boolean(raceStage),
    ) ?? "all";
  return (
    <section
      className="af-section"
      aria-labelledby={headingId}
      hidden={phase === "pending"}
    >
      <h2 id={headingId} className="af-title">
        {t("aiPredictionTab.analogy.title")}
      </h2>
      <div className="af-panel">
        <h3 className="af-panel-title">
          {t("aiPredictionTab.analogy.views.contribution")}
        </h3>
        <ContributionView
          venueCode={venueCode}
          venueName={venueName}
          defaultGrade={defaultGrade}
          defaultRound={defaultRound}
          onStatus={handleStatus}
        />
      </div>
    </section>
  );
}
