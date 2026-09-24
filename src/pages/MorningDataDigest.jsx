/**
 * MorningDataDigest - 「本日のデータ一覧」ページ（BOA-402、/today）
 *
 * 設計: docs/design/morning-data-digest/{spec,screens,plan}.md
 *
 * ## このページが読むもの
 *
 * morning_digest_days / morning_digest_rows の **2表だけ**（ADR-0070）。
 * 抽出・閾値判定・注目レースの選定はすべて早朝バッチ
 * （scripts/daily/generate-morning-digest.js）で済んでおり、ここでは表示しかしない。
 * これによりWeb表示とSNS下書きが同じ行を読むことになり、値が食い違わない。
 *
 * ## 4つの状態を区別する（spec §6）
 *
 *   loading / 取得失敗 / 未生成 / 生成済み（セクションごとに0件もありうる）
 *
 * とくに「未生成」と「該当0件」を混同しない。前者は朝のバッチがまだ走っていない
 * （JST 05:30頃に公開）、後者は条件に合うレースが無かった、で意味が違う。
 *
 * ## 多言語
 *
 * **ja専用（ja-only）**。TRANSLATED_PATHS に登録しない。
 */
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Header from "../components/Header";
import Breadcrumb from "../components/Breadcrumb";
import LoadingScreen from "../components/LoadingScreen";
import InlineFetchError from "../components/InlineFetchError";
import {
  DigestSection,
  DigestCardGrid,
  DigestRaceCard,
  RateWithBaseline,
  FeaturedRaceCard,
  FlyingRacerList,
  ReturnedRacerList,
} from "../components/digest";
import { dataService } from "../services/dataService";
import { getTodayJST } from "../utils/dateUtils";
import { useSocialMeta } from "../hooks/useSocialMeta";
import { useTranslation } from "react-i18next";
import "./MorningDataDigest.css";

const TITLE = "本日のデータ一覧 | 逃げ・まくりが利く選手と昨日のフライング";
const DESCRIPTION =
  "本日の全レースから、逃げが堅い選手・まくりが利く選手・1号艇に逃げられやすい選手を抽出しました。会場と級別の有利不利を除いた「地力」で比較し、AIのイン崩れ指数と突き合わせて今日の注目レースを1つ選んでいます。昨日のフライングと帰郷選手も掲載。";
const CANONICAL = "https://www.boat-ai.jp/today";

/** YYYY-MM-DD かどうか（?date= の値をそのままクエリに流さない） */
function isValidDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatJaDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][
    new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  ];
  return `${m}月${d}日（${weekday}）`;
}

function MorningDataDigest() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const dateParam = searchParams.get("date");
  const date = isValidDate(dateParam) ? dateParam : getTodayJST();
  const isToday = date === getTodayJST();

  // 取得結果・失敗を「どの日付・何回目の試行のものか」とセットで持ち、
  // loading は state ではなくそこから導出する（RacePitReportSection と同じ型。
  // `.claude/rules/frontend-data-fetch.md` §3）。effect 内で同期的に
  // setState してリセットすると、カスケードレンダリングになる
  const [loaded, setLoaded] = useState(null); // { key, data }
  const [failed, setFailed] = useState(null); // { key }
  const [reloadKey, setReloadKey] = useState(0);
  const requestKey = `${date}#${reloadKey}`;

  useEffect(() => {
    let cancelled = false;

    dataService
      .getMorningDigest(date)
      .then((result) => {
        if (!cancelled) setLoaded({ key: requestKey, data: result });
      })
      .catch((error) => {
        // 失敗を「データなし」に化けさせない（.claude/rules/frontend-data-fetch.md）
        console.error("本日のデータ一覧の取得に失敗しました:", error);
        if (!cancelled) setFailed({ key: requestKey });
      });

    return () => {
      cancelled = true;
    };
  }, [date, requestKey]);

  // canonical は ?date= の有無にかかわらず常に /today（薄いページを量産しない）
  useSocialMeta({
    title: TITLE,
    description: DESCRIPTION,
    url: CANONICAL,
    keywords:
      "ボートレース,逃げ率,まくり率,フライング,帰郷,本日のデータ,データ分析,無料",
  });

  // 3状態が排他になり、失敗したまま「読み込み中」が残ることがない
  const digest = loaded?.key === requestKey ? loaded.data : null;
  const hasFailed = failed?.key === requestKey;
  const loading = !digest && !hasFailed;
  const sections = digest?.sections ?? {};
  const day = digest?.day ?? null;
  const featured = sections.featured?.[0] ?? null;

  return (
    <>
      <title>{TITLE}</title>
      <meta name="description" content={DESCRIPTION} />
      <link rel="canonical" href={CANONICAL} />

      <Header />
      <div className="morning-digest">
        <Breadcrumb
          items={[
            { name: "ホーム", url: "/" },
            { name: "本日のデータ一覧", url: "/today" },
          ]}
        />

        <header className="morning-digest__header">
          <h1 className="morning-digest__title">本日のデータ一覧</h1>
          <p className="morning-digest__date">
            {formatJaDate(date)}
            {day && (
              <>
                {"　"}
                {day.venue_count}会場 {day.race_count}レース
              </>
            )}
            {!isToday && (
              <span className="morning-digest__past-badge">過去日</span>
            )}
          </p>
          {day?.window_start && (
            <p className="morning-digest__window">
              <strong>集計期間</strong> {day.window_start} 〜 {day.window_end}（
              {day.window_days}日）／ 調子は直近90日
            </p>
          )}
        </header>

        {loading && <LoadingScreen />}

        {hasFailed && (
          <InlineFetchError
            message="本日のデータ一覧を読み込めませんでした"
            onRetry={() => setReloadKey((k) => k + 1)}
          />
        )}

        {digest?.state === "not_generated" && (
          <p className="morning-digest__not-generated">
            {isToday
              ? "本日ぶんはまだ公開されていません（毎朝5時半ごろに更新します）。"
              : "この日のデータは生成されていません。"}
          </p>
        )}

        {digest?.state === "generated" && (
          <>
            {featured && <FeaturedRaceCard row={featured} />}

            <DigestSection
              title="逃げが堅い選手"
              description="1号艇の選手が、1コースに入ったときに逃げ切った割合が70%以上"
              count={sections.nige?.length ?? 0}
              total={day?.notes?.sectionCounts?.nigeCandidates ?? null}
            >
              <DigestCardGrid rows={sections.nige ?? []}>
                {(row) => (
                  <DigestRaceCard
                    key={`nige-${row.rank}`}
                    row={row}
                    collapsible
                  >
                    {(expanded) => (
                      <RateWithBaseline
                        expanded={expanded}
                        label="逃げ率"
                        rate={row.metric_value}
                        skillDelta={row.metric_skill_delta}
                        predicted={row.metric_predicted}
                        venueName={t(`venues.${row.venue_code}`)}
                        venueBaseline={row.metric_venue_baseline}
                        sampleSize={row.sample_size}
                        isSmallSample={row.is_small_sample}
                        wilsonLower={row.metric_wilson_lower}
                        rate90d={row.rate_90d}
                        sampleSize90d={row.sample_size_90d}
                      />
                    )}
                  </DigestRaceCard>
                )}
              </DigestCardGrid>
            </DigestSection>

            <DigestSection
              title="まくりが利く選手"
              description="その選手がそのコースに入ったときに、まくりで1着になった割合が25%以上"
              count={sections.makuri?.length ?? 0}
              notice="まくりは全国平均が4〜5%とまれな決まり手のため、該当が0件の日もあります。"
            >
              <DigestCardGrid rows={sections.makuri ?? []}>
                {(row) => (
                  <DigestRaceCard
                    key={`makuri-${row.rank}`}
                    row={row}
                    collapsible
                  >
                    {(expanded) => (
                      <RateWithBaseline
                        expanded={expanded}
                        label={`まくり率（${row.course}コース）`}
                        rate={row.metric_value}
                        skillDelta={row.metric_skill_delta}
                        predicted={row.metric_predicted}
                        venueName={t(`venues.${row.venue_code}`)}
                        venueBaseline={row.metric_venue_baseline}
                        sampleSize={row.sample_size}
                        isSmallSample={row.is_small_sample}
                        wilsonLower={row.metric_wilson_lower}
                        rate90d={row.rate_90d}
                        sampleSize90d={row.sample_size_90d}
                      />
                    )}
                  </DigestRaceCard>
                )}
              </DigestCardGrid>
            </DigestSection>

            <DigestSection
              title="逃がしやすい選手"
              description="1号艇に逃げ切られる割合が、会場と級別の構成から期待される水準を22ポイント以上上回る"
              count={sections.nigashi?.length ?? 0}
            >
              <DigestCardGrid rows={sections.nigashi ?? []}>
                {(row) => (
                  <DigestRaceCard
                    key={`nigashi-${row.rank}`}
                    row={row}
                    collapsible
                  >
                    {(expanded) => (
                      <RateWithBaseline
                        expanded={expanded}
                        label={`逃がし率（${row.course}コース）`}
                        rate={row.metric_value}
                        skillDelta={row.metric_skill_delta}
                        predicted={row.metric_predicted}
                        venueName={t(`venues.${row.venue_code}`)}
                        venueBaseline={row.metric_venue_baseline}
                        sampleSize={row.sample_size}
                        isSmallSample={row.is_small_sample}
                        wilsonLower={row.metric_wilson_lower}
                        rate90d={row.rate_90d}
                        sampleSize90d={row.sample_size_90d}
                      />
                    )}
                  </DigestRaceCard>
                )}
              </DigestCardGrid>
            </DigestSection>

            <DigestSection
              title="昨日のフライング"
              description="前日にフライングがあった選手"
              count={sections.flying?.length ?? 0}
              emptyMessage="前日のフライングはありませんでした"
            >
              <FlyingRacerList
                rows={sections.flying ?? []}
                dataComplete={day?.flying_data_complete ?? true}
              />
            </DigestSection>

            <DigestSection
              title="昨日の帰郷選手"
              description="節の途中で出走表から外れた選手"
              count={sections.returned?.length ?? 0}
              emptyMessage="前日に節の途中で帰郷した選手はいませんでした"
            >
              <ReturnedRacerList
                rows={sections.returned ?? []}
                suppressedVenues={day?.suppressed_venues ?? []}
              />
            </DigestSection>

            <section className="morning-digest__notes">
              <h2 className="morning-digest__notes-title">このページの見方</h2>
              <dl className="morning-digest__notes-list">
                <dt>地力</dt>
                <dd>
                  選手の実績率から、その選手が走った会場とグレードの構成で期待される水準を引いた値。
                  会場の有利不利を除いた選手自身の傾向を表します（会場によって逃げ率は20ポイント、
                  グレードによって11ポイント違います）。
                </dd>
                <dt>◯◯での予測</dt>
                <dd>
                  本日の会場・グレードの平均に地力を足した値。このレースで起きやすいことの目安です。
                </dd>
                <dt>信頼下限</dt>
                <dd>
                  この母数だと、真の率は95%の確からしさでこの値以上と言える、という下限。
                  母数が少ないほど下限は低くなります。
                </dd>
                <dt>イン崩れ指数</dt>
                <dd>
                  当日の条件からAIが算出した「1号艇が崩れやすさ」。過去実績とは独立した指標で、
                  {day?.generated_at && (
                    <>
                      この数値は{" "}
                      {new Date(day.generated_at).toLocaleString("ja-JP", {
                        timeZone: "Asia/Tokyo",
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      時点のものです。
                    </>
                  )}
                </dd>
              </dl>
              <p className="morning-digest__disclaimer">
                統計値・AI予測は結果を保証するものではありません。舟券の購入はご自身の判断でお願いします。
              </p>
              <p className="morning-digest__back">
                <Link to="/">ホームに戻る</Link>
              </p>
            </section>
          </>
        )}
      </div>
    </>
  );
}

export default MorningDataDigest;
