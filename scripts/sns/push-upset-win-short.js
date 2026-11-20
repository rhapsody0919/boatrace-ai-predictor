/**
 * YouTube Shorts【人気薄の1着】（format・kind = upset_win_short、BOA-1284、マイグレーション 200）のフォルダを受け取り、
 * YouTube の下書き（動画1本）と自動送信の item を作って、送る時刻の予定に入れる。形は節の機力の Shorts（push-setsu-kiryoku-short.js、193）と同じで、
 * 動画・時刻・日の上限とクォータの検査と、送り終わるまで待つ所はその口の関数を使う。違うのは、型の検査（upsetWin/model.js）・
 * そのレースの値の DB での読み直し・説明欄のリンク（龍神ソナーのレースの頁）・race_id・許可の列。
 * hq の機械が同じ Mac の本リポジトリで、毎朝 7:00 ごろに作り手（sns-video-studio/remotion/scripts/upset-win/daily.mjs）の後に実行する。
 * 鍵は本リポジトリの .env.local（SUPABASE_URL・SUPABASE_SERVICE_KEY）だけを使う。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/sns/push-upset-win-short.js <フォルダ> [--dry-run] [--no-wait]
 *   node --env-file=.env.local scripts/sns/push-upset-win-short.js --status <YYYY-MM-DD>   その日の状態・動画の URL を出す
 *
 * フォルダ（作り手の出力）: bundle.json と upset_win.mp4（縦・60秒まで・32 MiB まで）。ほかのファイルは読まない
 *   題・説明欄は bundle の youtube.title・youtube.description をそのまま送る（書き換えない。型の検査が値から作り直した文と照らす）
 *
 * 検査（どれかが通らなければ何も書かない）:
 *   1. 型の検査（upsetWin/model.js の checkBundle）をもう一度通す: 選び（単勝10倍以上・弱さ・3コマ目の項目）・直近1年の日ごとの和・
 *      画面の文・声・題・説明欄が値から作った文と同じか・画面の数・禁止語・配当の円・尺（25〜35秒）
 *   2. DB の読み直し: そのレースの6艇の名前・級・勝率・展示タイム・展示 ST・モーター2連率・単勝、1着・決まり手が bundle と同じで、
 *      中止・不成立・欠場が無い（画面の数字と DB の照合。違えば送らない）
 *   3. この口の検査: 題は100字まで・改行と < > なし、説明欄は5000バイトまで・< > なし、説明欄のリンクはちょうど1つでそのレースの
 *      龍神ソナーの頁（https://www.boat-ai.jp/race/{race_id}?tab=sonar、ほかのクエリは utm_* だけ）、送る時刻は 07:00〜07:50、動画は MP4・縦・60秒まで
 *   4. 時刻: date は今日（JST）、受け取りは送る時刻の15分前から、期限の10分前より前、集計の時刻は今より前で期限まで鮮度の線の内
 *   5. 二重送信: 同じ日の upset_win_short が生きているか送ってあれば作らない（exit 4、200 の一意の索引でも止まる）。
 *      前の束が送らずに終わっていれば（held・failed・cancelled・承認の途中で落ちた）作り直す
 *   6. YouTube の日の上限（daily_limit_youtube）とクォータ（1 upload・104 units）: 節の機力と同じ数え方（youtubeRoomReason）
 *
 * 時刻（送る時刻 S＝date の send_time と「今＋2分」の遅い方）: 期限＝S＋60分、締切＝期限＋sns_x_send_control.expiry_minutes（節の機力と同じ）
 * 自動送信の許可（sns_auto_send_control の youtube の行の upset_win_short_enabled、200）は既定 off。
 * off の間は --dry-run と同じ（検査だけして DB・Storage・Slack に書かない、exit 3）。送り手も off の job を送らない
 * --dry-run は DB を読むだけ。date が今日でない束（見本の束）は、その日の送る時刻の2分前に受け取ったとして時刻の検査をする
 *
 * stdout の最後の1行は `UPSET_RESULT {...}`（upset_id・outcome・job_id・job_state・video_id・video_url・posted_at・error_code・reason）
 * exit: 0 送った（--dry-run は検査が通った・--no-wait は予定に入れた）・1 検査で拒否・2 使い方・鍵の不足・3 許可が off なので書かなかった
 *   ・4 同じ日の upset_win_short が既にある（何もしない）・5 予定に入れたが送れなかった・6 想定外の失敗
 */
import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { UPSET_WIN_SHORT_KIND } from "../../api/_lib/snsUpsetWinShort.js";
import { shapeRace } from "../../sns-video-studio/remotion/src/upsetWin/model.js";
import { fetchRaceRows } from "../../sns-video-studio/remotion/scripts/upset-win/materials.mjs";
import { createRestStore as createSetsuStore } from "./pushSetsuKiryokuShortStore.js";
import { waitForSend } from "./pushSetsuKiryokuShortFlow.js";
import { outcomeOf, resultFields } from "./shortPushCommon.js";
import { pushUpsetWinShort, upsetStatus } from "./pushUpsetWinShortFlow.js";

// 分けたファイルから移した名前は、ここから従来どおり import できるように再 export する
export {
  BOAT_FIELDS,
  DEFAULT_SEND_TIME,
  SEND_TIME_EARLIEST,
  SEND_TIME_LATEST,
  VIDEO_NAME,
  checkUpsetBundle,
  descriptionLink,
  dryRunClock,
  raceReasons,
} from "./pushUpsetWinShortChecks.js";
export { UPSET_FORMAT, draftRow, upsetStatusOf } from "./pushUpsetWinShortRows.js";
/** 作り直してよい job の状態（節の機力の口と同じ） */
export { RETRYABLE_JOB_STATES } from "./pushSetsuKiryokuShortFlow.js";
export { ORPHAN_ITEM_MIN, pushUpsetWinShort, upsetStatus } from "./pushUpsetWinShortFlow.js";

/** 結果の1行と exit の番号（純粋関数） */
export function resultLine(result, status = null) {
  const { outcome, code } = outcomeOf(result, status, Boolean(status));
  const line = {
    upset_id: result.upset_id ?? null,
    outcome,
    ...resultFields(
      result,
      status,
      outcome,
      "自動送信の許可（upset_win_short_enabled）が off なので送らなかった",
    ),
  };
  return { code, text: `UPSET_RESULT ${JSON.stringify(line)}` };
}

/**
 * PostgREST・Storage の読み書き（service_role）。共通の読み書きは節の機力の Shorts の store（その中は全貌の store）を使い、
 * この型の item・許可の列・レースの読み直しだけを足す。失敗は投げる
 */
export function createRestStore({ url, key, fetchImpl = fetch }) {
  const base = createSetsuStore({ url, key, fetchImpl });
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  async function call(p) {
    const response = await fetchImpl(`${url}/rest/v1/${p}`, { headers });
    const text = await response.text();
    if (!response.ok)
      throw new Error(
        `DB 操作に失敗: HTTP ${response.status} GET ${p.split("?")[0]} ${text.slice(0, 300)}`,
      );
    return text ? JSON.parse(text) : null;
  }
  return {
    ...base,
    // upset_win_short_enabled が無い（200 が未適用）と PostgREST が 400 を返すので、その時は列なしで読み直して off とする
    async controls() {
      let rows;
      try {
        rows = await call(
          "sns_auto_send_control?select=channel,mode,dry_run,auto_approver_id,upset_win_short_enabled",
        );
      } catch (error) {
        if (
          !/HTTP 400/.test(error.message) ||
          !error.message.includes("upset_win_short_enabled")
        )
          throw error;
        console.error(
          "upset_win_short_enabled の列が無い（マイグレーション 200 が未適用）。許可は off として扱う",
        );
        rows = await call(
          "sns_auto_send_control?select=channel,mode,dry_run,auto_approver_id",
        );
      }
      return Object.fromEntries(rows.map((r) => [r.channel, r]));
    },
    upsetItems: (date) =>
      call(
        `sns_auto_send_items?kind=eq.${UPSET_WIN_SHORT_KIND}&channel=eq.youtube&race_id=like.${encodeURIComponent(`upset:${date}:*`)}&select=id,state,draft_id,race_id,held_reason,created_at&order=created_at.desc`,
      ),
    async raceOf(raceId) {
      const rows = await fetchRaceRows(raceId, {
        get: (table, query) => call(`${table}?${query}`),
      });
      return rows.races[0]
        ? shapeRace({
            race: rows.races[0],
            result: rows.results[0] ?? null,
            entries: rows.entries,
            exhibition: rows.exhibition,
            odds: rows.odds[0] ?? null,
          })
        : null;
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const usage =
    "使い方: node --env-file=.env.local scripts/sns/push-upset-win-short.js <フォルダ> [--dry-run] [--no-wait] | --status <YYYY-MM-DD>";
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL・SUPABASE_SERVICE_KEY が無い（.env.local）");
    process.exit(2);
  }
  const store = createRestStore({ url, key });
  if (args[0] === "--status") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args[1] ?? "")) {
      console.error(usage);
      process.exit(2);
    }
    console.log(JSON.stringify(await upsetStatus(args[1], { store }), null, 2));
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
  const fail = (error) => {
    console.error(error);
    console.log(
      `UPSET_RESULT ${JSON.stringify({ upset_id: null, outcome: "error", reason: String(error?.message ?? error) })}`,
    );
    process.exit(6);
  };
  const riskRules = await readFile(
    new URL("../../sns-video-studio/remotion/risk-rules.json", import.meta.url),
    "utf8",
  )
    .then((text) => JSON.parse(text).rules)
    .catch(fail);
  const result = await pushUpsetWinShort(folder, {
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
