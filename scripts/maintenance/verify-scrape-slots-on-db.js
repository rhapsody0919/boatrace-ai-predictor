/**
 * verify-scrape-slots-on-db.js - 予定表のRPC（claim_scrape_slots・ensure_scrape_slots）を、実DBで検証する
 * （tasks.md T4a-10。マイグレーション075の本番適用後に実行する）。
 *
 * 検証すること（ジョブ名 pseudo_verify のスロットだけを作り、終了時に削除する。他のジョブ・他のテーブルには書かない）:
 *   1. 二重claimが起きない: 複数の実行が同時に claim しても、同じスロットを2つの実行が取らない
 *      （FOR UPDATE SKIP LOCKED。PGliteでは検証できない並行実行の確認）
 *   2. リースの奪取: リースが切れた running を、別の実行が奪取し、attempts が加算される。
 *      奪われた旧実行の完了の更新は、0行になる（二重完了しない）
 *   3. 期限計算（JST）: 発走の何分前かの期限が、DBの計算でJSTとして扱われている
 *   4. 許容幅を超えた未完了は expired になり、一度も claim されなかったものは attempts=0（未実行）で残る
 *   5. ensure_scrape_slots の冪等（2回呼んでも増えない）
 *
 * 実行（本番DBの scrape_slots に、pseudo_verify のスロットを作って消す。書き込みを伴うため、既定はdry-run）:
 *   node --env-file=.env.local scripts/maintenance/verify-scrape-slots-on-db.js            # 何をするかを表示
 *   node --env-file=.env.local scripts/maintenance/verify-scrape-slots-on-db.js --execute  # 実際に実行
 *   オプション: --date=YYYY-MM-DD（対象日のracesを使う。既定は今日のJST）
 *
 * 時刻は claim_scrape_slots の p_now で固定するため、実行する時刻に依存しない（対象日のracesが登録済みであること）。
 */
import { pathToFileURL } from "node:url";
import { getTodayDateJST } from "../lib/dateUtils.js";

const JOB = "pseudo_verify";
const OFFSET = -60;
// 全レース（朝〜夜）の期限が、検証時刻の時点で許容幅の内側に入るよう、許容幅を1日にする
const GRACE_MIN = 1440;
const WORKERS = 8;
const LIMIT_PER_WORKER = 5;

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {{date: string, log?: (line: string) => void}} options
 * @returns {Promise<{results: Array<{label: string, pass: boolean, detail?: string}>}>}
 */
export async function verifyScrapeSlotsOnDb(client, { date, log = () => {} }) {
  const results = [];
  const check = (label, pass, detail = "") => {
    results.push({ label, pass, detail });
    log(`${pass ? "OK " : "NG "} ${label}${detail ? ` (${detail})` : ""}`);
  };
  const must = (what, { data, error }) => {
    if (error) throw new Error(`${what}に失敗しました: ${error.message}`);
    return data;
  };
  const claim = (worker, now, limit = LIMIT_PER_WORKER) =>
    client.rpc("claim_scrape_slots", {
      p_job: JOB,
      p_limit: limit,
      p_lease_sec: 60,
      p_worker: worker,
      p_grace_min: GRACE_MIN,
      p_run_mode: "shadow",
      p_now: now.toISOString(),
    });
  const defs = [{ job: JOB, offset_min: OFFSET, grace_min: GRACE_MIN }];
  const ensure = (now) =>
    client.rpc("ensure_scrape_slots", {
      p_date: date,
      p_defs: defs,
      p_skip_lapsed: false,
      p_now: now.toISOString(),
    });

  try {
    const races = must(
      "racesの取得",
      await client
        .from("races")
        .select("race_id, start_time, cancellation_status")
        .eq("race_date", date)
        .not("start_time", "is", null)
        .order("race_id"),
    );
    // 同時claimで WORKERS×LIMIT 件を取り、残り（1件以上）が「一度も claim されなかったスロット」になる
    if (races.length <= WORKERS * LIMIT_PER_WORKER) {
      throw new Error(
        `${date} のracesが${races.length}件しかありません（${WORKERS * LIMIT_PER_WORKER + 1}件以上必要。別の日を --date で指定してください）`,
      );
    }
    // 全レースが期限を過ぎている時刻: 最後の発走の(60分前)+30分
    const lastStart = races
      .map((r) => r.start_time)
      .sort()
      .at(-1);
    const dueAt = new Date(`${date}T${lastStart.slice(0, 5)}:00+09:00`);
    dueAt.setMinutes(dueAt.getMinutes() + OFFSET + 30);
    log(
      `対象: ${date}、レース${races.length}件、検証時刻（固定）= ${dueAt.toISOString()}`,
    );

    // 5. ensure の冪等
    const created = must("予定表の生成", await ensure(dueAt));
    const createdAgain = must("予定表の再生成", await ensure(dueAt));
    check(
      "ensure_scrape_slots: 全レース分を作成し、再実行は0件（冪等）",
      created === races.length && createdAgain === 0,
      `作成${created}件、再実行${createdAgain}件`,
    );

    // 3. 期限計算（JST）: 最初のレースを、期限の1秒前と期限ちょうどで claim する
    // 確定中止のレースは、claim が終端する（取れない）ため、期限計算の検証には使わない
    const first = races.find((r) => r.cancellation_status !== "confirmed");
    if (!first) throw new Error(`${date} に、確定中止でないレースがありません`);
    const firstDeadline = new Date(
      `${date}T${first.start_time.slice(0, 8)}+09:00`,
    );
    firstDeadline.setMinutes(firstDeadline.getMinutes() + OFFSET);
    const before = must(
      "期限前のclaim",
      await claim("w-before", new Date(firstDeadline.getTime() - 1000), 1000),
    );
    check(
      "期限計算: 期限の1秒前には、その最初のレースを取れない",
      !before.some((s) => s.race_id === first.race_id),
      `期限=${firstDeadline.toISOString()}`,
    );
    const atDeadline = must("期限ちょうどのclaim", await claim("w-exact", firstDeadline, 1000));
    check(
      "期限計算: 期限ちょうどには、そのレースを取れる（期限＝発走時刻をJSTとして扱い、−60分）",
      atDeadline.some((s) => s.race_id === first.race_id),
    );
    // 上の2回の claim で状態が変わっているため、全て消して作り直す
    must("後片付け", await client.from("scrape_slots").delete().eq("job", JOB));
    must("予定表の再生成", await ensure(dueAt));

    // 1. 二重claim: 同時に WORKERS 本が claim
    const claimed = await Promise.all(
      Array.from({ length: WORKERS }, (_, i) => claim(`w${i}`, dueAt)),
    );
    const rowsByWorker = claimed.map((c, i) => ({
      worker: `w${i}`,
      rows: must(`claim(w${i})`, c),
    }));
    const all = rowsByWorker.flatMap((w) => w.rows.map((r) => r.race_id));
    const dup = all.filter((id, i) => all.indexOf(id) !== i);
    check(
      `二重claimなし: ${WORKERS}本の同時claimで、同じスロットを2つの実行が取っていない`,
      // 件数は、確定中止のレース・同時実行時の行の再評価で、想定（WORKERS×LIMIT）より少なくなりうるため、
      // 一致は要求しない（重複が0件で、複数の実行が取れていること）
      dup.length === 0 &&
        all.length > 0 &&
        rowsByWorker.filter((w) => w.rows.length > 0).length >= 2,
      `取得${all.length}件（想定${WORKERS * LIMIT_PER_WORKER}件）、重複${dup.length}件、取れた実行${rowsByWorker.filter((w) => w.rows.length > 0).length}本`,
    );
    check(
      "claim した行は running・attempts=1・run_mode=shadow",
      rowsByWorker.every((w) =>
        w.rows.every(
          (r) =>
            r.status === "running" &&
            r.attempts === 1 &&
            r.run_mode === "shadow" &&
            r.claimed_by === w.worker,
        ),
      ),
    );

    // 2. リースの奪取（リース60秒。61秒後に別workerが取る）
    const stolenAt = new Date(dueAt.getTime() + 61_000);
    const stolen = must(
      "リース切れのclaim",
      // 最初の同時claimで取られた WORKERS×LIMIT 件（期限の早い順）が、奪取の対象
      await claim("w-thief", stolenAt, WORKERS * LIMIT_PER_WORKER),
    );
    const victim = rowsByWorker[0].rows[0];
    const takeover = stolen.find((s) => s.race_id === victim.race_id);
    check(
      "リースの奪取: 切れた running を別workerが取り、attempts が2になる",
      takeover && takeover.attempts === 2 && takeover.claimed_by === "w-thief",
      takeover ? `attempts=${takeover.attempts}` : "奪取されていない",
    );
    const staleComplete = await client
      .from("scrape_slots")
      .update({
        status: "done",
        done_at: stolenAt.toISOString(),
        outcome: "ok",
      })
      .eq("job", JOB)
      .eq("race_id", victim.race_id)
      .eq("offset_min", OFFSET)
      .eq("claimed_by", "w0")
      .eq("status", "running")
      .select("race_id");
    check(
      "奪われた旧実行の完了の更新は0行（二重完了しない）",
      !staleComplete.error && staleComplete.data.length === 0,
      staleComplete.error?.message ?? "",
    );

    // 4. 許容幅を超えると expired。一度も claim されなかったものは attempts=0
    const expiredAt = new Date(dueAt.getTime() + (GRACE_MIN + 60) * 60_000);
    await claim("w-expire", expiredAt, 1);
    const rows = must(
      "expired の確認",
      await client
        .from("scrape_slots")
        .select("status, attempts")
        .eq("job", JOB),
    );
    const expired = rows.filter((r) => r.status === "expired");
    check(
      "許容幅を超えた未完了は expired になり、一度も claim されなかったものは attempts=0（未実行）",
      expired.length > 0 &&
        expired.some((r) => r.attempts === 0) &&
        expired.some((r) => r.attempts >= 1),
      `expired ${expired.length}件（attempts=0: ${expired.filter((r) => r.attempts === 0).length}件）`,
    );
  } finally {
    const del = await client.from("scrape_slots").delete().eq("job", JOB);
    log(
      del.error
        ? `後片付けに失敗: ${del.error.message}`
        : `後片付け: job=${JOB} のスロットを削除しました`,
    );
  }
  return { results };
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const date =
    args.find((a) => a.startsWith("--date="))?.split("=")[1] ??
    getTodayDateJST();
  if (!execute) {
    console.log(
      `dry-run: 実DBの scrape_slots に、job=${JOB} のスロット（${date} のレース分）を作り、同時claim・リース奪取・expiredを検証して、終了時に削除します。\n実行するには --execute を付けてください（マイグレーション075の適用後）。`,
    );
    return;
  }
  const { supabase } = await import("../lib/supabaseClient.js");
  if (!supabase) throw new Error("Supabase が設定されていません");
  const { results } = await verifyScrapeSlotsOnDb(supabase, {
    date,
    log: (line) => console.log(line),
  });
  const failed = results.filter((r) => !r.pass).length;
  console.log(
    failed === 0 ? "\nALL PASS" : `\n${failed} 件の検証が失敗しました`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  });
}
