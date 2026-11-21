/**
 * YouTube Shorts「節の機力」（format・kind = setsu_kiryoku_short、BOA-1209、マイグレーション 193）のフォルダを受け取り、
 * YouTube の下書き（動画1本）と自動送信の item を作って、送る時刻の予定に入れる。全貌の Shorts（push-full-picture.js の版2）とは別の出し物で、
 * 親の完全版を持たない単独の Shorts。hq の作業役が同じ Mac の本リポジトリで実行する（1日1本、21:30 ごろ、hq drafts/venue-shorts-request-20261031.md）。
 * 鍵は本リポジトリの .env.local（SUPABASE_URL・SUPABASE_SERVICE_KEY）だけを使う。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/sns/push-setsu-kiryoku-short.js <フォルダ> [--dry-run] [--no-wait]
 *   node --env-file=.env.local scripts/sns/push-setsu-kiryoku-short.js --status <YYYY-MM-DD> [border|main]   その日の状態・動画の URL を出す
 *     （版を付けなければ、生きている item のうち新しい方。border の日は版を付けて読む）
 *
 * フォルダ（hq の作り手の出力）: bundle.json と mp4 1本（縦・60秒まで・32 MiB まで）。ほかのファイルは読まない
 *   bundle.json の形は sns-video-studio/remotion/src/setsuKiryoku/model.js（型の正本）。この口が足す欄（どれも任意）:
 *     video: mp4 の名前（無ければ "<variant>.mp4"）、send_time: 送る時刻 "HH:MM"（JST、無ければ受け取りの2分後）、
 *     source_observed_at: 集計した時刻（時差つきの ISO。無ければ受け取りの時刻）
 *   題・説明欄は bundle の youtube.title・youtube.description をそのまま送る（書き換えない）
 *
 * 検査（どれかが通らなければ何も書かない）:
 *   1. 型の検査（setsuKiryoku/model.js の checkBundle）をもう一度通す: 禁止語・言い切り・risk-rules・画面の文の数と bundle の値の照合・
 *      名前と級・final_gap の date と final_date と when・主役の選び など（作り手が通した後も、送る口で必ず通す）
 *   2. この口の検査: 会場名が24場のどれか、題は100字まで・改行と < > なし、説明欄は5000バイトまで・< > なし、説明欄のリンクはちょうど1つで
 *      その会場のページ（https://www.boat-ai.jp/venue/{会場コード}、クエリは utm_* だけ）、動画は MP4・縦・60秒まで・32 MiB まで
 *   3. 時刻: date は今日（JST）、送る時刻は 22:00 まで、受け取りは送る時刻の15分前から、期限の10分前より前、集計の時刻は今より前で期限まで鮮度の線（max_source_age_seconds）の内
 *   4. 優勝戦の型で when=today: その日のその会場の優勝戦が DB にあり、中止・欠場が無い
 *   5. 二重送信: 同じ日・同じ版（item の variant。border の束は 'border'、ほかの型は 'main'）の setsu_kiryoku_short が生きているか
 *      送ってあれば作らない（exit 4、201 の一意の索引でも止まる）。朝の border と夜の節の機力は同じ日に両方受ける（BOA-1249）。
 *      final_gap は同じ優勝戦（日と会場）を前夜と当日で2回出さない。前の束が送らずに終わっていれば（held・failed・cancelled・承認の途中で落ちた）作り直す
 *   6. YouTube の日の上限（daily_limit_youtube）とクォータ（sns_youtube_quota_control）: 今日の試行・まだ claim していない YouTube の予定に
 *      この1本（1 upload・104 units、146 の claim の予約と同じ値）が入るか。claim でも DB がもう一度数えて予約する
 *
 * 時刻（送る時刻 S＝date の send_time と「今＋2分」の遅い方）: 期限（expires_at、送り手が送れる最後）＝S＋60分、
 *   締切（deadline_at）＝期限＋sns_x_send_control.expiry_minutes（186 の youtube_call の照合と同じ値で、kind で変えない）
 * 自動送信の許可（sns_auto_send_control の youtube の行の setsu_kiryoku_short_enabled、193）は既定 off。
 * off の間は --dry-run と同じ（検査だけして DB・Storage・Slack に書かない、exit 3）。送り手（cron sns-send）も off の job を送らない
 * --dry-run は DB を読むだけ。date が今日でない束（見本の束）は、その日の送る時刻（send_time、無ければ 21:30）の2分前に受け取ったとして時刻の検査をする
 *   （結果の simulated_now。DB の数（日の上限・クォータ・二重送信）は今の値で見る）
 *
 * stdout の最後の1行は `SETSU_RESULT {...}`（setsu_id・variant（border・main）・outcome・job_id・job_state・video_id・video_url・posted_at・error_code・reason）
 * exit: 0 送った（--dry-run は検査が通った・--no-wait は予定に入れた）・1 検査で拒否・2 使い方・鍵の不足・3 許可が off なので書かなかった
 *   ・4 同じ日・同じ版の setsu_kiryoku_short が既にある（何もしない）・5 予定に入れたが送れなかった（保留・期限切れ・自動モードでない）・6 想定外の失敗
 */
import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { outcomeOf, resultFields } from "./shortPushCommon.js";
import { createRestStore } from "./pushSetsuKiryokuShortStore.js";
import {
  pushSetsuKiryokuShort,
  setsuStatus,
  waitForSend,
} from "./pushSetsuKiryokuShortFlow.js";

// 分けたファイルから移した名前は、ここから従来どおり import できるように再 export する
export {
  MAX_DURATION_SEC,
  VIDEO_MAX_BYTES,
  checkShortBundle,
  checkVideo,
  descriptionLink,
  videoNameOf,
} from "./pushSetsuKiryokuShortChecks.js";
export {
  borderDeadlineMismatch,
  eveDeadlineMismatch,
  finalDeadlineMismatch,
  isFinalStage,
  raceNumberOf,
} from "../lib/sns/setsuDeadlines.js";
export { mp4Info } from "../lib/sns/mp4Info.js";
export {
  DEFAULT_SEND_TIME,
  EARLIEST_BEFORE_SEND_MIN,
  EXPIRES_AFTER_SEND_MIN,
  LATEST_BEFORE_EXPIRES_MIN,
  QUOTA_GENERAL_UNITS,
  QUOTA_UPLOAD_UNITS,
  SEND_DELAY_SEC,
  SEND_TIME_EARLIEST,
  SEND_TIME_LATEST,
  checkTiming,
  dryRunClock,
  schedule,
  youtubeRoomReason,
} from "../lib/sns/shortSchedule.js";
export { SETSU_FORMAT, draftRow, setsuStatusOf } from "./pushSetsuKiryokuShortRows.js";
export {
  RETRYABLE_JOB_STATES,
  WAIT_AFTER_EXPIRES_SEC,
  WAIT_POLL_SEC,
  pushSetsuKiryokuShort,
  setsuStatus,
  waitForSend,
} from "./pushSetsuKiryokuShortFlow.js";
export { createRestStore };

/** 結果の1行と exit の番号（純粋関数）。status は待った結果（--no-wait なら null） */
export function resultLine(
  result,
  status = null,
  { waited = Boolean(status) } = {},
) {
  const { outcome, code } = outcomeOf(result, status, waited);
  const line = {
    setsu_id: result.setsu_id ?? null,
    variant: result.variant ?? (status ?? result.status ?? null)?.variant ?? null,
    outcome,
    ...resultFields(
      result,
      status,
      outcome,
      "自動送信の許可（setsu_kiryoku_short_enabled）が off なので送らなかった",
    ),
  };
  return { code, text: `SETSU_RESULT ${JSON.stringify(line)}` };
}

async function main() {
  const args = process.argv.slice(2);
  const usage =
    "使い方: node --env-file=.env.local scripts/sns/push-setsu-kiryoku-short.js <フォルダ> [--dry-run] [--no-wait] | --status <YYYY-MM-DD> [border|main]";
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL・SUPABASE_SERVICE_KEY が無い（.env.local）");
    process.exit(2);
  }
  const store = createRestStore({ url, key });
  if (args[0] === "--status") {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(args[1] ?? "") ||
      ![undefined, "border", "main"].includes(args[2])
    ) {
      console.error(usage);
      process.exit(2);
    }
    console.log(
      JSON.stringify(
        await setsuStatus(args[1], { store, variant: args[2] ?? null }),
        null,
        2,
      ),
    );
    return;
  }
  const dryRun = args.includes("--dry-run");
  const folder = args.find((a) => !a.startsWith("--"));
  if (!folder) {
    console.error(usage);
    process.exit(2);
  }
  const webhook =
    process.env.SLACK_WEBHOOK_URL || process.env.SLACK_DIGEST_WEBHOOK_URL;
  // どこで落ちても、最後の1行は SETSU_RESULT（exit 6）
  const fail = (error) => {
    console.error(error);
    console.log(
      `SETSU_RESULT ${JSON.stringify({ setsu_id: null, outcome: "error", reason: String(error?.message ?? error) })}`,
    );
    process.exit(6);
  };
  const riskRules = await readFile(
    new URL("../../sns-video-studio/remotion/risk-rules.json", import.meta.url),
    "utf8",
  )
    .then((text) => JSON.parse(text).rules)
    .catch(fail);
  const result = await pushSetsuKiryokuShort(folder, {
    store,
    readBytes: async (p) => {
      await stat(p);
      return new Uint8Array(await readFile(p));
    },
    notify: async (text) => {
      console.log(text);
      if (!webhook) return;
      const response = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok)
        throw new Error(`Slack が HTTP ${response.status} を返した`);
    },
    riskRules,
    dryRun,
  }).catch(fail);
  console.log(JSON.stringify(result, null, 2));
  const status =
    // 試運転（youtube の dry_run が true）は送り手が claim しないので待たない（待つと期限＋90秒まで止まる）
    result.job_id && !result.trial && !args.includes("--no-wait")
      ? await waitForSend({
          store,
          draftId: result.draft_id,
          expiresAt: result.when.expires_at,
          sleep: (sec) => new Promise((r) => setTimeout(r, sec * 1000)),
        }).catch(fail)
      : null;
  const { code, text } = resultLine(result, status);
  console.log(text);
  process.exit(code);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
