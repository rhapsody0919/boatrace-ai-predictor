/**
 * VenueDaySummaryCard - 「この日の水面傾向」（phase a FR-5 / BOA-222）
 *
 * 設計: docs/design/analysis-visualization-upgrade/screens.md §3.5・§3.6
 * 承認済みモック: https://claude.ai/artifact/N3e6TSHmoPXzLNX1SSSLZK （ResultTab）
 *
 * 元は直前情報タブ（`RaceBeforeInfoTab`）のインライン実装だったが、粒度
 * （レース単位ではなく会場×当日単位）と更新タイミング（発走前に確定していく
 * のではなく、レースが終わるたびに増える事後集計）が同タブの他の項目とずれて
 * いたため、**結果タブ（払戻の下）と会場ページ**へ移した（2026-09-23ユーザー承認）。
 *
 * ## 「本日」と書かない
 *
 * 結果タブは過去日のレースでも開かれ、会場ページも `/races/:date/:venueCode`
 * で過去日を出す。**日付は常に出す**（`isToday` で分岐しない）。会場ページは
 * 当日だと日付をどこにも表示しないため、分岐すると当日は日付が一切出なくなる。
 *
 * ## raceId を渡すと「このレース」の位置づけが1文増える
 *
 * 結果タブは `raceId` を渡し、会場ページは渡さない。判定規則と、当日は
 * 1着艇の実進入コースが出せない事情は `venueDayTrend.js` のコメント参照。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVenueDaySummary } from "../../services/venueQueries2.js";
import InlineFetchError from "../InlineFetchError";
import { VenueDaySummaryContent } from "./VenueDaySummaryCardParts";
import "./VenueDaySummaryCard.css";

// 取得中・失敗・リトライ中の見出しだけのカード
function StatusCard({ failed, onRetry }) {
  const { t } = useTranslation();
  return (
    <section className="vds-card">
      <h3 className="vds-heading">{t("venueDaySummary.title")}</h3>
      {failed ? (
        <InlineFetchError onRetry={onRetry} />
      ) : (
        <p className="vds-note">{t("venueDaySummary.loading")}</p>
      )}
    </section>
  );
}

// collapsible: 会場ページで次のレースの直上に差し込むとき、見出しと要約1行に折りたたむ（BOA-546）
function VenueDaySummaryCard({
  venueCode,
  date,
  raceId = null,
  collapsible = false,
}) {
  // 取得結果・失敗を「どの会場のどの日のものか」とセットで持つ（`RacePitReportSection`
  // と同じ形。props だけ変わったときに前の日のデータが混ざらず、effect内で
  // 同期的に setState して連鎖レンダーを起こすこともない）
  const [loaded, setLoaded] = useState(null);
  const [failedKey, setFailedKey] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const key = venueCode && date ? `${venueCode}-${date}` : null;

  useEffect(() => {
    if (!venueCode || !date) return undefined;
    const thisKey = `${venueCode}-${date}`;
    let cancelled = false;
    getVenueDaySummary(venueCode, date)
      .then((data) => {
        if (cancelled) return;
        setLoaded({ key: thisKey, data });
        // 一度失敗したキーへ戻ってきて今度は成功した場合に、エラー表示が
        // 残らないようにする（`RacePitReportSection` と同じ。これが無いと
        // レース詳細のボトムバーで会場をまたいで戻ったとき、裏で取得が
        // 成功していてもリトライを押すまでエラーUIが出たままになる）
        setFailedKey((prev) => (prev === thisKey ? null : prev));
      })
      .catch((err) => {
        // 取得失敗を「この日は0レース」に化けさせない（BOA-359）
        console.error(
          "この日の水面傾向の取得エラー:",
          err?.message ?? String(err),
        );
        if (!cancelled) setFailedKey(thisKey);
      });
    return () => {
      cancelled = true;
    };
  }, [venueCode, date, reloadKey]);

  const summary = loaded?.key === key ? loaded.data : undefined;
  // 例外だけでなく、サービス層が戻り値で返す失敗（`fetchFailed`）もエラーに倒す。
  // これを見ないと、環境変数の未設定時に「この日は0レース」として静かに消える
  // （.claude/rules/frontend-data-fetch.md §4 / BOA-359）
  const failed = failedKey === key || summary?.fetchFailed === true;
  // リトライ中は前の表示を捨てて取得待ちになる。カードごと消えると押した瞬間に
  // 何も無くなるため、見出しだけ残して読み込み中と分かるようにする
  const retrying = reloadKey > 0 && summary === undefined && !failed;

  if (failed || retrying) {
    return (
      <StatusCard
        failed={failed}
        onRetry={() => {
          setFailedKey(null);
          setReloadKey((k) => k + 1);
        }}
      />
    );
  }

  // 取得中と「その日まだ1レースも確定していない」は、どちらもカードを出さない。
  // 空のカードを置くより、確定したら現れる方が読み手の期待に合う
  if (summary === undefined || summary.raceCount === 0) return null;

  return (
    <VenueDaySummaryContent
      summary={summary}
      venueCode={venueCode}
      date={date}
      raceId={raceId}
      collapsible={collapsible}
      expanded={expanded}
      onToggleExpanded={() => setExpanded((v) => !v)}
    />
  );
}

export default VenueDaySummaryCard;
