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
  "本日の全レースから、逃げが堅い選手・まくりが利く選手・1号艇に逃げられやすい選手を抽出しました。会場と級別の有利不利を除いて比較し、AIのイン崩れ指数と突き合わせて今日の注目レースを1つ選んでいます。昨日のフライングと帰郷選手も掲載。";
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
              ? "本日ぶんはまだ公開されていません（毎朝更新しています。しばらくしてからお試しください）。"
              : "この日のデータは生成されていません。"}
          </p>
        )}

        {digest?.state === "generated" && (
          <>
            {featured && <FeaturedRaceCard row={featured} />}

            <DigestSection
              title="逃げが堅い選手"
              description="全国での実績で、1号艇の選手が1コースに入ったときに逃げ切った割合が70%以上。本日の会場の平均を並べているので、その会場が逃げやすいかどうかと合わせて見てください"
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
                        label="1コースに入ったときに逃げ切った割合"
                        rate={row.metric_value}
                        skillDelta={row.metric_skill_delta}
                        baselineGrade={row.detail?.baselineGrade ?? null}
                        venueName={t(`venues.${row.venue_code}`)}
                        venueBaseline={row.metric_venue_baseline}
                        sampleSize={row.sample_size}
                        isSmallSample={row.is_small_sample}
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
              description="全国での実績で、その選手がそのコースに入ったときに、まくりで1着になった割合が25%以上"
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
                        label={`${row.course}コースに入ったときにまくりで1着になった割合`}
                        rate={row.metric_value}
                        skillDelta={row.metric_skill_delta}
                        baselineGrade={row.detail?.baselineGrade ?? null}
                        venueName={t(`venues.${row.venue_code}`)}
                        venueBaseline={row.metric_venue_baseline}
                        sampleSize={row.sample_size}
                        isSmallSample={row.is_small_sample}
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
              description="全国での実績で、1号艇に逃げ切られる割合が、会場と級別の構成から期待される水準を22ポイント以上上回る"
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
                        label={`${row.course}コースに入ったときに1号艇に逃げ切られた割合`}
                        rate={row.metric_value}
                        skillDelta={row.metric_skill_delta}
                        baselineGrade={row.detail?.baselineGrade ?? null}
                        venueName={t(`venues.${row.venue_code}`)}
                        venueBaseline={row.metric_venue_baseline}
                        sampleSize={row.sample_size}
                        isSmallSample={row.is_small_sample}
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
                <dt>このページに出る数値について</dt>
                <dd>
                  <strong>
                    すべて過去のレース結果を集計した実際の数値で、AIによる予測値ではありません。
                  </strong>
                  「このレースで何%になる」という予想は出していません（AIの予測はイン崩れ指数だけで、
                  その旨を明記しています）。
                </dd>
                <dt>この選手</dt>
                <dd>
                  その選手が全国のどの会場で走ったぶんも合わせた、実際の率。
                  競合サイトが出しているのもこの数値です。
                </dd>
                <dt>◯◯の平均</dt>
                <dd>
                  その会場で、全選手を通した実際の割合。会場によって逃げ率は20ポイント違うため、
                  この基準線と並べないと「戸田での70%」と「尼崎での70%」が同じに見えてしまいます。
                  たとえば戸田は1コースの平均が39.5%と全国で最も低く、大村は約73%あります。
                  <br />
                  「一般戦・全選手」「G1・全選手」とあるのは、
                  <strong>そのレースのグレードに絞った平均</strong>です
                  （A1・A2といった選手の級別ではありません）。そのグレードの母数が100走に満たない
                  会場・コースでは、「全グレード・全選手」と書いて全グレードをまとめた平均を使います。
                </dd>
                <dt>この選手が走ってきた会場の平均</dt>
                <dd>
                  その選手が実際に走った会場・レースグレードの構成で、全選手を平均した割合。
                  この選手の割合と見比べると、走ってきた条件が楽だったかどうかが分かります。
                  ▼で開くと出ます。
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
