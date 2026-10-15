/**
 * /today（本日のデータ一覧）の画像つき X 投稿の計画（sns-pdca-loop tasks 19b、通り道 A、plan §8）。
 * cron `sns_auto_plan` が毎回呼ぶ（api/cron/sns-auto-plan.js）。JST 5:30〜7:45 だけ動く。
 *
 * 1回の流れ:
 *   その日の一覧（morning_digest_*、5:30 に公開）を読む → 版（snsTodayDigest.js）
 *   → まだ下書きが無ければ: /today を未ログインで撮る（スマホ幅の上部 4:5）→ Storage へ → 決まった型で本文を組み立てる（AI 生成なし）
 *     → 下書き（send_lane A）→ UTM（today_digest）→ item（kind digest、158）を manual（禁止表現があれば held_manual）→ Slack に画像のリンク
 *   → 下書きがあり、一覧がやり直されて版が変わっていれば（6:30・8:00）: 撮り直して下書きを書き換える。148 のトリガーが承認を外すので、
 *     Slack で承認のし直しを頼む（承認した画像と違うものを送らない）
 *
 * - 送る時刻は 7:45、事前通知の期限は 5:45（−2h）。締切は持たないので、送る時刻＋60分（8:45）を締切として item に入れる
 *   （notify_by=締切−3h=5:45、veto_until=締切−60分=7:45、失効=締切−30分=8:15。レースの全貌と同じ計算）
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

export const TODAY_URL = `${SITE_BASE_URL}/today`;

/** その日の時刻（ISO）。送る 7:45、締切に見立てる 8:45 から、レースと同じ −3h・−60分・−30分 */
export function todaySchedule(date) {
  const at = (hhmm) => new Date(`${date}T${hhmm}:00+09:00`).toISOString();
  return {
    plan_from: at("05:30"),
    scheduled_at: at("07:45"),
    deadline_at: at("08:45"),
    notify_by: at("05:45"),
    veto_until: at("07:45"),
    expires_at: at("08:15"),
  };
}

export const todayTrackingUrl = (date) =>
  `${TODAY_URL}?utm_source=x&utm_medium=social&utm_campaign=today_digest&utm_content=${date}`;

// 本文に載せる区分と人数・最低の走数（2026-10-15 オーナー承認の型）。逃がし・注目レースは、選ぶ式の向きを /today 側で直すまで載せない
// 見出し（2026-10-15 hq 承認の文）。割合は一覧に保存されたしきい値（morning_digest_days.notes.thresholds）を使う
export const TODAY_PICK_RULES = [
  {
    section: "nige",
    limit: 3,
    threshold: 70,
    heading: (pct) =>
      `逃げが堅い1号艇（全国で1コースに入ったとき逃げ切った割合${pct}%以上）`,
  },
  {
    section: "makuri",
    limit: 2,
    threshold: 25,
    heading: (pct) =>
      `まくりが利く選手（そのコースでまくりで1着の割合${pct}%以上）`,
  },
];
export const TODAY_MIN_SAMPLE = 30;
export const TODAY_NOTICE =
  "過去の実績は当日の結果を保証しません。展示後は進入と展示タイムも確認してください。";

/** 載せてよい候補（区分・rank の順）。送る時刻までに締切を過ぎる・走数30未満・締切の無い行は除く。区分の中の同じレースは最初の行だけ */
export function todayCandidates(rows, sendAt = "07:45") {
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
 * 区分ごとに見出し1行と、締切の早い順の行（逃げ→まくり）。1行は「会場R HH:MM締切｜艇番 選手名｜全国N走」（2026-10-15 hq 承認）
 */
export function buildTodayPost(
  digest,
  { date, t, url, sendAt = "07:45", excluded = new Set() },
) {
  const model = buildTodayModel(digest, { date, t });
  const candidates = todayCandidates(digest.rows, sendAt).filter(
    (row) => !excluded.has(`${row.race_id}:${row.boat_number}`),
  );
  const picks = TODAY_PICK_RULES.flatMap(({ section, limit }) =>
    candidates.filter((row) => row.section === section).slice(0, limit),
  ).sort(
    (a, b) =>
      a.start_time.localeCompare(b.start_time) ||
      a.venue_code - b.venue_code ||
      a.race_number - b.race_number,
  );
  if (!picks.length) return null;
  const lines = [`本日のデータ一覧（${model.dateLine}）`, ""];
  const thresholds = digest.day?.notes?.thresholds ?? {};
  for (const rule of TODAY_PICK_RULES) {
    const rows = picks.filter((row) => row.section === rule.section);
    if (!rows.length) continue;
    lines.push(rule.heading(thresholds[rule.section] ?? rule.threshold));
    for (const row of rows)
      lines.push(
        `${t(`venues.${row.venue_code}`)}${row.race_number}R ${row.start_time.slice(0, 5)}締切｜${row.boat_number}号艇 ${String(row.racer_name ?? "").replace(/\u3000/g, " ")}｜全国${row.sample_size}走`,
      );
    lines.push("");
  }
  lines.push(TODAY_NOTICE, url);
  return {
    text: lines.join("\n"),
    picks: picks.map((row) => ({
      race_id: row.race_id,
      boat_number: row.boat_number,
    })),
  };
}

const jstDate = (date) =>
  new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);

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
  },
) {
  const live = ctx.mode === "live";
  const now = ctx.now();
  const date = jstDate(now);
  const when = todaySchedule(date);
  const done = (extra) => ({
    rowsWritten: extra.written ? 1 : 0,
    report: { items: [{ kind: "digest", date, ...extra }], alerts: [] },
  });
  if (now < new Date(when.plan_from) || now >= new Date(when.veto_until))
    return done({ outcome: "skipped", reason: "outside_window" });
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
  // held_manual（禁止表現）・止めた item は、版が変わっても作り直さない（オーナーの判断に回す）
  if (existing.item && existing.item.state !== "manual")
    return done({ outcome: "skipped", reason: `item_${existing.item.state}` });

  const trackingUrl = todayTrackingUrl(date);
  // 欠場・中止・締切を確かめられない候補は除く（区分の上限までは後ろの rank から補う）
  const statuses = await pickRaceStatus(raceDb, todayCandidates(digest.rows));
  const excluded = new Set(
    statuses
      .filter((p) => p.reason)
      .map((p) => `${p.race_id}:${p.boat_number}`),
  );
  const post = buildTodayPost(digest, { date, t, url: trackingUrl, excluded });
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

  // 撮れないうちは何も書かない（例外で止め、次の実行でやり直す）
  const shot = await headless.screenshot({
    url: TODAY_URL,
    requiredSelectors: markers[TODAY_SCREEN_KEY],
  });
  if (shot.finalUrl !== TODAY_URL) throw new Error("screenshot_redirected");
  const checkedAt = now.toISOString();
  const imagePath = `today/${date}/${revision}.png`;
  await saveImage(imagePath, shot.png);
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
    // picks は送る直前の検査（readCurrent）が欠場・中止を読み直す対象
    digest: { date, revision, picks: post.picks },
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
    // 個別承認の DB 側の条件（140 approve_sns_mobile_channel: 出典と claims が空でないこと）を満たす出典の記録。
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
  await trackingStore.save({
    draft_id: draft.id,
    template_variant_id: null,
    race_url: TODAY_URL,
    tracking_url: trackingUrl,
    utm_source: "x",
    utm_medium: "social",
    utm_campaign: "today_digest",
    utm_content: date,
    release_evidence: releaseEvidence,
  });
  const state = risk.length ? "held_manual" : "manual";
  const checks = {
    passed: risk.length === 0,
    risk: risk.map((r) => r.id),
    digest_revision: revision,
    display: { ok: true, checked_at: checkedAt },
    checked_at: checkedAt,
  };
  const heldReason = risk.length ? `禁止表現: ${checks.risk.join(",")}` : null;
  const item = existing.item
    ? await store.updateItem(existing.item.id, "manual", {
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
  const image = await signImage(imagePath).catch(() => null);
  // 承認を外したのは、item があった（＝前に Slack で知らせた）ときだけ
  const rebuilt = Boolean(existing.draft && existing.item);
  const head = rebuilt
    ? "一覧がやり直されたので、画像と本文を作り直した（前の承認は外れた）。承認し直して"
    : state === "manual"
      ? "今日の投稿の下書きができた。7:45 までに個別承認の画面で承認すると、7:45 に送る"
      : "今日の投稿の下書きに禁止表現があり、止めた";
  try {
    await notify(
      `SNS /today（${date}）: ${head}\n${caption}${image ? `\n画像: ${image}` : ""}`,
    );
  } catch (error) {
    console.error(`Slack に通知できません: ${error.message}`);
  }
  return done({
    outcome: rebuilt ? "rebuilt" : state,
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
