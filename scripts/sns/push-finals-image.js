/**
 * 優勝戦の「展示を見た直前の思考の順」の画像投稿（format=finals_image、X だけ）のフォルダを受け取り、X の下書きと自動送信の item を作って
 * 今すぐ送る予定に入れる（hq FT02、マイグレーション 176）。hq の作業役が同じ Mac の本リポジトリで実行する。
 * 鍵は本リポジトリの .env.local（SUPABASE_URL・SUPABASE_SERVICE_KEY）だけを使う。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/sns/push-finals-image.js <フォルダ> [--dry-run] [--no-wait]
 *   node --env-file=.env.local scripts/sns/push-finals-image.js --status <race_id>   送った時刻・tweet id を出す
 *
 * フォルダ（hq の finals_run.py の出力）: bundle.json と PNG 4枚（1080×1350）。ほかのファイル（HTML 等）は読まない。bundle.format で2つに分ける
 *   本投稿（展示前の版、締切の約3時間前）: {format:"finals_image", race_id, x_text, deadline:"HH:MM"（JST）, images:[4つの名前],
 *     review:{p0_count, by}, poll?:[4つの選択肢（各25字まで）], poll_text?}
 *     poll・poll_text は任意（BOA-1208、オーナー 2026-10-31 に投票のリプをやめた）。無ければ本投稿1本だけを作る。
 *     あれば本投稿と、その直後に本投稿へのリプで出す投票（本文 poll_text、締切で閉じる。177）の2つを作る。投票のリプは本投稿が posted になってから送る
 *   展示後のリプ（締切の25〜13分前、任意。来なくても本投稿は完了。BOA-1208）: {format:"finals_reply", race_id, x_text, deadline:"HH:MM", images:[4つの名前], review:{p0_count, by}}
 *     本投稿（posted）へのリプで画像4枚と本文。13分前を過ぎたら受け取らない（出さない）
 *   images は <race_id>-1-map.png・-2-q12.png・-3-q3.png・-4-routes.png のこの順（この順で1投稿に付く）
 *
 * 自動送信の許可（sns_auto_send_control の x の行の finals_image_enabled）は既定 off。
 * off の間は --dry-run と同じ（検査だけして DB・Storage に書かない、exit 3）。送り手（cron sns-send）も off の job を送らない
 *
 * 時刻: 全貌の 60分の遅らせ・45分の締め・30分の期限は当てない。送る時刻＝今すぐ、期限＝締切の5分前（3本とも）。
 * 本投稿は締切の15分前を過ぎて届いたら受け取らない。展示後のリプは締切の25分前より前・13分前を過ぎたら受け取らない（exit 1 と理由）。
 * X の日の上限（daily_limit_x）は1本ずつ数える。投票のある本投稿は投票のリプと対で2本分（投票が無ければ1本分）の空きが無ければ受け取らない（送り手の claim も対で数える、177）。
 * 優勝戦の取り置き（182、sns_x_kind_reserves の finals_image）に入らないときも受け取らない
 * 送るのは送り手（cron sns-send、2分ごと）。push は job を入れた後、送り終わる（posted・held 等）か期限を過ぎるまで待つ（--no-wait で待たない）。
 * 本投稿は投票のリプがあれば、それが送り終わるまで待つ（展示後のリプは別の push で、本投稿の完了はそれを待たない）
 *
 * /today の対象レースの思考投稿（BOA-1169、マイグレーション 189）も同じ型で受け取る。bundle の format は today_thinking_image（本投稿）・
 *   today_thinking_reply（展示後のリプ）で、形・時刻の窓・画像の名前・投票4択（任意）は優勝戦と同じ。違うのは次だけ:
 *   item の kind は today_thinking・variant は thinking・thinking_poll・thinking_reply、下書きの format は3本とも today_thinking_image・
 *   source_data のキーは today_thinking、許可は today_thinking_enabled、取り置きは today_thinking、Storage は today-thinking/、
 *   優勝戦の段（race_stage）は見ない。代わりに、その日の /today の X 投稿が posted で、race_id がその対象（today-picks.js の featured か list）か、
 *   その日の格の最上位（SG ＞ PG1 ＞ G1）の場の 10〜12R であること。同じ格が2場以上なら 12R の締切が遅い方の場（hq の a2、オーナー 2026-10-31・11-02 の (a)）
 *   node --env-file=.env.local scripts/sns/push-finals-image.js --status <race_id> --kind today_thinking   思考投稿の状態
 *
 * stdout の最後の1行は `FINALS_RESULT {...}`（race_id・part（main・reply）・kind（finals_image・today_thinking）・outcome・job_id・job_state・
 *   tweet_id・tweet_url・posted_at・error_code・reason・poll_job_id・poll_job_state・poll_tweet_id・poll_error_code）
 * exit: 0 送った（本投稿は投票のリプも。--dry-run は検査が通った・--no-wait は予定に入れた）・1 検査で拒否・2 使い方・鍵の不足
 *   ・3 許可が off なので書かなかった・4 同じレースの同じ種類が既にある（何もしない）・5 予定に入れたが送れなかった（保留・期限切れ・
 *   個別承認・本投稿は出たが投票のリプが出なかった）
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { hasPoll, schedule } from "../lib/sns/finalsImageBase.js";
import { KINDS, bundleKindOf } from "./pushFinalsImageKinds.js";
import { CHECKS } from "./pushFinalsImageChecks.js";
import { readImages } from "./pushFinalsImageRows.js";
import {
  findPrior,
  makeReject,
  receiveCheck,
  revisionOf,
  writeRows,
} from "./pushFinalsImageSteps.js";
import {
  finalsStatus,
  resultLine,
  waitForSend,
} from "./pushFinalsImageStatus.js";
import { createRestStore } from "./pushFinalsImageStore.js";

// 分けたファイルへ移した名前も、今までどおりこのファイルから import できる
export {
  FINALS_IMAGE_FORMAT,
  FINALS_REPLY_FORMAT,
  FINALS_STAGE,
  IMAGE_SUFFIXES,
  imageNamesOf,
  IMAGE_WIDTH,
  IMAGE_HEIGHT,
  IMAGE_MAX_BYTES,
  EXPIRES_BEFORE_MIN,
  LATEST_BEFORE_MIN,
  SEND_DELAY_SEC,
  REPLY_EARLIEST_BEFORE_MIN,
  REPLY_LATEST_BEFORE_MIN,
  BANNED_WORDS,
  POLL_OPTIONS,
  TODAY_THINKING_IMAGE_FORMAT,
  TODAY_THINKING_REPLY_FORMAT,
  hasPoll,
  pngSize,
  checkImages,
  schedule,
  dailyLimitReason,
  reservedChildren,
  RETRYABLE_JOB_STATES,
  statusOf,
} from "../lib/sns/finalsImageBase.js";
export {
  THINKING_GRADE_DAY_GRADES,
  THINKING_GRADE_DAY_MIN_RACE_NUMBER,
  THINKING_GRADE_DAY_MAX_RACE_NUMBER,
  thinkingGradeDayVenue,
  isThinkingGradeDayRace,
  todayTargetReason,
} from "../lib/sns/thinkingGradeDay.js";
export {
  FINALS_VARIANT,
  FINALS_POLL_VARIANT,
  FINALS_REPLY_VARIANT,
  TODAY_THINKING_KIND,
  KINDS,
  BUNDLE_FORMATS,
  bundleKindOf,
} from "./pushFinalsImageKinds.js";
export {
  THINKING_URL_REASON,
  checkFinalsImage,
  checkFinalsReply,
  checkTodayThinkingImage,
  checkTodayThinkingReply,
  checkRace,
} from "./pushFinalsImageChecks.js";
export { draftRow } from "./pushFinalsImageRows.js";
export {
  WAIT_POLL_SEC,
  WAIT_AFTER_EXPIRES_SEC,
  finalsStatus,
  waitForSend,
  resultLine,
} from "./pushFinalsImageStatus.js";
export { createRestStore } from "./pushFinalsImageStore.js";

/** この種類の自動送信の許可を読み、書き込みをするか（許可が on で --dry-run でない）を返す */
async function readPermission(store, cfg, dryRun) {
  // 読むのはこの種類の許可の列だけ（他の種類の列が無い＝マイグレーションの前でも、この種類の許可を外さない）
  const controls = await store.controls(cfg.flag);
  // 列が無い（176・189 が未適用）・行が無いときも off（fail-closed）。許可は本投稿・投票のリプ・展示後のリプに共通
  const enabled = controls.x?.[cfg.flag] === true;
  return { controls, enabled, writes: enabled && !dryRun };
}

/**
 * 受け取って送る予定に入れる。deps は DB・Storage・Slack（テストで差し替える）。bundle.format で種類（優勝戦・思考投稿）と
 * 本投稿・展示後のリプを分ける（BUNDLE_FORMATS）。
 * 返り値: { reasons }（不合格）・{ dryRun, disabled }（書かなかった）・{ already }・{ part, draft_id, item_id, job_id, send_at, ... }。
 * どれにも part と kind（item の kind）が付く
 */
export async function pushFinalsImage(
  folder,
  {
    store,
    readBytes,
    notify = async () => {},
    riskRules = [],
    now = new Date(),
    dryRun = false,
  },
) {
  const bundle = JSON.parse(
    new TextDecoder().decode(await readBytes(path.join(folder, "bundle.json"))),
  );
  const { kind, part } = bundleKindOf(bundle?.format);
  const cfg = KINDS[kind];
  const reply = part === "reply";
  const head = { part, kind };
  const label = cfg.label[part];
  const { controls, enabled, writes } = await readPermission(
    store,
    cfg,
    dryRun,
  );
  const reject = makeReject({ writes, notify, label, bundle, head });
  const reasons = CHECKS[kind][part](bundle, riskRules);
  if (reasons.length) return reject(reasons);
  // 同じレース・同じ種類の生きている item・送った item があれば何も作らず、今の状態を返す（DB の一意の索引でも止まる、176・177）。
  // 送らずに終わった自動の item は superseded で止めて作り直す
  const prior = await findPrior(store, bundle, { kind, cfg, part });
  if (prior.already) return { ...head, ...prior.already };
  if (reply && !prior.parentJob)
    return reject(["本投稿がまだ送られていない（リプの親が無い）"]);
  const names = bundle.images;
  const { files, reasons: imageReasons } = await readImages(
    folder,
    names,
    readBytes,
  );
  if (imageReasons.length) return reject(imageReasons);
  const withPoll = !reply && hasPoll(bundle);
  const raceCheck = await receiveCheck({
    store,
    bundle,
    cfg,
    reply,
    now,
    need: withPoll ? 2 : 1,
  });
  if (raceCheck.reasons.length) return reject(raceCheck.reasons);
  const when = schedule(raceCheck.deadlineAt, now);
  const revision = revisionOf(bundle, names, files);
  if (!writes)
    return {
      ...head,
      dryRun: true,
      enabled,
      // --dry-run でなく、許可が off なので書かなかった（exit 3）
      disabled: !dryRun,
      revision,
      when,
    };
  const out = await writeRows(
    store,
    { bundle, cfg, kind, reply, names, files, revision, when, now },
    {
      retry: prior.retry,
      controls,
      parentJob: prior.parentJob,
      withPoll,
      notify,
      label,
    },
  );
  return { ...head, ...out, revision, when };
}

const USAGE =
  "使い方: node --env-file=.env.local scripts/sns/push-finals-image.js <フォルダ> [--dry-run] [--no-wait] | --status <race_id> [--kind today_thinking]";

/** --status <race_id> [--kind <種類>]: 送った時刻・tweet id を出す */
async function printStatus(args, store) {
  const kindAt = args.indexOf("--kind");
  const kind = kindAt > 0 ? args[kindAt + 1] : "finals_image";
  if (
    !args[1] ||
    args[1].startsWith("--") ||
    !Object.hasOwn(KINDS, kind ?? "")
  ) {
    console.error(USAGE);
    process.exit(2);
  }
  console.log(
    JSON.stringify(await finalsStatus(args[1], { store, kind }), null, 2),
  );
}

/** リスクの規則（risk-rules.json の rules） */
const readRiskRules = async () =>
  JSON.parse(
    await readFile(
      new URL(
        "../../sns-video-studio/remotion/risk-rules.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ).rules;

/** フォルダの bundle.json の race_id。読めなければ null（読めない bundle.json は pushFinalsImage が投げ、error の1行にする） */
async function bundleRaceIdOf(folder) {
  try {
    return JSON.parse(await readFile(path.join(folder, "bundle.json"), "utf8"))
      .race_id;
  } catch {
    return null;
  }
}

/** Slack の webhook があれば送る通知（無ければ標準出力だけ） */
const makeNotify = (webhook) => async (text) => {
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

const readLocalBytes = async (p) => {
  await stat(p);
  return new Uint8Array(await readFile(p));
};

/** job を作ったら、送り手が送り終わるまで待つ（--no-wait なら待たない） */
const waitIfQueued = (args, result, bundleRaceId, store, fail) =>
  result.job_id && !args.includes("--no-wait")
    ? waitForSend(bundleRaceId, {
        store,
        draftId: result.draft_id,
        pollDraftId: result.poll_draft_id ?? null,
        expiresAt: result.when.expires_at,
        sleep: (sec) => new Promise((r) => setTimeout(r, sec * 1000)),
      }).catch(fail)
    : null;

async function main() {
  const args = process.argv.slice(2);
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL・SUPABASE_SERVICE_KEY が無い（.env.local）");
    process.exit(2);
  }
  const store = createRestStore({ url, key });
  if (args[0] === "--status") return printStatus(args, store);
  const dryRun = args.includes("--dry-run");
  const folder = args.find((a) => !a.startsWith("--"));
  if (!folder) {
    console.error(USAGE);
    process.exit(2);
  }
  const webhook =
    process.env.SLACK_WEBHOOK_URL || process.env.SLACK_DIGEST_WEBHOOK_URL;
  const riskRules = await readRiskRules();
  const bundleRaceId = await bundleRaceIdOf(folder);
  // どこで落ちても、最後の1行は FINALS_RESULT（exit 6）
  const fail = (error) => {
    console.error(error);
    console.log(
      `FINALS_RESULT ${JSON.stringify({ race_id: bundleRaceId ?? null, outcome: "error", reason: String(error?.message ?? error) })}`,
    );
    process.exit(6);
  };
  const result = await pushFinalsImage(folder, {
    store,
    readBytes: readLocalBytes,
    notify: makeNotify(webhook),
    riskRules,
    dryRun,
  }).catch(fail);
  console.log(JSON.stringify(result, null, 2));
  const status = await waitIfQueued(args, result, bundleRaceId, store, fail);
  const { code, text } = resultLine(bundleRaceId, result, status);
  console.log(text);
  process.exit(code);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
