// circuitBreaker.js から移した部品: 段階・期間の純関数、ホストごとの状態、DB の読み取り（refresh）と過負荷の開放（openOverloaded）。
// 状態（hosts の Map）・store・now・設定は、createCircuitBreaker が作る env（{store, now, hosts, cfg}）で受け取る。

/** 段階の上限（DB の CHECK、マイグレーション178 と同じ） */
export const MAX_BREAKER_LEVEL = 10;

const finiteOr0 = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * store.read の戻り値を {untilMs, fetchStop, level, openedAtMs} にそろえる（数だけを返す旧い形・テストのストアも受ける）
 * @param {unknown} value
 * @returns {{untilMs: number, fetchStop: boolean, level: number, openedAtMs: number} | null} 解釈できなければ null（直前の値のまま）
 */
export function normalizeBreakerRead(value) {
  if (typeof value === "number")
    return {
      untilMs: value,
      fetchStop: false,
      level: 0,
      openedAtMs: 0,
      closedAtMs: 0,
      untilRaw: null,
    };
  if (value && typeof value === "object" && typeof value.untilMs === "number") {
    const level = finiteOr0(value.level);
    return {
      untilMs: value.untilMs,
      fetchStop: value.fetchStop === true,
      level: Math.min(MAX_BREAKER_LEVEL, Math.max(0, Math.trunc(level))),
      openedAtMs: finiteOr0(value.openedAtMs),
      closedAtMs: finiteOr0(value.closedAtMs),
      // DB の breaker_open_until の文字列そのまま（半開の試行を DB で予約するときの条件。ms に丸めると一致しない）
      // 文字列・null（行が無い・閉じている）はそのまま。返さないストア（テストの旧い形）は undefined
      untilRaw:
        typeof value.untilRaw === "string" || value.untilRaw === null
          ? value.untilRaw
          : undefined,
    };
  }
  return null;
}

/**
 * 今の段階（純関数）。最後に開いてから stepDownMs ごとに1段下げる（24時間 403 が無ければ1段下げる。spec §5.2）。
 * 開いた時刻が無い（0）のに段階がある行は、下げる起点が分からないので段階のまま
 */
export function effectiveBlockLevel(level, openedAtMs, nowMs, stepDownMs) {
  if (!(level > 0)) return 0;
  if (!(openedAtMs > 0)) return level;
  const steps = Math.floor(Math.max(0, nowMs - openedAtMs) / stepDownMs);
  return Math.max(0, level - steps);
}

/** 段階 level（1以上）で開く期間（純関数）: openMs × 2^(level−1)、上限 maxOpenMs */
export function blockDurationMs(level, openMs, maxOpenMs) {
  return Math.min(maxOpenMs, openMs * 2 ** (Math.max(1, level) - 1));
}

// ホスト全体のキー（host:boatrace.jp）か、ページのパスのキー（host:boatrace.jp/owpc/pc/race/…）かで、開く期間の基準を変える
export const blockBaseOf = (cfg, key) =>
  String(key).includes("/") ? cfg.blockOpenMs : cfg.hostBlockOpenMs;
export const blockDurationOf = (cfg, key, level) =>
  blockDurationMs(level, blockBaseOf(cfg, key), cfg.blockMaxOpenMs);
// 期間が上限に届く段階より上へは上げない（上げても期間は同じで、下げに余計な日数がかかるだけ。審査 P3）
export const levelCapOf = (cfg, key) =>
  Math.min(
    MAX_BREAKER_LEVEL,
    Math.max(1, Math.ceil(Math.log2(cfg.blockMaxOpenMs / blockBaseOf(cfg, key))) + 1),
  );

/** ホストごとの状態（初めて見たキーのとき作る） */
export const stateOf = ({ hosts }, hostKey) => {
  let s = hosts.get(hostKey);
  if (!s) {
    s = {
      events: [],
      consecutive: 0,
      openUntil: 0,
      probing: false,
      fetchStop: false,
      // 403 で開いた段階と、最後に開いた時刻（DB の breaker_level・breaker_opened_at と同期する）
      level: 0,
      openedAt: 0,
      closedAt: 0,
      // DB の breaker_open_until の文字列（最後に読んだ・書けた値。半開の試行の予約・閉じる条件）と、その ms
      // （undefined はまだ DB を読んでいない）
      untilRaw: null,
      dbUntilMs: undefined,
      lastRead: -Infinity,
      inflight: null,
    };
    hosts.set(hostKey, s);
  }
  return s;
};

export const safe = async (label, fn) => {
  try {
    return await fn();
  } catch (error) {
    console.warn(
      `⚠️ サーキットブレーカーの${label}に失敗（プロセス内の状態のみで続行）:`,
      error?.message ?? error,
    );
    return undefined;
  }
};

// store.open の戻り値（184 の RPC は書いた後の DB の期限 {untilMs}。別の起動の長い期限が勝ったらその値）から、書けた期限を決める
export const wroteUntil = (s, result) => ({
  untilMs: Math.max(s.openUntil, result?.untilMs ?? 0),
  // 別の起動の長い期限が勝ったら、その側の段階・開いた時刻も採る（審査 P3-1）
  won: (result?.untilMs ?? 0) > s.openUntil,
  untilRaw: result?.untilRaw,
  level: result?.level,
  openedAtMs: result?.openedAtMs,
});

// 書けた DB の期限を覚える（0 は閉じた＝NULL）
export const rememberDb = (s, untilMs) => {
  s.dbUntilMs = untilMs;
  s.untilRaw = untilMs > 0 ? new Date(untilMs).toISOString() : null;
};

export const adoptWritten = (s, wrote) => {
  if (wrote.won) {
    if (typeof wrote.level === "number") s.level = wrote.level;
    if (typeof wrote.openedAtMs === "number") s.openedAt = wrote.openedAtMs;
  }
  s.openUntil = wrote.untilMs;
  rememberDb(s, wrote.untilMs);
  // DB が返した文字列をそのまま条件に使う（ms に丸めると、人が SQL で書いたマイクロ秒つきの値と一致しない。審査 P3-2）
  if (typeof wrote.untilRaw === "string") s.untilRaw = wrote.untilRaw;
};

/** 読んだ DB の値を、ホストの状態へ取り込む（同期） */
function mergeRead(s, read) {
  if (
    read.untilRaw !== undefined &&
    s.dbUntilMs !== undefined &&
    read.untilMs !== s.dbUntilMs
  ) {
    // DB の期限が、最後に読んだ・書けた値から変わった（別の起動が閉じた・予約した・人が早めた）: DB を正とする。
    // 以前は長くなる向きにしか採らず、別の起動が閉じても自分の期限（最長6時間）まで開いたままだった。
    // 変わったかは ms で比べる（DB が返す +00:00 と JS が書く Z で文字列が違う。④c の審査 P3-4）
    s.openUntil = read.untilMs;
  } else if (read.untilMs > s.openUntil) {
    s.openUntil = read.untilMs;
  }
  if (read.untilRaw !== undefined) {
    s.dbUntilMs = read.untilMs;
    s.untilRaw = read.untilRaw;
  }
  s.fetchStop = read.fetchStop;
  // 段階は、より新しく開いた側を採る（別の起動が開き直していれば、その段階から上げる）
  if (read.openedAtMs > s.openedAt) {
    s.level = read.level;
    s.openedAt = read.openedAtMs;
  } else if (read.openedAtMs === s.openedAt && read.level > s.level) {
    s.level = read.level;
  }
  if (read.closedAtMs > s.closedAt) s.closedAt = read.closedAtMs;
}

// 読み取り中の並行の呼び出しは、同じ読み取り（s.inflight）を待つ。lastRead は読み終わってから更新する
// （先に更新すると、読み取りの完了前に来た並行の check が TTL 内として読みを省き、初期値の fetchStop=false で
// 取りに行く。Codex の審査 P1、/api/odds/live の同時の要求）。
// force: TTL を無視して読む（書く前に、別の起動が書いた長い期限を短く上書きしないため）。読み取り中なら、それを待ってから読み直す
export const refresh = async (env, hostKey, s, { force = false } = {}) => {
  const { store, now, cfg } = env;
  if (!store) return;
  if (s.inflight) {
    await s.inflight;
    if (!force) return;
  }
  if (!force && now() - s.lastRead < cfg.readTtlMs) return;
  s.inflight = (async () => {
    try {
      const read = normalizeBreakerRead(
        await safe("状態の読み取り", () => store.read(hostKey)),
      );
      if (!read) return;
      mergeRead(s, read);
    } finally {
      s.lastRead = now();
      s.inflight = null;
    }
  })();
  return s.inflight;
};

// 過負荷（429/503）で開く。書く前に DB を読み直し（別の起動の段階・長い期限を採る）、段階を今の段階＋1（429 の段階の数まで）に
// して durationOf(段階) だけ開く。期限は DB の長い方を残す（403 のホストの60分を縮めない）
// escalate:false は段階を上げない（Retry-After でその時間だけ開くとき）。
// 開いている間（半開の試行でない）に届いた 429 は段階を上げない（同時の要求の 429 が重なって一気に60分にしない。#1983 の審査 P1）
export const openOverloaded = async (
  env,
  hostKey,
  s,
  t,
  reason,
  durationOf,
  { escalate = true } = {},
) => {
  const { store, cfg } = env;
  const wasProbing = s.probing;
  await refresh(env, hostKey, s, { force: true });
  const alreadyOpen = s.openUntil > t && !wasProbing;
  const current = effectiveBlockLevel(s.level, s.openedAt, t, cfg.stepDownMs);
  // 429 の段階は4つまで。403 で上がった段階（それより上）は下げない
  const level =
    escalate && !alreadyOpen
      ? Math.max(current, Math.min(cfg.retryStagesMs.length, current + 1))
      : current;
  const until = Math.max(s.openUntil, t + durationOf(Math.max(1, level)));
  s.probing = false;
  s.events = [];
  s.consecutive = 0;
  // 既に開いていて期限も延びないなら書かない（長い方を残すだけ）
  if (alreadyOpen && until <= s.openUntil) return;
  if (!alreadyOpen) s.openedAt = t;
  s.level = level;
  s.openUntil = until;
  if (store) {
    const wrote = await safe("開放の記録", async () => {
      const result = await store.open(hostKey, s.openUntil, reason, {
        level: s.level,
        openedAtMs: s.openedAt,
      });
      return wroteUntil(s, result);
    });
    // 書けたときだけ「DB の値」を覚える（書き込みの失敗の後の読み直しで、自分の開放を DB の古い値で消さない。④c の審査 P2-1）
    if (wrote) adoptWritten(s, wrote);
  }
};
