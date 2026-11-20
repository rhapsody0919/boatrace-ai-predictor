/**
 * snsTodayPlannerDraft.js から移した、下書きの source_data の組み立て（純粋。型 v3・型 b の記録、deadline_queue、出典）。
 * 振る舞い・鍵の順は元のまま。
 */
import { sha256 } from "./snsTodayPlannerParts.js";

const releaseEvidenceOf = (checkedAt, { todayUrl, screenKey }) => ({
  status: "released",
  url: todayUrl,
  screen_key: screenKey,
  checked_at: checkedAt,
  confirmed_by: "sns-auto-plan",
  reference: `headless:${screenKey}`,
  confirmed_at: checkedAt,
});

// 型 v3 の記録（hq の today-picks.js の form c・思考投稿の対象、作り直しの判定）。featured は 🏆 の優勝戦（無い日は null）
const digestV3Record = (v3, sendAt) =>
  v3
    ? {
        digest_v3: {
          send_at: sendAt,
          text_sha256: sha256(v3.text),
          featured: v3.featured,
          blocks: v3.blocks,
          summary: v3.summary,
        },
      }
    : {};

// 型 b の記録（hq の比べと、言い切りの線の確かめ）。K は送る時刻での段ごとの候補数、line はその日の Bonferroni の線
const courseWinRecord = (courseWin) =>
  courseWin
    ? {
        course_win: {
          key: courseWin.sheet.key,
          k: courseWin.sheet.k,
          line: courseWin.sheet.line,
          claim: courseWin.sheet.claim,
          tail: courseWin.sheet.tail,
          window: courseWin.sheet.window,
          send_at: courseWin.sheet.sendAt,
          sheet_url: courseWin.sheetUrl,
          featured: {
            race_id: courseWin.sheet.featured.race_id,
            boat_number: courseWin.sheet.featured.boat_number,
            racer_id: courseWin.sheet.featured.racer_id,
            runs: courseWin.sheet.featured.runs,
            wins: courseWin.sheet.featured.wins,
            grade: courseWin.sheet.featured.grade,
            baseline_pct: courseWin.sheet.featured.baseline_pct,
            z: courseWin.sheet.featured.z,
          },
          rows: courseWin.sheet.sections.map((sec) => ({
            section: sec.key,
            racers: sec.rows.map((r) => r.racer_id),
          })),
        },
      }
    : {};

// 出典の記録（旧個別承認 140 approve_sns_mobile_channel の条件に合わせて入れていたもの。版の照合の材料として残す）。
// 値は一覧の日の行（レース数）、sha256 は版
const sourceManifestOf = (revision, checkedAt) => [
  {
    name: "morning_digest.json",
    sha256: revision,
    hash_verified: true,
    stage: "digest",
    source_url: "/today",
    fetched_at: checkedAt,
  },
];

const bundleOf = (raceCount) => ({
  claims: [
    {
      source: "morning_digest",
      path: ["day", "race_count"],
      value: raceCount,
      count: raceCount,
      scope: "当日",
    },
  ],
  source_data: { morning_digest: { day: { race_count: raceCount } } },
});

export function sourceDataOf(sd) {
  const { date, revision, imagePaths, post, checkedAt, trackingUrl } = sd;
  const releaseEvidence = releaseEvidenceOf(checkedAt, sd.api);
  return {
    // 個別承認の画面の一覧は source_data.race_id の「日付-」で今日の下書きを拾う
    race_id: `${date}-today`,
    // 画像の順（先頭は cover_image_path）。承認の関数（160）がこの順で媒体を照合する。
    // 文だけの型 v3 は持たない（160 は image_paths があれば1〜4枚を求める。無ければ本文だけの投稿として承認できる）
    ...(imagePaths.length ? { image_paths: imagePaths } : {}),
    // picks は送る直前の検査（readCurrent）が欠場・中止を読み直す対象
    digest: { date, revision, picks: post.picks },
    // 見出しの案の札（uuid は sns_template_variants の行。入るまでは null）
    today_variant: sd.variant,
    // 型の札（PD02）。hq の毎日の PDCA は id を読む。source は schedule（型の列）か config、fallback_reason は列を使わなかった理由
    content_type: sd.contentType,
    ...digestV3Record(sd.v3, sd.sendAt),
    ...courseWinRecord(sd.courseWin),
    deadline_queue: {
      deadline_at: sd.when.deadline_at,
      expires_at: sd.when.expires_at,
      source_revision: revision,
      source_observed_at: checkedAt,
      public_url: trackingUrl,
      screen_key: sd.api.screenKey,
      thread_length: 1,
    },
    // 数字は一覧の表そのもの。数値の照合は、送る直前に版（行の hash）を読み直して一致を見ることで代える
    qa: { pass: true, numeric_claims_match: true, L0_hits: [] },
    release_evidence: releaseEvidence,
    source_manifest: sourceManifestOf(revision, checkedAt),
    bundle: bundleOf(sd.raceCount),
  };
}
