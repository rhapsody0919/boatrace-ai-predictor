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
import { Fragment, useEffect, useState } from "react";
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
import {
  MORNING_DIGEST_DISCLAIMER,
  MORNING_DIGEST_GLOSSARY,
  MORNING_DIGEST_GLOSSARY_TITLE,
  MORNING_DIGEST_META,
  MORNING_DIGEST_SECTION_BY_KEY,
} from "../data/morningDigestCopy";
import "./MorningDataDigest.css";

// 文言は src/data/morningDigestCopy.js が唯一の出所。AIクローラー向け
// スナップショット（scripts/generate-ai-snapshots.js）も同じ定数を読むため、
// ここに直書きすると片方だけ古くなる
const {
  title: TITLE,
  description: DESCRIPTION,
  canonical: CANONICAL,
  keywords: KEYWORDS,
  h1: H1,
} = MORNING_DIGEST_META;

/** 用語集の行内断片を描く（strong/br を反映する） */
function GlossaryBody({ body }) {
  return body.map((fragment, i) =>
    fragment.br ? (
      <br key={i} />
    ) : fragment.strong ? (
      <strong key={i}>{fragment.text}</strong>
    ) : (
      <span key={i}>{fragment.text}</span>
    ),
  );
}

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
    keywords: KEYWORDS,
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
          <h1 className="morning-digest__title">{H1}</h1>
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
              title={MORNING_DIGEST_SECTION_BY_KEY.nige.title}
              description={MORNING_DIGEST_SECTION_BY_KEY.nige.description}
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
              title={MORNING_DIGEST_SECTION_BY_KEY.makuri.title}
              description={MORNING_DIGEST_SECTION_BY_KEY.makuri.description}
              count={sections.makuri?.length ?? 0}
              notice={MORNING_DIGEST_SECTION_BY_KEY.makuri.notice}
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
              title={MORNING_DIGEST_SECTION_BY_KEY.nigashi.title}
              description={MORNING_DIGEST_SECTION_BY_KEY.nigashi.description}
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
              title={MORNING_DIGEST_SECTION_BY_KEY.flying.title}
              description={MORNING_DIGEST_SECTION_BY_KEY.flying.description}
              count={sections.flying?.length ?? 0}
              emptyMessage={MORNING_DIGEST_SECTION_BY_KEY.flying.emptyMessage}
            >
              <FlyingRacerList
                rows={sections.flying ?? []}
                dataComplete={day?.flying_data_complete ?? true}
              />
            </DigestSection>

            <DigestSection
              title={MORNING_DIGEST_SECTION_BY_KEY.returned.title}
              description={MORNING_DIGEST_SECTION_BY_KEY.returned.description}
              count={sections.returned?.length ?? 0}
              emptyMessage={
                MORNING_DIGEST_SECTION_BY_KEY.returned.emptyMessage
              }
            >
              <ReturnedRacerList
                rows={sections.returned ?? []}
                suppressedVenues={day?.suppressed_venues ?? []}
              />
            </DigestSection>

            <section className="morning-digest__notes">
              <h2 className="morning-digest__notes-title">
                {MORNING_DIGEST_GLOSSARY_TITLE}
              </h2>
              <dl className="morning-digest__notes-list">
                {MORNING_DIGEST_GLOSSARY.map((entry) => (
                  <Fragment key={entry.term}>
                    <dt>{entry.term}</dt>
                    <dd>
                      <GlossaryBody body={entry.body} />
                      {/* イン崩れ指数だけは、算出時刻（日替わり）を足す。
                          スナップショットには入らない静的でない情報 */}
                      {entry.term === "イン崩れ指数" && day?.generated_at && (
                        <>
                          {"この数値は "}
                          {new Date(day.generated_at).toLocaleString("ja-JP", {
                            timeZone: "Asia/Tokyo",
                            month: "numeric",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {" 時点のものです。"}
                        </>
                      )}
                    </dd>
                  </Fragment>
                ))}
              </dl>
              <p className="morning-digest__disclaimer">
                {MORNING_DIGEST_DISCLAIMER}
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
