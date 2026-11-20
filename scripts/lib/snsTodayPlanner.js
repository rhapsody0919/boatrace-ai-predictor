/**
 * /today（本日のデータ一覧）の画像つき X 投稿の計画（sns-pdca-loop tasks 19b、通り道 A、plan §8）。
 * cron `sns_auto_plan` が毎回呼ぶ（api/cron/sns-auto-plan.js）。JST 6:30〜8:00 だけ動く（2026-11-04 オーナー決定で 7:00 送りへ、BOA-1314）。
 *
 * 1回の流れ:
 *   その日の一覧（morning_digest_*、5:30 に公開）を読む → 版（snsTodayDigest.js）
 *   → まだ下書きが無ければ: /today を未ログインで撮る（スマホ幅の上部 4:5）→ Storage へ → 決まった型で本文を組み立てる（AI 生成なし）
 *     → 下書き（send_lane A）→ UTM（today_digest）→ item（kind digest、158）を manual（禁止表現があれば held_manual）→ Slack に画像のリンク
 *   → 下書きがあり、一覧がやり直されて版が変わっていれば（6:30・8:00）: 撮り直して下書きを書き換える。148 のトリガーが承認を外すので、
 *     Slack で承認のし直しを頼む（承認した画像と違うものを送らない）
 *
 * - 時刻（2026-11-04 オーナー決定「投稿時間を7時に変更」、BOA-1314。前は 2026-10-19 の 8:00）: 今の型 v3（文だけ、画像なし）は
 *   龍神ソナーの図を待たないので、計画は 6:30 から（材料の朝の一覧は 5:30・6:30 に公開）。送る時刻は 7:00 と「下書きができた時刻」の遅い方。
 *   下書きを作れるのは 8:00 まで（過ぎたら「作れなかった」を Slack に1回）。item の締切は 9:00（失効 8:30、expiry_minutes=30 と一致）、
 *   notify_by は計画の開始（6:30）、veto_until は送る時刻。載せるのは締切が送る時刻より後のレース。
 *   型 a・型 b（画像つき）の組み手は残すが、v3 が config の current にある間は送らない（比べの b の日を除く）。図の待ち（7:30）は a・b だけ
 * - この版は個別承認（L2）まで。自動（L3）の事前通知・止めるリンクは tasks 12b・13
 * - shadow では読むだけで、撮影・Storage・DB・Slack には書かない
 */
import { matchRiskRules, draftRiskFields } from "./riskRuleMatcher.js";
import { SITE_BASE_URL } from "./sns/siteBaseUrl.js";
import { buildTodayModel } from "./sns/todayModel.js";
import {
  TODAY_SCREEN_KEY,
  digestRevision,
  pickRaceStatus,
} from "./sns/todayDigestStatus.js";
import { createXSnapshot } from "./sns/xSend.js";
import { loadTodayVariants } from "./snsTodayVariants.js";
import {
  SHOT_BUDGET_MS,
  SONAR_EDGE_COLOR_VAR,
  SONAR_ELEMENT,
  SONAR_READY,
  SONAR_WAIT_UNTIL,
  TODAY_MAX_IMAGES,
  firstLine,
  isTodayRebuild,
  jstDate,
  buildTodayPostOf,
  jstHm,
  prepareTodayV3Of,
  todayPostUrlOf,
  todaySchedule,
  todayTrackingUrlOf,
} from "./snsTodayPlannerParts.js";
import {
  courseWinFeasibleOf,
  courseWinSheetUrlOf,
  prepareCourseWinOf,
} from "./snsTodayPlannerCourseWin.js";
import {
  MAX_IMAGE_BYTES,
  assertTodayPageReady,
  launchInfoOf,
} from "./snsTodayPlannerShots.js";
import {
  captureImages,
  chooseBody,
  existingOutcome,
  pickedType,
  prepareBody,
  todayDone,
  windowOutcome,
} from "./snsTodayPlannerSteps.js";
import { writeTodayDraft } from "./snsTodayPlannerDraft.js";

// 部品・store は隣のファイルへ移した。import 元は変えずに済むよう、元の名前を再 export する
export {
  SONAR_EDGE_COLOR_VAR,
  SONAR_ELEMENT,
  SONAR_READY,
  TODAY_DEADLINE,
  TODAY_EXPIRES,
  TODAY_LATEST,
  TODAY_LINK_LABEL,
  TODAY_MAX_IMAGES,
  TODAY_MIN_SAMPLE,
  TODAY_NOTICE,
  TODAY_PICK_RULES,
  TODAY_PLAN_FROM,
  TODAY_SEND_AT,
  isTodayRebuild,
  todayCandidates,
  todayFeatured,
  todaySchedule,
  todayUtmContent,
  typeAOf,
} from "./snsTodayPlannerParts.js";
export {
  COURSE_WIN_SHEET_ELEMENT,
  COURSE_WIN_SHEET_PATH,
  COURSE_WIN_SHEET_VIEWPORT,
  COURSE_WIN_STATUS_CHUNK,
} from "./snsTodayPlannerCourseWin.js";
export {
  REBUILD_MAX_FAILURES,
  createTodayStore,
  finishTodayLog,
  missedTodayText,
  nextTodayLog,
} from "./snsTodayPlannerStore.js";

// api/ の物（SITE_BASE_URL・botToday・snsTodayDigest・snsXSend）は scripts/lib の新しいファイルから import できない（lib-no-entry）ので、
// ここで束ねて引数で渡す。公開の関数は元の形のまま
export const TODAY_URL = `${SITE_BASE_URL}/today`;
export const todayTrackingUrl = (date, sent = "a") =>
  todayTrackingUrlOf(TODAY_URL, date, sent);
const todayPostUrl = (date, sent) => todayPostUrlOf(TODAY_URL, date, sent);
export const prepareTodayV3 = (options) => prepareTodayV3Of(TODAY_URL, options);
export const buildTodayPost = (digest, options) =>
  buildTodayPostOf(
    buildTodayModel(digest, { date: options.date, t: options.t }),
    digest,
    options,
  );
export const courseWinSheetUrl = (date, sendAt, skip = []) =>
  courseWinSheetUrlOf(SITE_BASE_URL, date, sendAt, skip);
const courseWinApi = {
  siteBase: SITE_BASE_URL,
  todayUrl: TODAY_URL,
  pickRaceStatus,
};
export const prepareCourseWin = (digest, options) =>
  prepareCourseWinOf(courseWinApi, digest, options);
export const courseWinFeasible = (digest, options) =>
  courseWinFeasibleOf(TODAY_URL, digest, options);

// 段（Steps・Shots・Draft・Auto）へ渡す api/ 由来の道具
const api = {
  todayUrl: TODAY_URL,
  screenKey: TODAY_SCREEN_KEY,
  pickRaceStatus,
  createXSnapshot,
  prepareTodayV3,
  prepareCourseWin,
  courseWinFeasible,
  buildTodayPost,
  todayPostUrl,
  todayTrackingUrl,
};

/** 型 a の画像: 対象レースの龍神ソナーの図。撮れないうちは何も書かない（例外で止め、次の実行でやり直す） */
async function shootSonar(
  aPost,
  { headless, t, nowMs, startedMs, waitOver, info },
) {
  const pngs = [];
  const missing = [];
  for (const race of aPost.races.slice(0, TODAY_MAX_IMAGES)) {
    // 1枚は最悪 約75秒かかる。関数の時間（300秒）で止められると何も記録されないので、120秒を過ぎたら新しく撮らない
    if (nowMs() - startedMs > SHOT_BUDGET_MS) {
      missing.push(`${race.race_id}: time_budget`);
      continue;
    }
    try {
      const shot = await headless.screenshot({
        url: `${SITE_BASE_URL}/race/${race.race_id}?tab=sonar&boat=${race.boat_number}`,
        requiredSelectors: SONAR_READY,
        viewport: { width: 390, height: 844 },
        element: SONAR_ELEMENT,
        edgeColorVar: SONAR_EDGE_COLOR_VAR,
        label: `${t(`venues.${race.venue_code}`)}${race.race_number}R ${race.start_time.slice(0, 5)}締切`,
      });
      if (shot.png.byteLength > MAX_IMAGE_BYTES)
        throw new Error("image_too_large");
      pngs.push(shot.png);
    } catch (error) {
      missing.push(`${race.race_id}: ${firstLine(error.message)}${info()}`);
    }
  }
  if (!pngs.length || (missing.length && !waitOver))
    throw new Error(`sonar_not_ready（${missing.join(" / ")}）`);
  return pngs;
}

/** テストから差し替えられる口の既定 */
const withDefaults = ({
  notify = async () => {},
  nowMs = Date.now,
  // 確認用に、送る時刻を過ぎた日の下書きを1回だけ作る日付（scrape_job_state.cursor.today_rebuild。オーナーが本番 SQL で入れる）
  reviewDate = null,
  // 見出しの案の設定（config/today-variants.json）。テストから差し替える
  loadVariants = loadTodayVariants,
}) => ({ notify, nowMs, reviewDate, loadVariants });

// 画像・知らせまわりの道具と、本文を選ぶ段が使う物をまとめる
const stepEnv = (
  deps,
  d,
  { digest, date, sendAt, revision, settled, now, startedMs },
) => ({
  digest,
  date,
  sendAt,
  raceDb: deps.raceDb,
  t: deps.t,
  loadVariants: d.loadVariants,
  v3Again: settled.v3Again,
  revision,
  headless: deps.headless,
  info: launchInfoOf(deps.headless),
  waitOver: now >= new Date(`${date}T${SONAR_WAIT_UNTIL}:00+09:00`),
  nowMs: d.nowMs,
  startedMs,
  shootSonar,
  api,
});

// 送信の設定は1回だけ読み、型の選び方（返信を選べるか）と自動の承認の両方に使う（2回読むと間で変わりうる）。
// 確認用の作り直し（review）は自動にしない
async function readControl(store, review) {
  const control = !review && store.control ? await store.control() : null;
  return {
    control,
    replyAllowed:
      control?.mode === "auto" && Boolean(control?.auto_approver_id),
  };
}

// shadow（live でない）では本文だけ組んで、禁止表現の有無で結果を返す（撮影・DB・Slack には書かない）
function previewOutcome(chosen, riskOf, revision) {
  const risk = [
    ...riskOf(chosen.post.text),
    ...(chosen.post.reply ? riskOf(chosen.post.reply) : []),
  ];
  return { outcome: risk.length ? "held_manual" : "manual", revision };
}

/**
 * @param {{mode: string, now: () => Date}} ctx
 * @param {{store, getDigest, raceDb, t, headless, markers, riskRules, trackingStore, saveImage, signImage, notify?}} deps
 */
export async function runTodayPlan(ctx, deps) {
  const { store, getDigest, raceDb, t, headless, markers, riskRules } = deps;
  const d = withDefaults(deps);
  const now = ctx.now();
  const date = jstDate(now);
  // 確認用の作り直し（送る時刻を過ぎた後）は、送る時刻を今にしない（item の veto_until が締切を越えないように）
  const when = todaySchedule(
    date,
    isTodayRebuild(d.reviewDate, now) ? null : now,
  );
  const done = (extra) => todayDone(date, extra);
  // 確認用の作り直し（送る時刻を過ぎていても作る。期限は過ぎているので承認・送信はできない）
  const review = isTodayRebuild(d.reviewDate, now);
  const gate = await windowOutcome(store, date, now, when, review);
  if (gate) return done(gate);
  const startedMs = d.nowMs();
  const digest = await getDigest(date);
  if (!digest.day?.generated_at)
    return done({ outcome: "skipped", reason: "not_generated" });
  const revision = await digestRevision(digest);
  const existing = await store.todayState(date);
  const settled = await existingOutcome({
    date,
    existing,
    revision,
    raceDb,
    t,
    api,
  });
  if (settled.extra) return done(settled.extra);

  // 載せるのは、締切が送る時刻（7:00、遅れた日はその時刻）より後のレースだけ
  const sendAt = jstHm(when.scheduled_at);
  const { control, replyAllowed } = await readControl(store, review);
  const loadVariants = d.loadVariants;
  const picked = await pickedType(existing, date, {
    store,
    loadVariants,
    replyAllowed,
  });
  const env = stepEnv(deps, d, {
    digest,
    date,
    sendAt,
    revision,
    settled,
    now,
    startedMs,
  });
  const prep = await prepareBody(picked, env);
  if (prep.extra) return done(prep.extra);
  const chosen = await chooseBody(prep, picked, env);
  if (!chosen.post)
    return done({ outcome: "skipped", reason: "no_candidates", revision });
  const riskOf = (text) =>
    matchRiskRules(
      draftRiskFields({ platform: "x", caption_text: text, hashtags: [] }),
      "x",
      riskRules,
    );
  if (ctx.mode !== "live")
    return done(previewOutcome(chosen, riskOf, revision));

  // リンク先（/today）が未ログインで見えることを確かめる（送る直前の検査と同じ印）
  await assertTodayPageReady(headless, markers, env.info, api);
  const captured = await captureImages({ ...prep, chosen }, picked, env);
  if (captured.extra) return done(captured.extra);
  const { post, contentType, trackingUrl, variant } = captured.chosen;
  return done(
    await writeTodayDraft({
      ...d,
      api,
      store,
      trackingStore: deps.trackingStore,
      saveImage: deps.saveImage,
      signImage: deps.signImage,
      existing,
      control,
      replyAllowed,
      review,
      now,
      date,
      when,
      sendAt,
      revision,
      digest,
      riskOf,
      replyRisk: post.reply ? riskOf(post.reply) : [],
      post,
      contentType,
      trackingUrl,
      variant,
      v3: prep.v3,
      courseWin: captured.courseWin,
      bFallback: captured.bFallback,
      shots: captured.shots,
    }),
  );
}
