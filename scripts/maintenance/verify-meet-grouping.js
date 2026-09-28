/**
 * verify-meet-grouping.js - 節推定（`src/utils/meetGrouping.js`）が
 * `race_conditions.series_day` と一致し続けるかを検査する。
 *
 * ## なぜ要るか
 *
 * `groupIntoCurrentMeet` は節の境目を **race_idの日付の連続性**（間が2日を超えたら
 * 別の節）で推定する。実装当時（2026-09-15）は `series_day` / `is_final_day` が
 * 全件nullで他に手が無かったが、現在は2026-02-01以降 99.94% 埋まっている。それでも
 * 推定を続けるという判断（`meetGrouping.js` のモジュールコメント）は、
 * 2026-09-28の実測で**一致率100%**だったことに乗っている。
 *
 * この一致は偶然ではなく「同じ会場で中1〜2日しか空かない隣接2節に、同じ選手が
 * 続けて斡旋されない」という斡旋の性質に依存している。斡旋の運用が変わると、
 * 推定が黙って前の節を混ぜ始める。画面上は「今節の走りが1〜2走多い」だけで、見て
 * 気づけない（[BOA-491](https://linear.app/boat-ai/issue/BOA-491)は会場単位で同じ
 * ヒューリスティックを複製している `getMeetScoreboard` で実際に起きた例）。
 *
 * ## 何を見るか
 *
 *   A. 選手1人・会場1つに絞った出走履歴で、推定した節が `series_day` 由来の
 *      正解と一致すること
 *   B. 推定が誤りうる境界に、その前後どちらにも出走した選手が現れないこと
 *
 * Bが0でなくなったら、Aがまだ通っていても危険水域。`series_day` への切り替えを
 * 検討する合図として見る。
 *
 * ## 節の切り出し方（series_day 側の「正解」）
 *
 * 会場ごとに開催日を昇順に並べ、前方向に1パスで節へ切る。
 *
 *   - `series_day === 1`       → 新しい節の始まり
 *   - `series_day < 直前の値`   → 新しい節の始まり。初日の行が無いだけ
 *                                 （2026-06-04の江戸川・蒲郡は `races` ごと欠けていて
 *                                 `series_day=2` から始まる）
 *   - `series_day >= 直前の値`  → 同じ節の続き
 *
 * 判定を2つとも緩くしてある。理由は実測で決めた（2026-09-28）。
 *
 *   - **「増分がちょうど1」を要求しない**。中止順延で 5→7 のように飛ぶ実例が
 *     2026-09に在る。要求すると節の途中を切れ目と誤り、検査が偽陽性を出す
 *   - **同じ値の連続（4→4・2→2）も節の続きとして扱う**。2026-09に3箇所あり
 *     （江戸川09-21→22、戸田09-21→22、津09-22→23）、いずれも**前後に同じ
 *     43〜47人が出走している**（1節は約48人）。顔ぶれが入れ替わっていないので
 *     新しい節ではなく順延。新しい節として切ると、その節の全員が検査Bの違反に
 *     見えてしまう
 *
 * なお `scripts/lib/meetBoundaries.js` の `buildMeets()`（BOA-457、scripts側の
 * 全節列挙）は `series_day <= 直前の値` を新しい節とするため、上の同値3箇所を
 * 節の切れ目として扱う。用途が違う（あちらは予選の締めを出す）が、順延の日で
 * 節が分かれる可能性がある（[BOA-506](https://linear.app/boat-ai/issue/BOA-506)）。
 *
 * ## 使い方
 *
 *   node --env-file=.env.local scripts/maintenance/verify-meet-grouping.js
 *   node --env-file=.env.local scripts/maintenance/verify-meet-grouping.js --since 2026-06-01
 *   node --env-file=.env.local scripts/maintenance/verify-meet-grouping.js --racers 100
 *
 * 読み取り専用。実Supabaseへの接続が要るため tier=manual（CIでは走らない）。
 * 終了コード: 0=合格 / 1=AまたはBの違反、または検査が成立していない。
 */
import { createClient } from "@supabase/supabase-js";
import { fetchAll, VENUE_NAMES } from "../lib/supabaseClient.js";
import { groupIntoCurrentMeet } from "../../src/utils/meetGrouping.js";

/** `series_day` が埋まり始めた月。これより前は行そのものが無いので検査できない */
const DATA_START = "2026-02-01";
/** 検査する選手数の既定値。多いほど厳しいが、そのぶん本番DBを読む */
const DEFAULT_RACERS = 300;
/**
 * 1ページあたりの待ち時間の上限（ms）。共有クライアント
 * （`scripts/lib/supabaseClient.js`）の15秒では `race_conditions` の全件取得が
 * 中断する（2026-09-28に実際に中断した。`scripts/lib/meetBoundaries.js` の
 * `fetchAllByRaceId` が同じ問題に当たっている）。
 */
const FETCH_TIMEOUT_MS = 90000;
/** ページ取得の再試行回数。1ページの中断で検査全体を落とさないため */
const PAGE_RETRIES = 3;
/**
 * 検査が成立していると見なす最小の会場×開催日数。1日あたり24会場のうち
 * 実際に開催しているのは十数会場なので、窓の日数から控えめに見積もる。
 * 絶対値で固定すると `--since` を短く指定したときに正常データで落ちる。
 */
const MIN_VENUE_DAYS_PER_WINDOW_DAY = 5;
/**
 * 判定できなかったアンカーの許容割合（当日ぶんを除く）。`series_day` の品質が
 * 崩れるほど「判定できないので除外」が増えて合格し続けるのを防ぐ。
 */
const MAX_SKIP_PCT = 5;

function makeClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    global: {
      fetch: (input, init = {}) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        return fetch(input, { ...init, signal: controller.signal }).finally(
          () => clearTimeout(timer),
        );
      },
    },
  });
}

function parseArgs(argv) {
  const out = { since: DATA_START, racers: DEFAULT_RACERS };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--since") {
      const value = argv[++i];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? ""))
        throw new Error("--since は YYYY-MM-DD で指定する");
      out.since = value;
    } else if (arg === "--racers") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value <= 0)
        throw new Error("--racers は正の整数で指定する");
      out.racers = value;
    } else {
      // 黙って無視すると `--sinc` のような打ち間違いが既定値で走ってしまう
      throw new Error(`知らない引数: ${arg}`);
    }
  }
  if (out.since < DATA_START) out.since = DATA_START;
  return out;
}

const dayDiff = (a, b) => (new Date(a) - new Date(b)) / 86400000;
/** race_id（YYYY-MM-DD-VV-RR）の会場コード部分 */
const venueOf = (raceId) => raceId.split("-")[3];
const dateOf = (raceId) => raceId.slice(0, 10);
const median = (nums) => {
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/**
 * 取得失敗を「該当0件」と混同しないため、全クエリで throwOnError を立てる
 * （空データで合格すると、一致率100%という結論が「何も読めていないだけ」で出る）。
 * `race_id` で並べるのは、offsetページングで行が入れ替わって取りこぼすのを防ぐため。
 */
async function readAll(client, table, select, build) {
  // 並び順は**全順序**にする。`fetchAll` は `.range(offset, …)` のoffsetページングで、
  // 同じ値が並ぶ並び順だとページの境目で行を取りこぼす・重複させる。`race_entries`
  // は1つの `race_id` に6行あるので `race_id` だけでは足りず、`racer_id` を足す
  // （`scripts/lib/meetBoundaries.js` の `fetchAllByRaceId` は同じ問題をキーセット
  // 方式で解くが、フィルタを渡せないのでここでは使えない）
  const withOrder = (q) => {
    const ordered = (build ? build(q) : q).order("race_id");
    return select.includes("racer_id") ? ordered.order("racer_id") : ordered;
  };
  let lastError = null;
  for (let attempt = 1; attempt <= PAGE_RETRIES; attempt++) {
    try {
      return await fetchAll(table, select, withOrder, {
        throwOnError: true,
        client,
      });
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `${table} の取得に${PAGE_RETRIES}回失敗: ${lastError?.message}`,
  );
}

async function fetchByIn(client, table, select, col, ids, chunk = 150) {
  const out = [];
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    out.push(
      ...(await readAll(client, table, select, (q) => q.in(col, slice))),
    );
  }
  return out;
}

/**
 * 会場ごとに開催日を昇順に並べ、`series_day` で節へ切る（上記「節の切り出し方」）。
 *
 * @returns {{segmentsByVenue: Map<string, Array<{dates: string[], lastSd: number}>>,
 *   segmentOfDay: Map<string, {venue: string, index: number, dates: string[]}>,
 *   ambiguous: Array<Object>, totalDays: number}}
 */
async function loadMeetSegments(client, since) {
  const rows = await readAll(
    client,
    "race_conditions",
    "race_id, series_day",
    (q) => q.gte("race_id", since).not("series_day", "is", null),
  );
  const sdByDay = new Map();
  for (const r of rows) {
    const key = `${venueOf(r.race_id)}|${dateOf(r.race_id)}`;
    if (!sdByDay.has(key)) sdByDay.set(key, r.series_day);
  }
  const daysByVenue = new Map();
  for (const [key, sd] of sdByDay) {
    const [venue, date] = key.split("|");
    if (!daysByVenue.has(venue)) daysByVenue.set(venue, []);
    daysByVenue.get(venue).push({ date, sd });
  }

  const segmentsByVenue = new Map();
  const segmentOfDay = new Map();
  const postponed = [];
  let totalDays = 0;
  for (const [venue, days] of daysByVenue) {
    days.sort((a, b) => a.date.localeCompare(b.date));
    totalDays += days.length;
    const segments = [];
    let current = null;
    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      const startsNewMeet =
        current === null || day.sd === 1 || day.sd < current.lastSd;
      if (day.sd !== 1 && current !== null && day.sd === current.lastSd) {
        // 順延とみなして節を続ける。判断の根拠は上記「節の切り出し方」
        postponed.push({
          venue,
          prev: days[i - 1].date,
          next: day.date,
          sd: day.sd,
          gap: dayDiff(day.date, days[i - 1].date),
        });
      }
      if (startsNewMeet) {
        current = {
          dates: [],
          lastSd: 0,
          // 最初の節が series_day=1 で始まっていなければ、データ開始境界で
          // 頭が切れている。この節に属するアンカーは検査Aから除外する
          // （推定は実在する出走から遡るので、切れた頭のぶんだけ食い違う）
          truncated: segments.length === 0 && day.sd !== 1,
        };
        segments.push(current);
      }
      current.dates.push(day.date);
      current.lastSd = day.sd;
    }
    segmentsByVenue.set(venue, segments);
    segments.forEach((seg, index) =>
      seg.dates.forEach((date) =>
        segmentOfDay.set(`${venue}|${date}`, {
          venue,
          index,
          dates: seg.dates,
        }),
      ),
    );
  }
  // race_conditions が実際に覆っている最初の日。`--since` より後ろにずれる
  // （既定の 2026-02-01 に対し実データは 2026-02-03 から）。これより前の出走は
  // 「節の正解」を作れないので、検査の入力から外す
  const coverageStart = [...sdByDay.keys()]
    .map((k) => k.split("|")[1])
    .sort()[0];
  return { segmentsByVenue, segmentOfDay, postponed, totalDays, coverageStart };
}

/** 検査A: 選手単位・会場単位に絞った節推定が series_day 由来の節と一致するか */
async function checkRacerScopedAgreement(
  client,
  segmentOfDay,
  since,
  racerCount,
  coverageStart,
) {
  const recent = await readAll(
    client,
    "race_entries",
    "racer_id, race_id",
    (q) => q.gte("race_id", since).not("racer_id", "is", null),
  );
  const racers = [...new Set(recent.map((r) => r.racer_id))]
    .sort((a, b) => a - b)
    .slice(0, racerCount);
  const entries = await fetchByIn(
    client,
    "race_entries",
    "racer_id, race_id",
    "racer_id",
    racers.map(String),
    25,
  );
  const byRacer = new Map();
  for (const e of entries) {
    // race_conditions が覆っていない日の出走を混ぜると、推定だけがそれを拾って
    // 「節の正解」と食い違う（2026-02-01・02-02はracesに在るがrace_conditionsに無い）
    if (e.race_id < coverageStart) continue;
    if (!byRacer.has(e.racer_id)) byRacer.set(e.racer_id, []);
    byRacer.get(e.racer_id).push(e.race_id);
  }

  let anchors = 0;
  // 当日ぶんの除外は構造的（series_dayはracelistの当日スクレイプ待ちでnull）。
  // データ品質の劣化と区別するため別に数える
  let skippedToday = 0;
  let skippedTruncated = 0;
  let skippedOther = 0;
  const today = new Date().toISOString().slice(0, 10);
  const mismatches = [];
  for (const [racerId, ids] of byRacer) {
    const uniq = [...new Set(ids)].sort();
    for (const anchor of uniq) {
      const venue = venueOf(anchor);
      const segment = segmentOfDay.get(`${venue}|${dateOf(anchor)}`);
      if (!segment) {
        if (dateOf(anchor) >= today) skippedToday++;
        else skippedOther++;
        continue;
      }
      if (segment.truncated) {
        skippedTruncated++;
        continue;
      }
      const meetDates = new Set(segment.dates);
      const before = uniq.filter((id) => venueOf(id) === venue && id < anchor);
      // 呼び出し元（basicInfoStats.buildMeetResults）と同じく、表示中のレースを
      // 終端の目印として足してから切り出し、目印自身は除く
      const estimated = groupIntoCurrentMeet([
        ...before.map((id) => ({ race_id: id })),
        { race_id: anchor },
      ])
        .map((e) => e.race_id)
        .filter((id) => id !== anchor);
      const expected = before.filter((id) => meetDates.has(dateOf(id)));
      anchors++;
      if (estimated.join(",") !== expected.join(",")) {
        mismatches.push({
          racerId,
          anchor,
          estimated: estimated.length,
          expected: expected.length,
        });
      }
    }
  }
  return {
    anchors,
    skippedToday,
    skippedTruncated,
    skippedOther,
    mismatches,
    racerCount: byRacer.size,
  };
}

/**
 * 検査B: 推定が誤りうる境界に、その前後どちらにも出走した選手が現れていないか。
 *
 * 誤りうるのは2通り。
 *
 *   繋げる: 節と節の暦日の差が2日以内。推定は2日以内を境目と見ないので前の節まで
 *           遡り続ける。前の節ぜんたい × 次の節ぜんたい で突き合わせる
 *   切る  : 節の**内部**で3日以上空く（中止順延など）。推定はそこを境目と誤認する。
 *           同じ節の中で「空きの前」と「空き以降」を突き合わせる。節ぜんたいを
 *           両側に取ると前半が後半に必ず含まれてしまい、全選手が違反に見える
 */
async function checkRiskyBoundaries(client, segmentsByVenue) {
  const risky = [];
  for (const [venue, segments] of segmentsByVenue) {
    for (let s = 1; s < segments.length; s++) {
      const prev = segments[s - 1];
      const next = segments[s];
      const gap = dayDiff(next.dates[0], prev.dates.at(-1));
      if (gap <= 2) {
        risky.push({
          venue,
          kind: "繋げる",
          gap,
          label: `${prev.dates.at(-1)}→${next.dates[0]}`,
          left: prev.dates,
          right: next.dates,
        });
      }
    }
    for (const seg of segments) {
      for (let i = 1; i < seg.dates.length; i++) {
        const gap = dayDiff(seg.dates[i], seg.dates[i - 1]);
        if (gap > 2) {
          risky.push({
            venue,
            kind: "切る",
            gap,
            label: `${seg.dates[i - 1]}→${seg.dates[i]}`,
            left: seg.dates.slice(0, i),
            right: seg.dates.slice(i),
          });
        }
      }
    }
  }

  const violations = [];
  for (const b of risky) {
    const span = [...b.left, ...b.right].sort();
    const entries = await readAll(
      client,
      "race_entries",
      "racer_id, race_id",
      (q) =>
        q
          .gte("race_id", span[0])
          .lte("race_id", `${span.at(-1)}-zz`)
          .like("race_id", `__________-${b.venue}-__`)
          .not("racer_id", "is", null),
    );
    if (entries.length === 0) {
      // 出走が1件も無いのは境界の作り方かクエリがおかしい。0人＝安全と読まない
      violations.push({
        ...b,
        racers: [],
        note: "出走0件（検査が成立していない）",
      });
      continue;
    }
    const leftDates = new Set(b.left);
    const rightDates = new Set(b.right);
    const inLeft = new Set();
    const inRight = new Set();
    for (const e of entries) {
      const d = dateOf(e.race_id);
      if (leftDates.has(d)) inLeft.add(e.racer_id);
      if (rightDates.has(d)) inRight.add(e.racer_id);
    }
    const both = [...inLeft].filter((r) => inRight.has(r));
    if (both.length > 0) violations.push({ ...b, racers: both });
  }
  return { risky, violations };
}

async function main() {
  const { since, racers } = parseArgs(process.argv.slice(2));
  const client = makeClient();
  if (!client) {
    console.error(
      "Supabase環境変数が未設定（SUPABASE_URL / SUPABASE_SERVICE_KEY）",
    );
    process.exit(1);
  }
  console.log(`節推定の検査（${since} 以降、選手${racers}人まで）\n`);

  const { segmentsByVenue, segmentOfDay, postponed, totalDays, coverageStart } =
    await loadMeetSegments(client, since);
  const windowDays = Math.max(
    1,
    dayDiff(new Date().toISOString().slice(0, 10), since),
  );
  const minVenueDays = Math.round(windowDays * MIN_VENUE_DAYS_PER_WINDOW_DAY);
  const meets = [...segmentsByVenue.values()].reduce((a, s) => a + s.length, 0);
  console.log(
    `会場×開催日 = ${totalDays}件 / ${segmentsByVenue.size}会場 / 節${meets}個` +
      `（節の長さ 中央${median([...segmentsByVenue.values()].flat().map((s) => s.dates.length))}日）` +
      `\n  race_conditions が覆う最初の日 = ${coverageStart}（これ以前の出走は検査対象外）`,
  );
  if (totalDays < minVenueDays) {
    console.error(
      `\n❌ race_conditions が ${totalDays}件しか読めていない（窓${windowDays}日なら下限${minVenueDays}件）。` +
        "\n   検査が成立しないので合格にしない。取得の失敗か、since の指定を疑うこと。",
    );
    process.exit(1);
  }
  if (postponed.length > 0) {
    console.log(
      `\n[参考] series_day が同じ値で続く日（順延として同じ節に含める） = ${postponed.length}件`,
    );
    postponed
      .slice(0, 10)
      .forEach((x) =>
        console.log(
          `      ${VENUE_NAMES[Number(x.venue)] ?? x.venue} ${x.prev}→${x.next}(sd=${x.sd}, gap=${x.gap}日)`,
        ),
      );
  }

  const a = await checkRacerScopedAgreement(
    client,
    segmentOfDay,
    since,
    racers,
    coverageStart,
  );
  if (a.anchors === 0) {
    console.error(
      "\n❌ 判定できたアンカーが0件。race_entries を読めていないので合格にしない。",
    );
    process.exit(1);
  }
  const mismatchPct = (100 * a.mismatches.length) / a.anchors;
  const skipPct = (100 * a.skippedOther) / (a.anchors + a.skippedOther);
  console.log(
    `\n[A] 選手単位の一致: 判定できたアンカー${a.anchors}件（選手${a.racerCount}人）`,
  );
  console.log(
    `    除外: 当日ぶん${a.skippedToday}件（series_dayが当日スクレイプ待ちで必ずnull・構造的）` +
      ` / データ開始境界で頭が切れた節${a.skippedTruncated}件` +
      ` / その他${a.skippedOther}件 = ${skipPct.toFixed(2)}%`,
  );
  console.log(
    `    不一致 ${a.mismatches.length}件 = ${mismatchPct.toFixed(2)}%`,
  );
  a.mismatches
    .slice(0, 10)
    .forEach((m) =>
      console.log(
        `      racer=${m.racerId} ${m.anchor} 推定${m.estimated}走 / 実${m.expected}走`,
      ),
    );

  const b = await checkRiskyBoundaries(client, segmentsByVenue);
  const merge = b.risky.filter((r) => r.kind === "繋げる").length;
  const split = b.risky.filter((r) => r.kind === "切る").length;
  console.log(
    `\n[B] 推定が誤りうる境界: ${b.risky.length}箇所（繋げる${merge} / 切る${split}）。` +
      `前後どちらにも出走した選手が居る箇所 ${b.violations.length}`,
  );
  b.violations
    .slice(0, 10)
    .forEach((v) =>
      console.log(
        `      ${VENUE_NAMES[Number(v.venue)] ?? v.venue} ${v.label}` +
          `(${v.gap}日, ${v.kind}) ${v.note ?? `両側に出走 ${v.racers.length}人: ${v.racers.slice(0, 5).join(",")}`}`,
      ),
    );
  if (b.risky.length === 0) {
    console.error(
      "\n❌ 危険な境界が0箇所。節の切り出しが機能していないので合格にしない。",
    );
    process.exit(1);
  }

  const problems = [];
  if (a.mismatches.length > 0)
    problems.push(`検査Aの不一致${a.mismatches.length}件`);
  if (b.violations.length > 0)
    problems.push(`検査Bの違反${b.violations.length}箇所`);
  if (skipPct > MAX_SKIP_PCT)
    problems.push(
      `判定不可の割合${skipPct.toFixed(2)}%（上限${MAX_SKIP_PCT}%）`,
    );
  if (problems.length > 0) {
    console.error(
      `\n❌ 不合格: ${problems.join(" / ")}` +
        "\n   日付の連続性による節推定が実データと食い違い始めている。" +
        "\n   src/utils/meetGrouping.js のモジュールコメント（切り替えない理由）を" +
        "\n   見直し、race_conditions.series_day への切り替えを検討すること。",
    );
    process.exit(1);
  }
  console.log(
    "\n✅ 合格。日付の連続性による節推定は series_day と一致している",
  );
}

main().catch((err) => {
  console.error("検査に失敗:", err?.message ?? err);
  process.exit(1);
});
