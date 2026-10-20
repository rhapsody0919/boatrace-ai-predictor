/**
 * /today（本日のデータ一覧）の画像つき X 投稿の計画（sns-pdca-loop tasks 19b、通り道 A、plan §8）。
 * cron `sns_auto_plan` が毎回呼ぶ（api/cron/sns-auto-plan.js）。JST 7:30〜9:00 だけ動く（2026-10-19 時刻の組み直し）。
 *
 * 1回の流れ:
 *   その日の一覧（morning_digest_*、5:30 に公開）を読む → 版（snsTodayDigest.js）
 *   → まだ下書きが無ければ: /today を未ログインで撮る（スマホ幅の上部 4:5）→ Storage へ → 決まった型で本文を組み立てる（AI 生成なし）
 *     → 下書き（send_lane A）→ UTM（today_digest）→ item（kind digest、158）を manual（禁止表現があれば held_manual）→ Slack に画像のリンク
 *   → 下書きがあり、一覧がやり直されて版が変わっていれば（6:30・8:00）: 撮り直して下書きを書き換える。148 のトリガーが承認を外すので、
 *     Slack で承認のし直しを頼む（承認した画像と違うものを送らない）
 *
 * - 時刻（2026-10-19 オーナー決定「毎朝 8:00 ごろに送る」で組み直し）: 龍神ソナーの図のデータは朝のバッチ（7:10 起動）で
 *   7:24〜7:26 に書かれるので、撮るのは 7:30 から。送る時刻は 8:00 と「下書きができた時刻」の遅い方（図を 8:30 まで待つ日もある）。
 *   下書きを作れるのは 9:00 まで（過ぎたら「作れなかった」を Slack に1回）。item の締切は 10:00（失効 9:30、expiry_minutes=30 と一致）、
 *   notify_by は撮影の開始（7:30）、veto_until は送る時刻。載せるのは締切が 8:00 より後のレース
 * - この版は個別承認（L2）まで。自動（L3）の事前通知・止めるリンクは tasks 12b・13
 * - shadow では読むだけで、撮影・Storage・DB・Slack には書かない
 */
import { matchRiskRules, draftRiskFields } from "./riskRuleMatcher.js";
import { SITE_BASE_URL } from "../../api/_lib/snsHubHelpers.js";
import {
  TODAY_SCREEN_KEY,
  digestRevision,
  pickRaceStatus,
} from "../../api/_lib/snsTodayDigest.js";
import { buildTodayModel } from "../../api/_lib/botToday.js";
import { createXSnapshot } from "../../api/_lib/snsXSend.js";
import {
  TODAY_HEADING_BUILTIN,
  loadTodayVariants,
  pickTodayHeading,
  renderTodayHeading,
} from "./snsTodayVariants.js";
import { randomBytes } from "node:crypto";

export const TODAY_URL = `${SITE_BASE_URL}/today`;

// 撮影の開始（龍神ソナーの図のデータが書かれた後）と、送る時刻（早くてこの時刻）。載せるレースは締切がこれより後のものだけ
export const TODAY_PLAN_FROM = "07:30";
export const TODAY_SEND_AT = "08:00";
// 下書きを作れる最後の時刻。過ぎて下書きが無ければ「作れなかった」を知らせる（図を 8:30 まで待つので、その後の撮影に余裕を残す）
export const TODAY_LATEST = "09:00";

/**
 * その日の時刻（ISO）。送る時刻は 8:00 と now（下書きを作る時刻）の遅い方。now を渡さなければ 8:00
 * 締切に見立てる 10:00（失効 9:30）。notify_by は撮影の開始、veto_until は送る時刻（153 の CHECK: notify_by < veto_until < deadline_at）
 */
export function todaySchedule(date, now = null) {
  const at = (hhmm) => new Date(`${date}T${hhmm}:00+09:00`).toISOString();
  const sendAt = new Date(
    Math.max(Date.parse(at(TODAY_SEND_AT)), now ? now.getTime() : 0),
  ).toISOString();
  return {
    plan_from: at(TODAY_PLAN_FROM),
    latest: at(TODAY_LATEST),
    scheduled_at: sendAt,
    deadline_at: at("10:00"),
    notify_by: at(TODAY_PLAN_FROM),
    veto_until: sendAt,
    expires_at: at("09:30"),
  };
}

export const todayTrackingUrl = (date) =>
  `${TODAY_URL}?utm_source=x&utm_medium=social&utm_campaign=today_digest&utm_content=${date}`;

// 本文に載せる区分と人数・最低の走数（2026-10-15 オーナー承認の型）。逃がし・注目レースは、選ぶ式の向きを /today 側で直すまで載せない
// 見出し（2026-10-15 hq 承認の文）。割合は一覧に保存されたしきい値（morning_digest_days.notes.thresholds）を使う
export const TODAY_PICK_RULES = [
  {
    section: "nige",
    mark: "逃げ",
    limit: 3,
    threshold: 70,
    legend: (pct) =>
      `全国で1コースに入ったとき逃げ切った割合${pct}%以上の1号艇`,
  },
  {
    section: "makuri",
    mark: "まくり",
    limit: 2,
    threshold: 25,
    legend: (pct) => `そのコースでまくりで1着の割合${pct}%以上の選手`,
  },
];
export const TODAY_MIN_SAMPLE = 30;
export const TODAY_NOTICE =
  "過去の実績は当日の結果を保証しません。展示後は進入と展示タイムも確認してください。";

/** 載せてよい候補（区分・rank の順）。送る時刻までに締切を過ぎる・走数30未満・締切の無い行は除く。区分の中の同じレースは最初の行だけ */
export function todayCandidates(rows, sendAt = TODAY_SEND_AT) {
  return TODAY_PICK_RULES.flatMap(({ section }) => {
    const seen = new Set();
    return rows
      .filter(
        (row) =>
          row.section === section &&
          typeof row.start_time === "string" &&
          row.start_time.slice(0, 5) > sendAt &&
          Number(row.sample_size) >= TODAY_MIN_SAMPLE,
      )
      .sort((a, b) => a.rank - b.rank)
      .filter((row) => !seen.has(row.race_id) && seen.add(row.race_id));
  });
}

/**
 * 決まった型の本文（AI 生成なし）。候補から欠場・中止・締切を確かめられない行（excluded の race_id:艇番）を除き、
 * 区分ごとに上限まで rank の順に選び、全体を締切→会場→R の順に並べる。候補が0件なら null（その日は送らない）
 * 印の意味を1行ずつ、その後に全体を締切の早い順で。1行は「［逃げ］会場R HH:MM締切｜艇番 選手名｜全国N走」（2026-10-15 オーナー回答）
 */
// 注目レースの割合の言い方（選んだ区分ごと）。逃がしからの注目は、向きの確認が済むまで載せない
const FEATURED_RATE = {
  nige: (course) => `${course}コースで逃げ切った割合`,
  makuri: (course) => `${course}コースでまくりで1着の割合`,
};
const pct = (value) => `${Number(value)}%`;

/** /today の注目レース（featured）。逃げ・まくりから選ばれ、送る時刻より後の締切で、数字がそろっているときだけ */
// 画像は対象レースの龍神ソナーの図を最大4枚（2026-10-16 ユーザー決定。X の1投稿の上限が4枚）。
// 図の元データ（analogy-v16-morning）は 7:24〜7:26 に書かれる（10/14〜10/17 の実測）。遅れる日のために 8:30 まではそろうまでやり直し、
// 8:30 を過ぎたら撮れた分で作る
export const TODAY_MAX_IMAGES = 4;
export const SONAR_ELEMENT = ".af-hep .af-dark";
// 図を撮る前に待つ印は条件のカードだけ。段の表示（analogy-stage-chip）は展示のデータが入ると切り替えのボタンに変わり、
// 展示の後に撮ると見えない（2026-10-17 夜の作り直しで4枚とも screenshot_component_missing）
export const SONAR_READY = ['[data-testid="analogy-fact-card"]'];
const SONAR_WAIT_UNTIL = "08:30";
const SHOT_BUDGET_MS = 120_000;

export function todayFeatured(rows, sendAt = TODAY_SEND_AT) {
  const row = rows.find((r) => r.section === "featured");
  if (
    !row ||
    !FEATURED_RATE[row.from] ||
    typeof row.start_time !== "string" ||
    row.start_time.slice(0, 5) <= sendAt ||
    !Number.isInteger(row.boat_number) ||
    !Number.isInteger(row.course) ||
    !Number.isFinite(Number(row.metric_value)) ||
    !Number.isFinite(Number(row.metric_venue_baseline)) ||
    !Number.isInteger(row.sample_size)
  )
    return null;
  return row;
}

export function buildTodayPost(
  digest,
  {
    date,
    t,
    url,
    sendAt = TODAY_SEND_AT,
    excluded = new Set(),
    heading = TODAY_HEADING_BUILTIN,
  },
) {
  const model = buildTodayModel(digest, { date, t });
  const key = (row) => `${row.race_id}:${row.boat_number}`;
  const found = todayFeatured(digest.rows, sendAt);
  const featured = found && !excluded.has(key(found)) ? found : null;
  // 注目レースの選手は一覧に重ねて出さない
  const candidates = todayCandidates(digest.rows, sendAt).filter(
    (row) =>
      !excluded.has(key(row)) && (!featured || key(row) !== key(featured)),
  );
  const picks = TODAY_PICK_RULES.flatMap(({ section, limit }) =>
    candidates.filter((row) => row.section === section).slice(0, limit),
  ).sort(
    (a, b) =>
      a.start_time.localeCompare(b.start_time) ||
      a.venue_code - b.venue_code ||
      a.race_number - b.race_number,
  );
  if (!picks.length && !featured) return null;
  // 印の意味（その日に出る区分だけ）を先に1行ずつ、その後に全体を締切の早い順で（2026-10-15 オーナー「締め切り順が良い」）
  const thresholds = digest.day?.notes?.thresholds ?? {};
  const rules = TODAY_PICK_RULES.filter((rule) =>
    picks.some((row) => row.section === rule.section),
  );
  const mark = Object.fromEntries(
    rules.map((rule) => [rule.section, rule.mark]),
  );
  const head = (row) =>
    `${t(`venues.${row.venue_code}`)}${row.race_number}R ${row.start_time.slice(0, 5)}締切｜${row.boat_number}号艇 ${String(row.racer_name ?? "").replace(/\u3000/g, " ")}`;
  // 見出し（1行目）だけは日替わりの案（config/today-variants.json）。ほかは機械が作る
  const lines = [renderTodayHeading(heading, model.dateLine), ""];
  // 注目レースを先頭に（2026-10-16 オーナー指示。「イン崩れ指数」「AIが算出」の言い方は使わない）
  if (featured)
    lines.push(
      `注目レース：${head(featured)}｜${FEATURED_RATE[featured.from](featured.course)} ${pct(featured.metric_value)}（全国${featured.sample_size}走）・この会場の平均 ${pct(featured.metric_venue_baseline)}`,
      "",
    );
  if (picks.length) {
    lines.push(
      ...rules.map(
        (rule) =>
          `［${rule.mark}］${rule.legend(thresholds[rule.section] ?? rule.threshold)}`,
      ),
      "",
    );
    for (const row of picks)
      lines.push(
        `［${mark[row.section]}］${head(row)}｜全国${row.sample_size}走`,
      );
    lines.push("");
  }
  lines.push(TODAY_NOTICE, url);
  return {
    text: lines.join("\n"),
    // 画像（龍神ソナーの図）を撮るレース。注目レースを先頭に、一覧を締切順で、同じレースは1回
    races: [...(featured ? [featured] : []), ...picks]
      .filter(
        (row, i, all) => all.findIndex((r) => r.race_id === row.race_id) === i,
      )
      .map(({ race_id, venue_code, race_number, start_time }) => ({
        race_id,
        venue_code,
        race_number,
        start_time,
      })),
    // 送る直前に欠場・中止を読み直す対象（注目レースを含む）
    picks: [...(featured ? [featured] : []), ...picks].map((row) => ({
      race_id: row.race_id,
      boat_number: row.boat_number,
    })),
  };
}

const jstHm = (iso) =>
  new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(11, 16);
const jstDate = (date) =>
  new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);

/** 確認用の作り直し（cursor.today_rebuild）が今の実行で効くか。送る時刻を過ぎた、その日の分だけ */
export function isTodayRebuild(reviewDate, now) {
  const date = jstDate(now);
  return reviewDate === date && now >= new Date(todaySchedule(date).latest);
}

// 理由の文字列は1件につき最初の1行だけ残す（Playwright の例外はブラウザのログ全文を含み、cursor の記録が切れた。2026-10-17）
const firstLine = (message) => String(message).split("\n")[0].slice(0, 160);

/**
 * @param {{mode: string, now: () => Date}} ctx
 * @param {{store, getDigest, raceDb, t, headless, markers, riskRules, trackingStore, saveImage, signImage, notify?}} deps
 */
export async function runTodayPlan(
  ctx,
  {
    store,
    getDigest,
    raceDb,
    t,
    headless,
    markers,
    riskRules,
    trackingStore,
    saveImage,
    signImage,
    notify = async () => {},
    nowMs = Date.now,
    // 確認用に、送る時刻を過ぎた日の下書きを1回だけ作る日付（scrape_job_state.cursor.today_rebuild。オーナーが本番 SQL で入れる）
    reviewDate = null,
    // 見出しの案の設定（config/today-variants.json）。テストから差し替える
    loadVariants = loadTodayVariants,
  },
) {
  const live = ctx.mode === "live";
  const now = ctx.now();
  const date = jstDate(now);
  // 確認用の作り直し（送る時刻を過ぎた後）は、送る時刻を今にしない（item の veto_until が締切を越えないように）
  const when = todaySchedule(
    date,
    isTodayRebuild(reviewDate, now) ? null : now,
  );
  const done = (extra) => ({
    rowsWritten: extra.written ? 1 : 0,
    report: { items: [{ kind: "digest", date, ...extra }], alerts: [] },
  });
  if (now < new Date(when.plan_from))
    return done({ outcome: "skipped", reason: "outside_window" });
  // 確認用の作り直し（送る時刻を過ぎていても作る。期限は過ぎているので承認・送信はできない）
  const review = isTodayRebuild(reviewDate, now);
  if (now >= new Date(when.latest) && !review) {
    // 送る時刻を過ぎて、その日の下書きが無い（作れずに朝が終わった）。cron がその日1回だけ Slack に知らせる
    const { draft } = await store.todayState(date);
    return done(
      draft
        ? { outcome: "skipped", reason: "outside_window" }
        : { outcome: "missed", reason: "no_draft_by_send_time" },
    );
  }
  const startedMs = nowMs();
  const digest = await getDigest(date);
  if (!digest.day?.generated_at)
    return done({ outcome: "skipped", reason: "not_generated" });
  const revision = await digestRevision(digest);
  const existing = await store.todayState(date);
  // 下書きを作った後に item の作成で落ちた（item が無い）ときは、同じ版でも作り直して item を作る
  if (
    existing.item &&
    existing.draft?.source_data?.digest?.revision === revision
  )
    return done({ outcome: "unchanged", item_id: existing.item?.id ?? null });
  // held_manual（禁止表現）・止めた item は、版が変わっても作り直さない（オーナーの判断に回す）。
  // 自動で承認した（notified）ものは作り直す（版が変わると送る直前の読み直しで止まるため。2026-10-18）
  if (existing.item && !["manual", "notified"].includes(existing.item.state))
    return done({ outcome: "skipped", reason: `item_${existing.item.state}` });

  const trackingUrl = todayTrackingUrl(date);
  // 欠場・中止・締切を確かめられない候補は除く（区分の上限までは後ろの rank から補う）
  // 載せるのは、締切が送る時刻（8:00、遅れた日はその時刻）より後のレースだけ
  const sendAt = jstHm(when.scheduled_at);
  const featuredRow = todayFeatured(digest.rows, sendAt);
  const statuses = await pickRaceStatus(raceDb, [
    ...(featuredRow ? [featuredRow] : []),
    ...todayCandidates(digest.rows, sendAt),
  ]);
  const excluded = new Set(
    statuses
      .filter((p) => p.reason)
      .map((p) => `${p.race_id}:${p.boat_number}`),
  );
  const { heading, variant } = pickTodayHeading(loadVariants(), date);
  const post = buildTodayPost(digest, {
    date,
    t,
    url: trackingUrl,
    sendAt,
    excluded,
    heading,
  });
  if (!post)
    return done({ outcome: "skipped", reason: "no_candidates", revision });
  const caption = post.text;
  const risk = matchRiskRules(
    draftRiskFields({ platform: "x", caption_text: caption, hashtags: [] }),
    "x",
    riskRules,
  );
  if (!live)
    return done({ outcome: risk.length ? "held_manual" : "manual", revision });

  // リンク先（/today）が未ログインで見えることを確かめる（送る直前の検査と同じ印）
  // 失敗の理由に起動の様子（残りの Chromium・空きメモリ）を添える。本番の関数のログを見ずに切り分けるため（2026-10-18）
  const info = () => (headless.launchInfo ? ` [${headless.launchInfo()}]` : "");
  const page = await headless
    .inspect({
      url: TODAY_URL,
      context: { storageState: null },
      requiredSelectors: markers[TODAY_SCREEN_KEY],
    })
    .catch((error) => {
      throw new Error(`${firstLine(error.message)}${info()}`);
    });
  if (
    page.finalUrl !== TODAY_URL ||
    !markers[TODAY_SCREEN_KEY].every((m) => page.visibleSelectors?.includes(m))
  )
    throw new Error("today_page_not_ready");
  // 画像: 対象レースの龍神ソナーの図。撮れないうちは何も書かない（例外で止め、次の実行でやり直す）
  const shots = [];
  const missing = [];
  for (const race of post.races.slice(0, TODAY_MAX_IMAGES)) {
    // 1枚は最悪 約75秒かかる。関数の時間（300秒）で止められると何も記録されないので、120秒を過ぎたら新しく撮らない
    if (nowMs() - startedMs > SHOT_BUDGET_MS) {
      missing.push(`${race.race_id}: time_budget`);
      continue;
    }
    try {
      const shot = await headless.screenshot({
        url: `${SITE_BASE_URL}/race/${race.race_id}?tab=sonar`,
        requiredSelectors: SONAR_READY,
        viewport: { width: 390, height: 844 },
        element: SONAR_ELEMENT,
        label: `${t(`venues.${race.venue_code}`)}${race.race_number}R ${race.start_time.slice(0, 5)}締切`,
      });
      // X の画像は1枚 5 MB まで（承認の関数 160 と同じ）。超えたら撮れなかった扱い
      if (shot.png.byteLength > 5_000_000) throw new Error("image_too_large");
      shots.push(shot.png);
    } catch (error) {
      missing.push(`${race.race_id}: ${firstLine(error.message)}${info()}`);
    }
  }
  if (
    !shots.length ||
    (missing.length && now < new Date(`${date}T${SONAR_WAIT_UNTIL}:00+09:00`))
  )
    throw new Error(`sonar_not_ready（${missing.join(" / ")}）`);
  const checkedAt = now.toISOString();
  const imagePaths = shots.map(
    (_, i) => `today/${date}/${revision}-${i + 1}.png`,
  );
  for (const [i, png] of shots.entries()) await saveImage(imagePaths[i], png);
  const imagePath = imagePaths[0];
  const releaseEvidence = {
    status: "released",
    url: TODAY_URL,
    screen_key: TODAY_SCREEN_KEY,
    checked_at: checkedAt,
    confirmed_by: "sns-auto-plan",
    reference: `headless:${TODAY_SCREEN_KEY}`,
    confirmed_at: checkedAt,
  };
  const raceCount = digest.day.race_count ?? 0;
  const sourceData = {
    // 個別承認の画面の一覧は source_data.race_id の「日付-」で今日の下書きを拾う
    race_id: `${date}-today`,
    // 画像の順（先頭は cover_image_path）。承認の関数（160）がこの順で媒体を照合する
    image_paths: imagePaths,
    // picks は送る直前の検査（readCurrent）が欠場・中止を読み直す対象
    digest: { date, revision, picks: post.picks },
    // 見出しの案の札（uuid は sns_template_variants の行。入るまでは null）
    today_variant: variant,
    deadline_queue: {
      deadline_at: when.deadline_at,
      expires_at: when.expires_at,
      source_revision: revision,
      source_observed_at: checkedAt,
      public_url: trackingUrl,
      screen_key: TODAY_SCREEN_KEY,
      thread_length: 1,
    },
    // 数字は一覧の表そのもの。数値の照合は、送る直前に版（行の hash）を読み直して一致を見ることで代える
    qa: { pass: true, numeric_claims_match: true, L0_hits: [] },
    release_evidence: releaseEvidence,
    // 出典の記録（旧個別承認 140 approve_sns_mobile_channel の条件に合わせて入れていたもの。版の照合の材料として残す）。
    // 値は一覧の日の行（レース数）、sha256 は版
    source_manifest: [
      {
        name: "morning_digest.json",
        sha256: revision,
        hash_verified: true,
        stage: "digest",
        source_url: "/today",
        fetched_at: checkedAt,
      },
    ],
    bundle: {
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
    },
  };
  const fields = {
    caption_text: caption,
    cover_image_path: imagePath,
    source_data: sourceData,
    risk_flags: risk,
  };
  const draft = existing.draft
    ? await store.updateTodayDraft(existing.draft.id, fields)
    : await store.insertDraft({
        content_group_id: crypto.randomUUID(),
        platform: "x",
        language: "ja",
        status: "pending_review",
        format: "today_digest",
        title: "本日のデータ一覧",
        hashtags: [],
        publish_blocked: false,
        publication_hold_reasons: [],
        send_lane: "A",
        scheduled_at: when.scheduled_at,
        ...fields,
      });
  const trackingRow = {
    draft_id: draft.id,
    template_variant_id: variant.uuid,
    race_url: TODAY_URL,
    tracking_url: trackingUrl,
    utm_source: "x",
    utm_medium: "social",
    utm_campaign: "today_digest",
    utm_content: date,
    release_evidence: releaseEvidence,
  };
  try {
    await trackingStore.save(trackingRow);
  } catch (error) {
    // 案の uuid の行が sns_template_variants にまだ無い（設定の uuid を先に入れた）ときは、札なしで保存して投稿は止めない。
    // 札は source_data.today_variant に残っている
    if (!variant.uuid) throw error;
    console.error(
      `/today の tracking に案の札（${variant.uuid}）を入れられない。札なしで保存する: ${error.message}`,
    );
    await trackingStore.save({ ...trackingRow, template_variant_id: null });
  }
  const state = risk.length ? "held_manual" : "manual";
  const checks = {
    passed: risk.length === 0,
    risk: risk.map((r) => r.id),
    digest_revision: revision,
    display: { ok: true, checked_at: checkedAt },
    checked_at: checkedAt,
  };
  const heldReason = risk.length ? `禁止表現: ${checks.risk.join(",")}` : null;
  let item = existing.item
    ? await store.updateItem(existing.item.id, existing.item.state, {
        state,
        checks,
        held_reason: heldReason,
      })
    : await store.insertItem({
        kind: "digest",
        draft_id: draft.id,
        channel: "x",
        race_id: `today:${date}`,
        deadline_at: when.deadline_at,
        notify_by: when.notify_by,
        veto_until: when.veto_until,
        state,
        checks,
        held_reason: heldReason,
      });
  // 自動（mode=auto、2026-10-18 オーナー決定: /today も承認なし）: item を notified にして自動送信の承認者で承認する。
  // 送る時刻は 8:00 と下書きを作った時刻の遅い方（veto_until と同じ）。確認用の作り直し（review）は自動にしない
  let autoError = null;
  const control =
    state === "manual" && !review && store.control
      ? await store.control()
      : null;
  const auto = control?.mode === "auto" && control?.auto_approver_id;
  if (auto) {
    try {
      item = await store.updateItem(item.id, "manual", {
        state: "notified",
        notified_at: checkedAt,
        // 止めるリンクは作らない（オーナー決定）。153 の CHECK が notified に要求するので、使わない乱数のハッシュを入れる
        stop_token_hash: randomBytes(32).toString("hex"),
      });
      const bytes = new Map(imagePaths.map((p, i) => [p, shots[i]]));
      await store.approve({
        p_draft_id: draft.id,
        p_approver_id: control.auto_approver_id,
        p_snapshot: await createXSnapshot(draft, async (p) => {
          if (!bytes.has(p)) throw new Error(`媒体が無い: ${p}`);
          return bytes.get(p);
        }),
        p_scheduled_at: when.scheduled_at,
      });
    } catch (error) {
      autoError = error.message;
      await store
        .updateItem(item.id, "notified", { state: "manual" })
        .catch(() => {});
    }
  }
  const images = await Promise.all(
    imagePaths.map((path) => signImage(path).catch(() => null)),
  );
  // 承認を外したのは、item があった（＝前に Slack で知らせた）ときだけ
  const rebuilt = Boolean(existing.draft && existing.item);
  const head = review
    ? "確認用に今日の下書きを作り直した（送る時刻を過ぎているので、承認・送信はできない）"
    : rebuilt
      ? "一覧がやり直されたので、画像と本文を作り直した（前の承認は外れた）。承認し直して"
      : auto && !autoError
        ? `今日の投稿を ${jstHm(when.scheduled_at)} に自動で送る（承認なし${control.dry_run !== false ? "。ただし試運転中なので claim の前で止まる" : ""}）。止めるには: UPDATE public.sns_x_send_control SET paused = true WHERE id = true;`
        : autoError
          ? `今日の投稿の自動の承認に失敗したので送らない: ${autoError}`
          : state === "manual"
            ? "今日の投稿の下書きができたが、X は個別承認（mode=manual）なので送らない。自動で送るなら sns_auto_send_control の mode を auto にする"
            : "今日の投稿の下書きに禁止表現があり、止めた";
  try {
    await notify(
      `SNS /today（${date}）: ${head}\n${caption}${images
        .filter(Boolean)
        .map((url, i) => `\n画像${i + 1}: ${url}`)
        .join("")}`,
    );
  } catch (error) {
    console.error(`Slack に通知できません: ${error.message}`);
  }
  return done({
    outcome: rebuilt ? "rebuilt" : auto && !autoError ? "notified" : state,
    ...(autoError ? { reason: `auto_failed: ${autoError}` } : {}),
    ...(review ? { review: true } : {}),
    item_id: item.id,
    draft_id: draft.id,
    revision,
    written: true,
  });
}

/** PostgREST の読み書き（service_role）。失敗は握りつぶさず投げる */
export function createTodayStore({ url, key, fetchImpl = fetch }) {
  async function call(path, { method = "GET", body } = {}) {
    const response = await fetchImpl(`${url}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        ...(body !== undefined
          ? {
              "Content-Type": "application/json",
              Prefer: "return=representation",
            }
          : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok)
      throw new Error(
        `/today の計画の DB 操作に失敗: HTTP ${response.status} ${method} ${path.split("?")[0]}`,
      );
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  const one = (rows, what) => {
    if (rows?.length !== 1)
      throw new Error(`${what}（条件に合う行が無い。他の操作と競合した）`);
    return rows[0];
  };
  return {
    async todayState(date) {
      const [drafts, items] = await Promise.all([
        call(
          `sns_drafts?send_lane=eq.A&format=eq.today_digest&source_data->digest->>date=eq.${date}&status=neq.archived&select=id,status,source_data&limit=2`,
        ),
        call(
          `sns_auto_send_items?kind=eq.digest&race_id=eq.${encodeURIComponent(`today:${date}`)}&select=id,state,draft_id`,
        ),
      ]);
      if (drafts.length > 1)
        throw new Error(`/today の下書きが2件ある: ${date}`);
      return { draft: drafts[0] ?? null, item: items[0] ?? null };
    },
    insertDraft: async (row) =>
      one(
        await call("sns_drafts", { method: "POST", body: row }),
        "下書きを作れない",
      ),
    // 承認済みでも書き換える（148 のトリガーが承認を外し、待っている job を取り消す）。送信が始まったものは 148 が拒否する
    async updateTodayDraft(id, patch) {
      return one(
        await call(
          `sns_drafts?id=eq.${id}&status=in.(pending_review,approved)`,
          { method: "PATCH", body: patch },
        ),
        `下書き ${id} を書き換えられない`,
      );
    },
    insertItem: async (row) =>
      one(
        await call("sns_auto_send_items", { method: "POST", body: row }),
        "item を作れない",
      ),
    control: async () =>
      (
        await call(
          "sns_auto_send_control?channel=eq.x&select=mode,dry_run,auto_approver_id",
        )
      )[0] ?? null,
    approve: (args) =>
      call("rpc/approve_sns_x_send", { method: "POST", body: args }),
    async updateItem(id, fromState, patch) {
      return one(
        await call(`sns_auto_send_items?id=eq.${id}&state=eq.${fromState}`, {
          method: "PATCH",
          body: { ...patch, updated_at: new Date().toISOString() },
        }),
        `item ${id} を更新できない`,
      );
    },
  };
}

/**
 * /today の計画の各回の結果を、その日の分だけ残す（scrape_job_state.cursor.today）。report は5分ごとに上書きされ、
 * 送る時刻を過ぎると「時間外」だけになって朝の経過が読めなくなるため（2026-10-17、下書きができなかった朝に原因を追えなかった）。
 * 時間外の skip は残さない。日付が変わったら空から。最新の30件まで
 * @param {{date?: string, events?: object[]}|null|undefined} prev 前回の cursor.today
 * @param {{outcome?: string, reason?: string, item_id?: string}} item この回の report.items の /today の1件
 */
export function nextTodayLog(prev, item, now) {
  const date = jstDate(now);
  const events = prev?.date === date ? [...(prev.events ?? [])] : [];
  if (item && item.reason !== "outside_window" && item.outcome !== "missed")
    events.push({
      at: now.toISOString(),
      outcome: item.outcome ?? null,
      reason: item.reason
        ? String(item.reason)
            .split(" / ")
            .map(firstLine)
            .join(" / ")
            .slice(0, 600)
        : null,
    });
  const same = prev?.date === date;
  return {
    date,
    events: events.slice(-30),
    ...(same && prev.missed_notified ? { missed_notified: true } : {}),
    ...(same && prev.rebuild_failures
      ? { rebuild_failures: prev.rebuild_failures }
      : {}),
  };
}

// 確認用の作り直しが続けて失敗したら、この回数で Slack に知らせてやめる（5分ごとに夜まで繰り返さない）
export const REBUILD_MAX_FAILURES = 3;

/** その日の下書きを作れずに送る時刻を過ぎたときの Slack の文（朝の経過から最後の理由を添える） */
export function missedTodayText(log) {
  const last = [...(log?.events ?? [])]
    .reverse()
    .find((e) => e.reason || e.outcome);
  const at = (iso) =>
    new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(11, 16);
  return [
    `SNS /today（${log?.date}）: ${TODAY_LATEST} までに下書きを作れなかった。今日は送らない`,
    last
      ? `最後の結果（${at(last.at)}）: ${last.outcome}${last.reason ? ` ${last.reason}` : ""}（朝の記録 ${log.events.length}件）`
      : "朝の実行が一度も最後まで終わっていない（関数の時間切れなど。Vercel のログを確かめる）",
  ].join("\n");
}

/**
 * 1回の実行の後の朝の記録と、Slack に出す「作れなかった」の文（その日まだ知らせていないときだけ。知らせたら呼び出し側が
 * log.missed_notified=true にして cursor に保存する）
 */
export function finishTodayLog(prev, item, now, { rebuilding = false } = {}) {
  const log = nextTodayLog(prev, item, now);
  if (rebuilding && item?.outcome === "error")
    log.rebuild_failures = (log.rebuild_failures ?? 0) + 1;
  // 作り直しをやめる（呼び出し側が cursor.today_rebuild を消す）。知らせるのはこのときの1回だけ
  const giveUp =
    rebuilding && (log.rebuild_failures ?? 0) >= REBUILD_MAX_FAILURES;
  if (giveUp) delete log.rebuild_failures;
  return {
    log,
    giveUp,
    notice: giveUp
      ? [
          `SNS /today（${log.date}）: 確認用の作り直しが${REBUILD_MAX_FAILURES}回続けて失敗したので、やめた（もう一度は today_rebuild を入れ直す）`,
          `最後の理由: ${log.events.at(-1)?.reason ?? "なし"}`,
        ].join("\n")
      : item?.outcome === "missed" && !log.missed_notified
        ? missedTodayText(log)
        : null,
  };
}
