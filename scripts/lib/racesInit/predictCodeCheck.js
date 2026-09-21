/**
 * 予測ロジックの変更検知による再生成（WS4b T4b-07-5、plan.md §4.2(d)・設計判断(g)）。
 *
 * 従来は、GitHub Actions の morning-init.js が、`git log -1 -- generate-predictions.js` のコミット時刻が
 * 当日の races.updated_at の最大値より新しいとき、その日の全レースの予測を再生成していた（fetch-depth: 0 が必須で、
 * 浅い clone では、常に「変更された」と誤判定して5分ごとに全再生成していた。2026-09-06）。
 * Vercel には git が無いため、予測ロジックのソースの内容ハッシュに置き換える。
 *
 *   ハッシュ  予測ロジックを定義するファイル（PREDICT_LOGIC_FILES）の内容の SHA-1（先頭16桁）。デプロイされた
 *             ソースそのものを読む（import されたファイルは、関数のバンドルに含まれる）。読めなければ null
 *             （検知を行わず、警告を出す。誤って再生成を繰り返すより安全な側に倒す）
 *   保存先    scrape_job_state の job='predict-code-hash' の行の last_report（{hash, previous, at}）。
 *             取得ジョブではない疑似の行（host:… のブレーカーの行と同じ扱い。監視は、レジストリに無い行を読み飛ばす）
 *   比較      api/cron/races-init.js の onTick（live のときだけ、起動のたびに）。ハッシュが同じなら、DBへの問い合わせは
 *             1回（ハッシュの行の読み取り）のみ
 *   再生成    ハッシュが変わっていたら、まず、保存済みのハッシュを新しい値に更新する（`last_report->>hash` が
 *             古い値のときだけ更新する条件付き更新＝先に更新できた1つの起動だけが再生成する。重なった起動での二重の
 *             再生成を避ける）。次に、当日の、まだ発走していないレースを mainRefresh（forceTouchRaces）で再生成する。
 *             発走済みのレースは、的中フラグ・払戻を保つため対象外（従来の GitHub Actions 版は、全レースを再生成して
 *             フラグをリセットしていた）。失敗したら、保存済みのハッシュを元に戻して例外を投げる（次の起動が再試行する）
 *   初回      行が無ければ、現在のハッシュを保存するのみ（再生成しない）
 *
 * 範囲: 従来と同じく、mainRefresh が書く standard・safeBet・upsetFocus と races の volatility のみ。unified
 * （generate-unified-predictions.js）は対象外（従来もそうだった）。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { toJstDateString } from "../scrapeJobs/time.js";
import { truncateError } from "../scrapeJobs/outcomes.js";

/** ハッシュの保存先の行（scrape_job_state.job） */
export const PREDICT_CODE_HASH_JOB = "predict-code-hash";

/** 予測ロジックを定義するファイル（この modules の相対パス）。generate-predictions.js が import する計算ロジック */
export const PREDICT_LOGIC_FILES = Object.freeze([
  "../../daily/generate-predictions.js",
  "../turnPrediction.js",
  "../venueParameters.js",
  "../winningTechniques.js",
]);

/**
 * ファイルの内容から、ハッシュを作る（純粋関数。ファイルの並び・名前も、ハッシュに含める）。
 * @param {Array<{name: string, content: string}>} files
 */
export function hashFiles(files) {
  const h = createHash("sha1");
  for (const { name, content } of files) {
    h.update(`${name}\n${content}\n`);
  }
  return h.digest("hex").slice(0, 16);
}

/**
 * デプロイされた予測ロジックのハッシュ。読めなければ null（例外は投げない）。
 * @param {Object} [options]
 * @param {(url: URL) => string} [options.readFile] テスト用の差し替え
 * @param {readonly string[]} [options.files]
 */
export function computePredictCodeHash({
  readFile = (url) => fs.readFileSync(url, "utf8"),
  files = PREDICT_LOGIC_FILES,
} = {}) {
  try {
    return hashFiles(
      files.map((rel) => {
        const url = new URL(rel, import.meta.url);
        return {
          name: fileURLToPath(url).split("/scripts/")[1] ?? rel,
          content: readFile(url),
        };
      }),
    );
  } catch (error) {
    console.warn(
      `⚠️ 予測ロジックのハッシュを計算できません（変更検知をスキップ）: ${error.message}`,
    );
    return null;
  }
}

/**
 * ハッシュを確認し、変わっていれば当日の発走前のレースを再生成する。
 *
 * @param {Object} params
 * @param {import("@supabase/supabase-js").SupabaseClient} params.client
 * @param {() => Date} params.now
 * @param {string|null} [params.hash] 現在のハッシュ（既定は computePredictCodeHash()）
 * @param {(args: Object) => Promise<unknown>} params.refresh mainRefresh 相当（遅延 import のため、呼び出し側が渡す）
 * @param {(date: string, opts: Object) => Promise<Array<{race_id: string, start_time: Date}>>} params.getSchedule getRaceSchedule 相当
 * @returns {Promise<{status: "hash_unavailable"|"baseline"|"unchanged"|"claimed_elsewhere"|"regenerated", races?: number, hash?: string}>}
 */
export async function checkPredictCodeChange({
  client,
  now,
  hash = computePredictCodeHash(),
  refresh,
  getSchedule,
}) {
  if (!hash) return { status: "hash_unavailable" };

  const { data: row, error } = await client
    .from("scrape_job_state")
    .select("last_report")
    .eq("job", PREDICT_CODE_HASH_JOB)
    .maybeSingle();
  if (error) {
    throw new Error(`予測ロジックのハッシュの読み取りに失敗: ${error.message}`);
  }

  const at = now().toISOString();
  if (!row) {
    // 初回: 基準を保存するのみ（ignoreDuplicates: 他の起動が先に作っていれば、何もしない）
    const { error: insertError } = await client.from("scrape_job_state").upsert(
      {
        job: PREDICT_CODE_HASH_JOB,
        last_report: { hash, at },
        updated_at: at,
      },
      { onConflict: "job", ignoreDuplicates: true },
    );
    if (insertError) {
      throw new Error(
        `予測ロジックのハッシュの保存に失敗: ${insertError.message}`,
      );
    }
    return { status: "baseline", hash };
  }

  const stored = row.last_report?.hash ?? null;
  if (stored === hash) return { status: "unchanged", hash };

  // 変わっていた: 先に、保存済みのハッシュを更新した1つの起動だけが、再生成する（条件付き更新）
  const claim = client
    .from("scrape_job_state")
    .update({
      last_report: { hash, previous: stored, at },
      updated_at: at,
    })
    .eq("job", PREDICT_CODE_HASH_JOB);
  const { data: claimed, error: claimError } = await (
    stored === null
      ? claim.is("last_report->>hash", null)
      : claim.eq("last_report->>hash", stored)
  ).select("job");
  if (claimError) {
    throw new Error(
      `予測ロジックのハッシュの更新に失敗: ${claimError.message}`,
    );
  }
  if ((claimed?.length ?? 0) === 0) return { status: "claimed_elsewhere" };

  const restore = async (reason) => {
    // 元のハッシュに戻して、次の起動が再試行できるようにする（戻せなくても、元の例外を優先する）
    const { error: restoreError } = await client
      .from("scrape_job_state")
      .update({
        last_report: {
          hash: stored,
          at,
          failedRegeneration: truncateError(reason),
        },
        updated_at: now().toISOString(),
      })
      .eq("job", PREDICT_CODE_HASH_JOB)
      .eq("last_report->>hash", hash);
    if (restoreError) {
      console.error(
        `❌ 予測ロジックのハッシュを元に戻せませんでした: ${restoreError.message}`,
      );
    }
  };

  try {
    const date = toJstDateString(now());
    const schedule = await getSchedule(date, { client, throwOnError: true });
    // 発走済みのレースは、的中フラグ・払戻を保つため再生成しない
    const raceIds = schedule
      .filter((r) => r.start_time.getTime() > now().getTime())
      .map((r) => r.race_id);
    if (raceIds.length === 0) {
      return { status: "regenerated", races: 0, hash };
    }
    console.log(
      `🔄 予測ロジックが変更されました（${stored ?? "なし"} → ${hash}）。発走前の${raceIds.length}レースを再生成します`,
    );
    await refresh({
      isDryRun: false,
      specificRaceIds: raceIds,
      // races.updated_at を進める（従来の再生成経路と同じ）。書き込みは upsert（unified を削除しない）
      forceTouchRaces: true,
      date,
      writeMode: "upsert",
      client,
      now,
    });
    return { status: "regenerated", races: raceIds.length, hash };
  } catch (error) {
    await restore(error);
    throw error;
  }
}
