/**
 * store.js（createSupabaseStore）から移したサーキットブレーカーの保存（createBreakerMethods。振る舞いは元のまま）。
 * ブレーカー関連の定数も移した（store.js が再 export する）。
 */
import { isScrapeSchemaMissingError } from "./schemaErrors.js";
import { truncateError } from "./outcomes.js";
import { isColumnMissingError } from "../optionalColumns.js";
import { wrap } from "./storeParts.js";

const STATE = "scrape_job_state";

/** scrape_breaker_open（マイグレーション184）が無いと分かった後、もう一度 RPC を試すまでの間隔 */
export const BREAKER_RPC_RECHECK_MS = 10 * 60 * 1000;

/** fetch_stop の列が無い（マイグレーション178 の前）と分かった後、もう一度列を入れて読み直すまでの間隔 */
export const FETCH_STOP_RECHECK_MS = 10 * 60 * 1000;

/** マイグレーション178 で足した host:… の行の列（非常停止・段階）。どれかが無いエラーなら、178 の前として読み直す */
const BREAKER_178_COLUMNS = [
  "fetch_stop",
  "breaker_level",
  "breaker_opened_at",
  "breaker_closed_at",
];

/** ブレーカーの読み取り（breakerStore.read。fetch_stop の列の不在を覚える） */
function createBreakerReadMethods(client) {
  /** fetch_stop の列が無い（178 の前）と分かった後、列を入れずに読む期限（epoch ms） */
  let fetchStopMissingUntil = 0;

  return {
    // breaker_open_until と、非常停止（fetch_stop）・段階（breaker_level・breaker_opened_at）（どちらもマイグレーション178）を
    // 同じ SELECT で読む。178 の前（列が無い）は breaker_open_until だけを読み直し、非常停止なし・段階0とする
    // （列の不在は 42703 かつ列名つきのときだけ。他のエラーは投げる）
    async read(hostKey) {
      const select = (columns) =>
        client.from(STATE).select(columns).eq("job", hostKey).maybeSingle();
      let data;
      let error;
      if (Date.now() >= fetchStopMissingUntil) {
        ({ data, error } = await select(
          "breaker_open_until, fetch_stop, breaker_level, breaker_opened_at, breaker_closed_at",
        ));
        if (error && isColumnMissingError(error, BREAKER_178_COLUMNS)) {
          // 178 の前: しばらく（FETCH_STOP_RECHECK_MS）は列を入れずに読む（キーごと・10秒ごとの2往復を避ける）
          fetchStopMissingUntil = Date.now() + FETCH_STOP_RECHECK_MS;
          ({ data, error } = await select("breaker_open_until"));
        }
      } else {
        ({ data, error } = await select("breaker_open_until"));
      }
      if (error) throw wrap(`ブレーカーの読み取り(${hostKey})`, error);
      const until = data?.breaker_open_until;
      const openedAt = data?.breaker_opened_at;
      const closedAt = data?.breaker_closed_at;
      return {
        untilMs: until ? new Date(until).getTime() : 0,
        fetchStop: data?.fetch_stop === true,
        level: typeof data?.breaker_level === "number" ? data.breaker_level : 0,
        openedAtMs: openedAt ? new Date(openedAt).getTime() : 0,
        closedAtMs: closedAt ? new Date(closedAt).getTime() : 0,
        untilRaw: typeof until === "string" ? until : null,
      };
    },
  };
}

/** ブレーカーの半開の予約・開放（breakerStore.reserveProbe・open。scrape_breaker_open の不在を覚える） */
function createBreakerOpenMethods(client) {
  /** scrape_breaker_open（184）が無いと分かった後、upsert で書く期限（epoch ms） */
  let breakerRpcMissingUntil = 0;

  return {
    // 半開の試行の予約（BOA-1145 P4a ④c）: breaker_open_until が読んだ値（expectedRaw。DB が返した文字列のまま）の行だけを
    // newUntilMs に進める。1行変わったら予約できた（このプロセスだけが試す）。0行なら別の起動が先に予約・開き直した
    async reserveProbe(hostKey, expectedRaw, newUntilMs) {
      const { data, error } = await client
        .from(STATE)
        .update({
          breaker_open_until: new Date(newUntilMs).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("job", hostKey)
        .eq("breaker_open_until", expectedRaw)
        .select("job");
      if (error) throw wrap(`半開の試行の予約(${hostKey})`, error);
      return (data?.length ?? 0) === 1;
    },
    // level（403 のとき）を渡すと段階と開いた時刻も書く。fetch_stop・mode は書かない（人が立てた値・既定の off に触れない）。
    // 178 の前（段階の列が無い: PGRST204、列名つき）は段階を外して書き直す
    async open(hostKey, untilMs, reason, level) {
      // 長い方を DB の中で取る RPC（184、BOA-1159）。無い（184 の前）ときだけ下の upsert に戻る（しばらく RPC を試さない）。
      // 戻り値 {untilMs, untilRaw?, level?, openedAtMs?}: 書いた後の DB の値（RPC のとき。別の起動の長い期限が勝ったら、その側の値）
      if (Date.now() >= breakerRpcMissingUntil) {
        const { data, error } = await client.rpc("scrape_breaker_open", {
          p_job: hostKey,
          p_until: new Date(untilMs).toISOString(),
          p_reason: truncateError(reason),
          p_level: level ? level.level : null,
          p_opened_at: level ? new Date(level.openedAtMs).toISOString() : null,
        });
        if (!error) {
          // 1行（書いた後の期限・段階・開いた時刻）。期限の文字列は DB が返したまま残す（条件つき UPDATE の条件に使う。審査 P3-2）
          const r = Array.isArray(data) ? data[0] : data;
          const raw = r?.breaker_open_until ?? null;
          return {
            untilMs: raw ? new Date(raw).getTime() : untilMs,
            untilRaw: raw,
            level:
              typeof r?.breaker_level === "number"
                ? r.breaker_level
                : undefined,
            openedAtMs: r?.breaker_opened_at
              ? new Date(r.breaker_opened_at).getTime()
              : undefined,
          };
        }
        if (!isScrapeSchemaMissingError(error, ["scrape_breaker_open"])) {
          throw wrap(`ブレーカーの開放(${hostKey})`, error);
        }
        breakerRpcMissingUntil = Date.now() + BREAKER_RPC_RECHECK_MS;
      }
      const row = {
        job: hostKey,
        breaker_open_until: new Date(untilMs).toISOString(),
        last_error: truncateError(reason),
        updated_at: new Date().toISOString(),
      };
      const upsert = (payload) =>
        client.from(STATE).upsert(payload, { onConflict: "job" });
      let { error } = await upsert(
        level
          ? {
              ...row,
              breaker_level: level.level,
              breaker_opened_at: new Date(level.openedAtMs).toISOString(),
            }
          : row,
      );
      if (
        error &&
        level &&
        isColumnMissingError(error, ["breaker_level", "breaker_opened_at"])
      ) {
        ({ error } = await upsert(row));
      }
      if (error) throw wrap(`ブレーカーの開放(${hostKey})`, error);
      return { untilMs };
    },
  };
}

/** ブレーカーの解除（breakerStore.close） */
function createBreakerCloseMethods(client) {
  return {
    // closed を渡すと閉じた時刻（breaker_closed_at、178）も書く。178 の前（PGRST204、列名つき）は外して書き直す。
    // closed.expectedRaw を渡すと、breaker_open_until がその値のままの行だけを閉じる（別の起動の開き直しを消さない。④c）。
    // 戻り値: 閉じたら true、条件に合わず閉じなかったら false（expectedRaw が無いときは常に true）
    async close(hostKey, closed) {
      const patch = {
        breaker_open_until: null,
        updated_at: new Date().toISOString(),
      };
      const expectedRaw = closed?.expectedRaw ?? null;
      const update = async (p) => {
        let q = client.from(STATE).update(p).eq("job", hostKey);
        if (expectedRaw) q = q.eq("breaker_open_until", expectedRaw);
        return expectedRaw ? q.select("job") : q;
      };
      let { data, error } = await update(
        closed
          ? {
              ...patch,
              breaker_closed_at: new Date(closed.closedAtMs).toISOString(),
            }
          : patch,
      );
      if (
        error &&
        closed &&
        isColumnMissingError(error, ["breaker_closed_at"])
      ) {
        ({ data, error } = await update(patch));
      }
      if (error) throw wrap(`ブレーカーの解除(${hostKey})`, error);
      return expectedRaw ? (data?.length ?? 0) === 1 : true;
    },
  };
}

/**
 * サーキットブレーカーの保存（breakerStore）
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 */
export function createBreakerMethods(client) {
  return {
    /** @type {import("./circuitBreaker.js").BreakerStore} */
    breakerStore: {
      ...createBreakerReadMethods(client),
      ...createBreakerOpenMethods(client),
      ...createBreakerCloseMethods(client),
    },
  };
}
