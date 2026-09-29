import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabaseDataService } from "../services/supabaseDataService";
import { formatPercent } from "../utils/formatters";
import InlineFetchError from "./InlineFetchError";
import "./HomeAiIntro.css";

/**
 * トップの「龍神レーダーのボートレースAI予想」セクション（集客レーン Phase3、2026-09-29）
 *
 * 「競艇ai予想 無料」等でトップが6〜8位にいるため、何のサイトかを説明する本文と、
 * 実績（/accuracy と同じ展開予測の的中率）・成績ページへのリンクをクロールできる形で置く。
 * 回収率は出さない（メインモデルの回収率はサイトのどこにも公開していない）。
 * /accuracy・/hit-races は日本語のみのページ（TRANSLATED_PATHS 未登録）。言語プレフィックスを
 * 付けると /en/accuracy → /accuracy のリダイレクトを挟むため、付けずにリンクする。
 * 数値は /accuracy と同じ accuracy_cache から取る。説明文とリンクは数値の有無に関わらず常に出す
 * （本文をクロールさせるのが目的なので、取得の成否で消さない）。取得に失敗したら実績の行の位置に
 * InlineFetchError を出し、この行だけ取り直せるようにする（frontend-data-fetch.md）。
 * 集計前（totalRaces が0）のときは、失敗ではないので実績の行を出さない。
 */
function HomeAiIntro() {
  const { t } = useTranslation();
  const [turn, setTurn] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  // 失敗を試行の番号とセットで持つ。再試行で reloadKey が進むとエラー表示が自然に消える
  // （RacePitReportSection の failedRaceId と同じ方式。effect 内で同期的に state を戻さない）
  const [failedKey, setFailedKey] = useState(null);
  const failed = failedKey === reloadKey;

  useEffect(() => {
    let cancelled = false;
    supabaseDataService
      .getUnifiedModelAccuracy()
      .then((data) => {
        if (cancelled) return;
        setTurn(data?.turn?.totalRaces > 0 ? data.turn : null);
      })
      .catch((err) => {
        console.error("トップの実績（展開予測の的中率）の取得に失敗:", err);
        if (!cancelled) setFailedKey(reloadKey);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return (
    <section className="home-ai-intro" aria-labelledby="home-ai-intro-title">
      <h2 id="home-ai-intro-title">{t("home.aiIntro.title")}</h2>
      <p>{t("home.aiIntro.lead")}</p>
      <p>{t("home.aiIntro.method")}</p>

      {failed && (
        <InlineFetchError onRetry={() => setReloadKey((k) => k + 1)} />
      )}
      {!failed && turn && (
        <p className="home-ai-intro__stat">
          {t("home.aiIntro.statLabel")}{" "}
          <strong className="home-ai-intro__rate">
            {formatPercent(turn.hitRate)}
          </strong>{" "}
          {t("home.aiIntro.statNote", {
            count: turn.totalRaces.toLocaleString(),
          })}
        </p>
      )}

      <ul className="home-ai-intro__links">
        <li>
          <Link to="/accuracy">{t("home.aiIntro.accuracyLink")}</Link>
        </li>
        <li>
          <Link to="/hit-races">{t("home.aiIntro.hitRacesLink")}</Link>
        </li>
      </ul>
    </section>
  );
}

export default HomeAiIntro;
