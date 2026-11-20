/**
 * X の「数字で見たら」（集計ランキングの画像1枚、format=research_image、X だけ、月・水・金 19:00）のフォルダを受け取り、
 * X の下書きと自動送信の item を作って、送る時刻（19:00 等）の予定に入れる（hq XR01、マイグレーション 179・180）。
 * hq の作業役が同じ Mac の本リポジトリで実行する（15:00 に作り、--no-wait で入れて 19:00 に送り手が送る）。
 * 鍵は本リポジトリの .env.local（SUPABASE_URL・SUPABASE_SERVICE_KEY）だけを使う。
 * 同じ形の「節の機力」（kind=setsu_kiryoku、毎日 21:30、BOA-1209、マイグレーション 194）も、この口が型（DAILY_IMAGE_TYPES）ごとに受け取る。
 * 入口は scripts/sns/push-setsu-kiryoku.js（hq の setsu_sheet.py の出力）。違いは PUSH_RULES の注記を見る
 *
 * 使い方:
 *   node --env-file=.env.local scripts/sns/push-research-image.js <フォルダ> [--dry-run] [--no-wait]
 *   node --env-file=.env.local scripts/sns/push-research-image.js --status <YYYY-MM-DD>   その日の状態・tweet id を出す
 *
 * フォルダ（hq の research_rank.py の出力）: bundle.json と PNG 1枚（1080×1350）。ほかのファイルは読まない
 *   {format:"research_image", date:"YYYY-MM-DD"（送る日の JST）, slug:"英小文字・数字・ハイフン 40字まで", send_time:"HH:MM"（JST）,
 *    x_text:"本文（ハッシュタグ・リンクなし）", hashtags:["#ボートレース"]（0〜2個）, images:["<slug>.png"],
 *    source_observed_at:"集計した時刻（ISO）", review:{p0_count:0, by}}
 *
 * race_id の代わり: research:{date}:{slug}（item の race_id・下書きの source_data.race_id・結果の research_id）。1日1本（179 の一意の索引）
 * 時刻（すべて送る時刻 S＝date の send_time から決まる）:
 *   締切（deadline_at）＝S＋120分、期限（expires_at、送り手が送れる最後）＝締切−60分＝S＋60分（180 の research_image の期限と同じ）。
 *   送る時刻（scheduled_at・veto_until）＝S と「今＋2分」の遅い方。期限の10分前を過ぎて届いたら受け取らない。
 *   send_time は 08:00〜21:30（送り手の cron が JST 22:58 まで動くので、期限が 22:30 までに収まる。目安）
 *   source_observed_at（集計の時刻）は今より前、かつ期限まで24時間以内（180 の research_image の鮮度と同じ。超えると送り手が source_stale で止める）
 * 自動送信の許可（sns_auto_send_control の x の行の research_image_enabled、179）は既定 off。
 * off の間は --dry-run と同じ（検査だけして DB・Storage・Slack に書かない、exit 3）。送り手（cron sns-send）も off の job を送らない
 * X の日の上限（daily_limit_x）は、受け取る時点でもう1本が入らなければ受け取らない（19:00 までの他の投稿は数えられない。送り手の claim が最後に数える）
 * 送るのは送り手（cron sns-send、2分ごと）。push は job を入れた後、送り終わる（posted・held 等）か期限＋90秒まで待つ（--no-wait で待たない）
 *
 * stdout の最後の1行は `RESEARCH_RESULT {...}`（research_id・outcome・job_id・job_state・tweet_id・tweet_url・posted_at・error_code・reason）
 * exit: 0 送った（--dry-run は検査が通った・--no-wait は予定に入れた）・1 検査で拒否・2 使い方・鍵の不足・3 許可が off なので書かなかった
 *   ・4 同じ日の research_image が既にある（何もしない）・5 予定に入れたが送れなかった（保留・期限切れ・自動モードでない）・6 想定外の失敗
 * --status は、その日の生きている item（無ければ最新）と job の状態・送れていない理由（held の error_code、送る前の検査で落ちた理由
 *   precheck_reason（送り手の最後の報告から、30分だけ残る）、待ちのまま送る時刻を過ぎていれば日の上限の見込み blocked_hint）を JSON で出す（hq の記録用。送れなかった理由は sns_x_send_jobs.error_code と item の held_reason に残る）
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { dailyIdOf } from "../../api/_lib/snsResearchImage.js";
import { PUSH_RULES } from "../lib/sns/researchPushRules.js";
import { waitForSend } from "./push-finals-image.js";
import { RESEARCH_TYPE, SETSU_TYPE } from "./pushResearchImageChecks.js";
import { createRestStore } from "./pushResearchImageStore.js";
import { pushDailyImage, researchStatus } from "./pushResearchImageRun.js";
import { resultLine } from "./pushResearchImageRows.js";

// 分けた先から、これまでの名前のまま再 export する（verify・入口の import 先）
export {
  DEADLINE_AFTER_MIN,
  EXPIRES_BEFORE_MIN,
  LATEST_BEFORE_EXPIRES_MIN,
  SEND_DELAY_SEC,
  MAX_SOURCE_AGE_SEC,
  SEND_TIME_EARLIEST,
  SEND_TIME_LATEST,
  schedule,
  dryRunClock,
  observedAtOf,
  checkTiming,
} from "../lib/sns/researchSchedule.js";
export { PUSH_RULES } from "../lib/sns/researchPushRules.js";
export {
  RESEARCH_TYPE,
  SETSU_TYPE,
  checkResearchBundle,
} from "./pushResearchImageChecks.js";
export {
  dailyStatusOf,
  draftRow,
  researchStatusOf,
  resultLine,
} from "./pushResearchImageRows.js";
export { createRestStore } from "./pushResearchImageStore.js";
export { pushDailyImage, researchStatus } from "./pushResearchImageRun.js";

/**
 * 受け取って送る予定に入れる。deps は DB・Storage・Slack（テストで差し替える）。
 * 返り値: { reasons }（不合格）・{ dryRun, disabled }（書かなかった）・{ already }・{ research_id, draft_id, item_id, job_id, send_at, ... }
 */
export const pushResearchImage = (folder, deps) =>
  pushDailyImage(folder, { ...deps, type: RESEARCH_TYPE });
export const pushSetsuKiryoku = (folder, deps) =>
  pushDailyImage(folder, { ...deps, type: SETSU_TYPE });

/** --status <日付> の出力（その日の状態の JSON）。日付が違えば使い方を出して exit 2 */
async function printStatus(args, { store, type, usage }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args[1] ?? "")) {
    console.error(usage);
    process.exit(2);
  }
  console.log(
    JSON.stringify(await researchStatus(args[1], { store, type }), null, 2),
  );
}

/** bundle.json から id を読む（読めなければ null。後の pushDailyImage が投げ、error の1行にする） */
async function readResearchId(folder, type) {
  try {
    const b = JSON.parse(
      await readFile(path.join(folder, "bundle.json"), "utf8"),
    );
    if (b?.date && b?.slug) return dailyIdOf(type, b.date, b.slug);
  } catch {
    /* 読めない bundle.json は pushResearchImage が投げ、下で error の1行にする */
  }
  return null;
}

/** Slack の webhook へ送る notify（webhook が無ければ標準出力だけ） */
const slackNotify = (webhook) => async (text) => {
  console.log(text);
  if (!webhook) return;
  const response = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok)
    throw new Error(`Slack が HTTP ${response.status} を返した`);
};

/** CLI。型ごとの入口（push-research-image.js・push-setsu-kiryoku.js）から呼ぶ */
export async function main(
  type = RESEARCH_TYPE,
  script = "push-research-image.js",
) {
  const args = process.argv.slice(2);
  const tag = PUSH_RULES[type.kind].tag;
  const usage = `使い方: node --env-file=.env.local scripts/sns/${script} <フォルダ> [--dry-run] [--no-wait] | --status <YYYY-MM-DD>`;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL・SUPABASE_SERVICE_KEY が無い（.env.local）");
    process.exit(2);
  }
  const store = createRestStore({ url, key, type });
  if (args[0] === "--status") return printStatus(args, { store, type, usage });
  const dryRun = args.includes("--dry-run");
  const folder = args.find((a) => !a.startsWith("--"));
  if (!folder) {
    console.error(usage);
    process.exit(2);
  }
  const webhook =
    process.env.SLACK_WEBHOOK_URL || process.env.SLACK_DIGEST_WEBHOOK_URL;
  const researchId = await readResearchId(folder, type);
  // どこで落ちても、最後の1行は RESEARCH_RESULT・SETSU_RESULT（exit 6）
  const fail = (error) => {
    console.error(error);
    console.log(
      `${tag} ${JSON.stringify({ [type.idField]: researchId, outcome: "error", reason: String(error?.message ?? error) })}`,
    );
    process.exit(6);
  };
  const riskRules = await readFile(
    new URL("../../sns-video-studio/remotion/risk-rules.json", import.meta.url),
    "utf8",
  )
    .then((text) => JSON.parse(text).rules)
    .catch(fail);
  const result = await pushDailyImage(folder, {
    type,
    store,
    readBytes: async (p) => {
      await stat(p);
      return new Uint8Array(await readFile(p));
    },
    notify: slackNotify(webhook),
    riskRules,
    dryRun,
  }).catch(fail);
  console.log(JSON.stringify(result, null, 2));
  const status =
    result.job_id && !args.includes("--no-wait")
      ? await waitForSend(result[type.idField], {
          store,
          draftId: result.draft_id,
          expiresAt: result.when.expires_at,
          sleep: (sec) => new Promise((r) => setTimeout(r, sec * 1000)),
        }).catch(fail)
      : null;
  const { code, text } = resultLine(result, status, {
    waited: Boolean(status),
    type,
  });
  console.log(text);
  process.exit(code);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
