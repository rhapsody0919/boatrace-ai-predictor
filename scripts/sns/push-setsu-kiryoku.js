/**
 * X の「節の機力」（画像1枚＋本文、kind=setsu_kiryoku、毎日 21:30、BOA-1209、マイグレーション 193）のフォルダを受け取り、
 * X の下書きと自動送信の item を作って 21:30 の予定に入れる。中身は push-research-image.js の型ごとの受け取り（SETSU_TYPE）。
 * hq の作り手（platform/setsu_sheet.py、send=true のときだけ呼ぶ）が同じ Mac の本リポジトリで実行する。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/sns/push-setsu-kiryoku.js <フォルダ> [--dry-run] [--no-wait]
 *   node --env-file=.env.local scripts/sns/push-setsu-kiryoku.js --status <YYYY-MM-DD>
 *
 * フォルダ: bundle.json と PNG 1枚（1080×1350、5MB 以内）
 *   {format:"setsu_kiryoku_image", kind:"setsu_kiryoku", date, slug, meet_id, neta, x_text（タグ・リンクなし）, hashtags:["#ボートレース"],
 *    images:["<slug>.png"], send_time:"21:30", source_observed_at（ISO か「YYYY-MM-DD NR まで」）, racers:[{name, class}]}
 * 検査は数字で見たらと同じ（禁止表現・#競艇 のタグだけ可・本文＋改行2つ＋タグで X の加重280・リンクなし・画像1枚・1日1本・
 *   送る時刻から60分）に、選手の名前と級（A1・A2・B1・B2）を足す。送る時刻は 21:30 だけ。
 * 自動送信の許可は sns_auto_send_control の x の行の setsu_kiryoku_enabled（193、既定 off）。off の間は何も書かない（exit 3）
 * stdout の最後の1行は `SETSU_RESULT {...}`（setsu_id・outcome・job_id・job_state・tweet_id・tweet_url・posted_at・error_code・reason）。
 * exit は push-research-image.js と同じ
 */
import { pathToFileURL } from "node:url";
import { main, SETSU_TYPE } from "./push-research-image.js";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  await main(SETSU_TYPE, "push-setsu-kiryoku.js");
