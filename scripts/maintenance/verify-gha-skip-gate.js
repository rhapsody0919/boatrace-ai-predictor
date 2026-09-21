/**
 * verify-gha-skip-gate.js - フェイルセーフ付きSKIP（scripts/lib/ghaSkipGate.js、scripts/maintenance/gha-skip-gate.js、
 * scripts/daily/scrape-scheduled.js・日次ワークフローの配線）の検証。DBにもネットワークにも接続しない（偽のclientを使う）。
 *
 * 確認すること:
 *   (a) 変数が未設定・false・空・未知の値: clientを一切呼ばず（DBを読まず）、常に「実行」（現行と同じ）
 *   (b) 窓型（odds・result）: live・起動が新しい・連続失敗なし・ブレーカーが閉じている → スキップ。
 *       modeがlive以外・行なし・起動が古い・連続失敗・ブレーカーが開いている・不正な値 → 実行。
 *       レースの無い時間帯（最終成功が半日前でも、起動が新しい）は誤って実行しない
 *   (c) 日次（point_rank等）: 対象日を処理済み → スキップ。未処理・前日分のみ・shadow・失敗 → 実行。指定時刻の直後は retryable
 *   (d) チャンク処理（racer_profiles）: 処理中（指定時刻以降に成功があり新しい）はスキップ。それ以外は実行
 *   (e) 複数ジョブ（SKIP_RESULTS_ON_GHA = result・result_catchup）: 全て健全のときだけスキップ
 *   (f) 失敗・タイムアウト・不正な応答・認証情報なし・不正な行: すべて「実行」
 *   (g) 待機（日次の指定時刻の直後）: Vercelの完了を待って再判定し、上限まで完了しなければ「実行」
 *   (h) RESTクライアント: 該当ジョブの行だけを、service_roleのキーで読む。HTTPエラー・非配列は例外
 *   (i) CLI: 常にskip=true|falseを出力し、あらゆる失敗でskip=false
 *   (j) 配線: 変数とジョブの対応・対象外の変数・ワークフローのgateジョブ・scrape-scheduled.js・vercel.jsonの起動間隔
 *   (k) 変異検証: 判定の要（modeの確認・起動の鮮度・連続失敗・ブレーカー・対象日の比較・失敗時のフェイルセーフ・全ジョブの健全性・
 *       タイムアウト・DBを読まない既定）を1つずつ壊したコピーで、この検証が失敗すること
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as realGate from "../lib/ghaSkipGate.js";
import { main as gateMain } from "./gha-skip-gate.js";
import { SCRAPE_JOBS } from "../lib/scrapeJobs/registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const LIB_DIR = path.join(ROOT, "scripts/lib");

const printOut = console.log.bind(console);
const printErr = console.error.bind(console);
console.warn = () => {};

const jst = (text) => new Date(`${text.replace(" ", "T")}:00+09:00`);
const minutesAgo = (now, min) =>
  new Date(now.getTime() - min * 60000).toISOString();
const show = (v) => JSON.stringify(v);

const row = (job, overrides = {}) => ({
  job,
  mode: "live",
  last_tick_at: null,
  last_success_at: null,
  consecutive_failures: 0,
  last_target_date: null,
  breaker_open_until: null,
  ...overrides,
});
const fakeClient = (rows) => {
  const calls = [];
  return {
    calls,
    async readJobStates(keys) {
      calls.push(keys);
      return typeof rows === "function" ? rows(keys) : rows;
    },
  };
};
const throwingClient = () => ({
  calls: [],
  async readJobStates() {
    this.calls.push("called");
    throw new Error("DBを読んではいけない");
  },
});

/**
 * 検証の本体。mod（実物、または壊したコピー）に対して全ての確認をし、record(label, pass, detail) で報告する。
 */
async function suite(mod, record) {
  const decide = async (varName, rows, now, extra = {}) =>
    mod.shouldSkipOnGha({
      varName,
      env: { [varName]: "true" },
      client: fakeClient(rows),
      now,
      logger: null,
      ...extra,
    });
  const skipOf = async (...args) => (await decide(...args)).skip;

  // ---- (a) 変数が true でない → DB を読まず、常に実行 ----
  {
    const NOW = jst("2026-09-24 12:00");
    let ok = true;
    const seen = [];
    for (const value of [
      undefined,
      "",
      "false",
      "0",
      "no",
      "1",
      "yes",
      " ",
      "null",
    ]) {
      for (const varName of Object.keys(mod.GHA_SKIP_TARGETS)) {
        const client = throwingClient();
        const d = await mod.shouldSkipOnGha({
          varName,
          env: { [varName]: value },
          client,
          now: NOW,
          logger: null,
        });
        if (
          d.skip !== false ||
          client.calls.length !== 0 ||
          d.reason !== "flag_off"
        ) {
          ok = false;
          seen.push({
            varName,
            value,
            d: d.reason,
            calls: client.calls.length,
          });
        }
      }
    }
    record(
      "変数が未設定・空・false・0・no・1・yes 等: 全ての対象変数で、clientを呼ばず（DBを読まず）実行する（現行と同じ）",
      ok,
      show(seen.slice(0, 3)),
    );
    const client = throwingClient();
    const d = await mod.shouldSkipOnGha({
      varName: "SKIP_ODDS_ON_GHA",
      env: { SKIP_ODDS_ON_GHA: " True " },
      client,
      now: NOW,
      logger: null,
    });
    record(
      "変数は大文字小文字・前後の空白を無視して true と判定する（GitHubの式 vars.X == 'true' と同じ。true のときだけDBを読む）",
      client.calls.length === 1 &&
        d.reason === "read_failed" &&
        d.skip === false,
      show(d),
    );
    const d2 = await mod.shouldSkipOnGha({
      varName: "SKIP_ODDS_REFRESH_ON_GHA",
      env: { SKIP_ODDS_REFRESH_ON_GHA: "true" },
      client: throwingClient(),
      now: NOW,
      logger: null,
    });
    record(
      "対象外の変数（予測リフレッシュ SKIP_ODDS_REFRESH_ON_GHA）: true でもスキップしない（判定できないため。従来の静的な変数のまま）",
      d2.skip === false && d2.reason === "unsupported_var",
      show(d2),
    );
  }

  // ---- (b) 窓型 ----
  {
    const NOW = jst("2026-09-24 12:00");
    const healthy = (o = {}) =>
      row("odds", {
        last_tick_at: minutesAgo(NOW, 2),
        last_success_at: minutesAgo(NOW, 1),
        ...o,
      });
    const V = "SKIP_ODDS_ON_GHA";
    const d0 = await decide(V, [healthy()], NOW);
    record(
      "オッズ: live・起動2分前・失敗0・ブレーカー行なし → スキップ（理由付き）",
      d0.skip === true &&
        /スキップ/.test(d0.message) &&
        /最終起動2分前/.test(d0.message),
      show(d0),
    );
    const rowsFor = (r, host) => (host ? [r, host] : [r]);
    const cases = [
      ["modeがshadow", healthy({ mode: "shadow" }), false],
      ["modeがoff", healthy({ mode: "off" }), false],
      ["modeが不正", healthy({ mode: null }), false],
      [
        "起動が12分前（閾値ちょうど）",
        healthy({ last_tick_at: minutesAgo(NOW, 12) }),
        false,
      ],
      [
        "起動が30分前（Vercel Cron停止）",
        healthy({ last_tick_at: minutesAgo(NOW, 30) }),
        false,
      ],
      ["起動の記録なし", healthy({ last_tick_at: null }), false],
      ["起動の値が不正な文字列", healthy({ last_tick_at: "garbage" }), false],
      [
        "起動が5分後（時計の異常）",
        healthy({ last_tick_at: minutesAgo(NOW, -5) }),
        false,
      ],
      ["連続失敗3回", healthy({ consecutive_failures: 3 }), false],
      [
        "連続失敗が不正（null）",
        healthy({ consecutive_failures: null }),
        false,
      ],
      [
        "連続失敗が不正（文字列）",
        healthy({ consecutive_failures: "2" }),
        false,
      ],
      ["連続失敗が負", healthy({ consecutive_failures: -1 }), false],
    ];
    for (const [label, r, expected] of cases) {
      const d = await decide(V, rowsFor(r), NOW);
      record(
        `オッズ: ${label} → 実行（スキップしない）`,
        d.skip === expected && /実行/.test(d.message),
        show(d),
      );
    }
    const ok1 = await skipOf(
      V,
      [healthy({ last_tick_at: minutesAgo(NOW, 11) })],
      NOW,
    );
    const ok2 = await skipOf(V, [healthy({ consecutive_failures: 2 })], NOW);
    record(
      "オッズ: 起動11分前・連続失敗2回はまだ健全 → スキップ（閾値の境界）",
      ok1 === true && ok2 === true,
    );
    const d1 = await skipOf(V, [], NOW);
    record("オッズ: ジョブ状態の行なし（空の応答） → 実行", d1 === false);
    const open = row("host:boatrace.jp", {
      breaker_open_until: minutesAgo(NOW, -20),
    });
    const past = row("host:boatrace.jp", {
      breaker_open_until: minutesAgo(NOW, 20),
    });
    const closed = row("host:boatrace.jp");
    const b1 = await decide(V, [healthy(), open], NOW);
    record(
      "オッズ: 取得先（host:boatrace.jp）のブレーカーが開いている → 実行（Vercelのfetchが止められている間、GitHubが肩代わり）",
      b1.skip === false && b1.reason === "breaker_open",
      show(b1),
    );
    record(
      "オッズ: ブレーカーが解除済み（期限が過去）・null → スキップ",
      (await skipOf(V, [healthy(), past], NOW)) === true &&
        (await skipOf(V, [healthy(), closed], NOW)) === true,
    );
    // レースの無い時間帯: 最終成功が半日前・なしでも、起動が新しければ（Vercelは動いている）誤って実行しない
    const quiet1 = await skipOf(
      V,
      [healthy({ last_success_at: minutesAgo(NOW, 12 * 60) })],
      NOW,
    );
    const quiet2 = await skipOf(V, [healthy({ last_success_at: null })], NOW);
    record(
      "レースの無い時間帯（夜間・昼の谷間）: 最終成功が12時間前・記録なしでも、起動が新しければ（Vercelは動いている）、誤って実行しない（二重取得を避ける）",
      quiet1 === true && quiet2 === true,
      show({ quiet1, quiet2 }),
    );
    const N2 = jst("2026-09-24 07:31");
    const quiet4 = await skipOf(
      V,
      [
        row("odds", {
          last_tick_at: minutesAgo(N2, 3),
          last_success_at: minutesAgo(N2, 9 * 60),
        }),
      ],
      N2,
    );
    record(
      "朝の最初の窓（07:31）: 起動3分前・最終成功が前夜（9時間前）でも → スキップ",
      quiet4 === true,
    );
    // Vercel Cron の運用窓の外（起動が数時間前）で GitHub に処理があるときは、従来どおり実行する
    const off = await skipOf(
      V,
      [healthy({ last_tick_at: minutesAgo(NOW, 5 * 60) })],
      NOW,
    );
    record("運用窓の外（起動が5時間前）: 実行（現行どおり）", off === false);
    const dKfile = await decide(
      "SKIP_KFILE_ON_GHA",
      [row("kfile_sync", { last_target_date: "2026-09-24" })],
      NOW,
    );
    record(
      "kfile_sync: 対象日（07:00指定→当日）を処理済み → スキップ",
      dKfile.skip === true,
      show(dKfile),
    );
    const dKfile2 = await decide(
      "SKIP_KFILE_ON_GHA",
      [row("kfile_sync", { last_target_date: "2026-09-23" })],
      NOW,
    );
    record(
      "kfile_sync: 当日分が未処理（前日分のみ） → 実行",
      dKfile2.skip === false && dKfile2.reason === "target_pending",
      show(dKfile2),
    );
  }

  // ---- (c) 日次 ----
  {
    const V = "SKIP_POINT_RANK_ON_GHA";
    const done = row("point_rank", { last_target_date: "2026-09-24" });
    const N1 = jst("2026-09-24 22:30");
    const d1 = await decide(V, [done], N1);
    record(
      "point_rank（22:00指定）: 22:30に当日(09-24)を処理済み → スキップ",
      d1.skip === true && /処理済み/.test(d1.message),
      show(d1),
    );
    const N2 = jst("2026-09-25 06:00");
    record(
      "point_rank: 翌朝06:00（対象日は09-24のまま）も、処理済みならスキップ",
      (await skipOf(V, [done], N2)) === true,
    );
    const prevOnly = row("point_rank", { last_target_date: "2026-09-23" });
    const d3 = await decide(V, [prevOnly], jst("2026-09-24 22:30"));
    record(
      "point_rank: 22:30に前日分(09-23)までしか処理していない → 実行（当日のVercelの失敗を救う）。指定時刻から30分経過のため待機の対象ではない",
      d3.skip === false &&
        d3.reason === "target_pending" &&
        d3.retryable === false,
      show(d3),
    );
    const d4 = await decide(V, [prevOnly], jst("2026-09-24 22:04"));
    record(
      "point_rank: 22:04に未処理 → 実行だが retryable（指定時刻の直後。Vercelの完了を待つ価値がある）",
      d4.skip === false && d4.retryable === true,
      show(d4),
    );
    const d5 = await decide(V, [prevOnly], jst("2026-09-24 22:10"));
    record(
      "point_rank: 22:10（待機の上限）で未処理 → retryable でなくなる",
      d5.retryable === false,
      show(d5),
    );
    const d6 = await decide(
      V,
      [row("point_rank", { mode: "shadow", last_target_date: "2026-09-24" })],
      N1,
    );
    record(
      "point_rank: mode=shadow は、対象日が済みでも実行・retryable でない",
      d6.skip === false && d6.retryable === false,
      show(d6),
    );
    const d7 = await decide(V, [row("point_rank", { mode: "off" })], N1);
    record("point_rank: mode=off → 実行", d7.skip === false);
    const d8 = await decide(
      V,
      [
        row("point_rank", {
          consecutive_failures: 3,
          last_target_date: "2026-09-23",
        }),
      ],
      jst("2026-09-24 22:04"),
    );
    record(
      "point_rank: 連続失敗3回・未処理 → 実行・retryable でない",
      d8.skip === false && d8.retryable === false,
      show(d8),
    );
    const d9 = await decide(
      V,
      [row("point_rank", { last_target_date: "garbage" })],
      N1,
    );
    record(
      "point_rank: last_target_date が不正 → 実行",
      d9.skip === false && d9.reason === "invalid_value",
      show(d9),
    );
    const d10 = await decide(
      V,
      [row("point_rank", { last_target_date: null })],
      N1,
    );
    record(
      "point_rank: 未処理（last_target_date なし） → 実行",
      d10.skip === false,
    );
    const d11 = await decide(
      V,
      [
        row("point_rank", { last_target_date: "2026-09-23" }),
        row("host:boatrace.jp", {
          breaker_open_until: minutesAgo(jst("2026-09-24 22:04"), -10),
        }),
      ],
      jst("2026-09-24 22:04"),
    );
    record(
      "point_rank: 未処理でブレーカーが開いている → 実行・retryable でない（待っても完了しない）",
      d11.skip === false &&
        d11.retryable === false &&
        d11.reason === "breaker_open",
      show(d11),
    );
    const d12 = await decide(
      V,
      [row("point_rank", { last_target_date: "2026-09-25" })],
      N1,
    );
    record(
      "point_rank: last_target_date が対象日より新しい → スキップ（>=）",
      d12.skip === true,
    );
    // 全ての日次変数が、対応するジョブの指定時刻で、当日分の処理済みでスキップする
    let allOk = true;
    const detail = [];
    for (const [varName, jobs] of Object.entries(mod.GHA_SKIP_TARGETS)) {
      for (const job of jobs) {
        const def = SCRAPE_JOBS[job];
        if (def.kind !== "daily") continue;
        const nowAt = jst(`2026-10-02 ${def.targetTimeJst}`);
        const later = new Date(nowAt.getTime() + 20 * 60000);
        const doneRow = row(job, { last_target_date: "2026-10-02" });
        const okRow =
          (await skipOf(
            varName,
            jobs.map((j) =>
              j === job
                ? doneRow
                : row(j, {
                    last_target_date: "2026-10-02",
                    last_tick_at: later.toISOString(),
                    last_success_at: later.toISOString(),
                  }),
            ),
            later,
          )) === true;
        const ngRow =
          (await skipOf(
            varName,
            jobs.map((j) =>
              j === job
                ? row(job, { last_target_date: "2026-10-01" })
                : row(j, { last_target_date: "2026-10-02" }),
            ),
            later,
          )) === false;
        if (!okRow || !ngRow) {
          allOk = false;
          detail.push({ varName, job, okRow, ngRow });
        }
      }
    }
    record(
      "全ての日次ジョブ: 指定時刻の20分後、当日分の処理済みでスキップ・前日分までなら実行",
      allOk,
      show(detail),
    );
  }

  // ---- (d) チャンク処理 racer_profiles ----
  {
    const V = "SKIP_RACER_SEASON_ON_GHA";
    const N = jst("2026-10-02 04:00");
    const d1 = await decide(
      V,
      [
        row("racer_profiles", {
          last_success_at: minutesAgo(N, 10),
          last_target_date: "2026-09-02",
        }),
      ],
      N,
    );
    record(
      "racer_profiles: 03:00以降に成功があり10分前 → 処理中としてスキップ",
      d1.skip === true && d1.reason === "chunk_in_progress",
      show(d1),
    );
    const d2 = await decide(
      V,
      [
        row("racer_profiles", {
          last_success_at: jst("2026-10-02 02:00").toISOString(),
          last_target_date: "2026-09-02",
        }),
      ],
      N,
    );
    record(
      "racer_profiles: 成功が指定時刻(03:00)より前（前月・前日の残り） → 実行",
      d2.skip === false,
      show(d2),
    );
    const d3 = await decide(
      V,
      [
        row("racer_profiles", {
          last_success_at: minutesAgo(N, 50),
          last_target_date: "2026-09-02",
        }),
      ],
      N,
    );
    record(
      "racer_profiles: 成功が50分前（処理中の鮮度40分を超えた＝止まっている） → 実行",
      d3.skip === false,
      show(d3),
    );
    const d4 = await decide(
      V,
      [row("racer_profiles", { last_target_date: "2026-10-02" })],
      N,
    );
    record(
      "racer_profiles: 対象日を完了済み → スキップ",
      d4.skip === true && d4.reason === "daily_done",
      show(d4),
    );
    const d5 = await decide(
      V,
      [
        row("racer_profiles", {
          last_success_at: minutesAgo(N, 10),
          consecutive_failures: 3,
        }),
      ],
      N,
    );
    record(
      "racer_profiles: 処理中でも連続失敗3回 → 実行",
      d5.skip === false,
      show(d5),
    );
    const d6 = await decide(
      V,
      [
        row("racer_profiles", { last_success_at: minutesAgo(N, 10) }),
        row("host:boatrace.jp", { breaker_open_until: minutesAgo(N, -10) }),
      ],
      N,
    );
    record(
      "racer_profiles: 処理中でもブレーカーが開いている → 実行",
      d6.skip === false,
      show(d6),
    );
    const d7 = await decide(
      V,
      [
        row("racer_profiles", {
          last_success_at: minutesAgo(N, 10),
          mode: "shadow",
        }),
      ],
      N,
    );
    record(
      "racer_profiles: shadow の成功は処理中と認めない → 実行",
      d7.skip === false && d7.reason === "mode_not_live",
      show(d7),
    );
    // チャンクでない日次ジョブは、成功が新しくても、対象日が未処理なら実行
    const d8 = await decide(
      "SKIP_POINT_RANK_ON_GHA",
      [
        row("point_rank", {
          last_success_at: minutesAgo(jst("2026-09-24 22:30"), 5),
          last_target_date: "2026-09-23",
        }),
      ],
      jst("2026-09-24 22:30"),
    );
    record(
      "point_rank（チャンクでない）: 直近の成功があっても、対象日が未処理なら実行",
      d8.skip === false,
      show(d8),
    );
    const dPre = await decide(
      V,
      [
        row("racer_profiles", {
          last_success_at: minutesAgo(jst("2026-10-02 03:10"), 20),
          last_target_date: "2026-09-02",
        }),
      ],
      jst("2026-10-02 03:10"),
    );
    record(
      "racer_profiles: 成功が02:50（指定時刻03:00の前。前回の処理の残り）で、20分前と新しくても → 実行（今回の対象日の処理とは認めない）",
      dPre.skip === false,
      show(dPre),
    );
    // 03:00 直後（Vercelの最初のチャンクが未完了）は retryable
    const d9 = await decide(
      V,
      [row("racer_profiles", { last_target_date: "2026-09-02" })],
      jst("2026-10-02 03:02"),
    );
    record(
      "racer_profiles: 03:02（最初のチャンクの完了前） → 実行だが retryable（待機の対象）",
      d9.skip === false && d9.retryable === true,
      show(d9),
    );
  }

  // ---- (e) 複数ジョブ ----
  {
    const V = "SKIP_RESULTS_ON_GHA";
    const NOW = jst("2026-09-24 12:00");
    const result = (o = {}) =>
      row("result", {
        last_tick_at: minutesAgo(NOW, 2),
        last_success_at: minutesAgo(NOW, 1),
        ...o,
      });
    const catchup = (o = {}) =>
      row("result_catchup", { last_target_date: "2026-09-23", ...o });
    const d1 = await decide(V, [result(), catchup()], NOW);
    record(
      "結果取得: result（live・起動新しい）と result_catchup（前夜23:50の対象日=09-23を処理済み）が健全 → スキップ",
      d1.skip === true &&
        /result:/.test(d1.message) &&
        /result_catchup:/.test(d1.message),
      show(d1),
    );
    const d2 = await decide(V, [result(), catchup({ mode: "shadow" })], NOW);
    record(
      "結果取得: result_catchup が shadow → 実行（片方でも不健全なら実行）",
      d2.skip === false && d2.reason === "mode_not_live",
      show(d2),
    );
    const d3 = await decide(
      V,
      [result({ last_tick_at: minutesAgo(NOW, 30) }), catchup()],
      NOW,
    );
    record(
      "結果取得: result の起動が古い → 実行",
      d3.skip === false && d3.reason === "tick_stale",
      show(d3),
    );
    const d4 = await decide(
      V,
      [result(), catchup({ last_target_date: "2026-09-22" })],
      NOW,
    );
    record(
      "結果取得: result_catchup が前夜の対象日を処理していない → 実行",
      d4.skip === false && d4.reason === "target_pending",
      show(d4),
    );
    const d5 = await decide(V, [result()], NOW);
    record(
      "結果取得: result_catchup の行なし → 実行",
      d5.skip === false && d5.reason === "no_row",
      show(d5),
    );
    const d6 = await decide(V, [catchup()], NOW);
    record("結果取得: result の行なし → 実行", d6.skip === false);
    const client = fakeClient([result(), catchup()]);
    await mod.shouldSkipOnGha({
      varName: V,
      env: { [V]: "true" },
      client,
      now: NOW,
      logger: null,
    });
    record(
      "結果取得: 読む行は、対象ジョブ（result・result_catchup）と取得先ホスト（host:boatrace.jp）だけ（1回の読み取り）",
      client.calls.length === 1 &&
        show(client.calls[0].slice().sort()) ===
          show(["host:boatrace.jp", "result", "result_catchup"]),
      show(client.calls),
    );
    const N23 = jst("2026-09-24 23:55");
    const d7 = await decide(
      V,
      [result({ last_tick_at: minutesAgo(N23, 2) }), catchup()],
      N23,
    );
    record(
      "結果取得: 23:55（result_catchup の指定時刻23:50を過ぎ、当日分は未処理） → 実行（retryable。日付が変わるまでの補足）",
      d7.skip === false && d7.retryable === true,
      show(d7),
    );
  }

  // ---- (f) 失敗・タイムアウト・不正 ----
  {
    const NOW = jst("2026-09-24 12:00");
    const V = "SKIP_ODDS_ON_GHA";
    const env = { [V]: "true" };
    const good = [row("odds", { last_tick_at: minutesAgo(NOW, 1) })];
    const d1 = await mod.shouldSkipOnGha({
      varName: V,
      env,
      client: {
        readJobStates: async () => {
          throw new Error("connect ECONNREFUSED");
        },
      },
      now: NOW,
      logger: null,
    });
    record(
      "DBの読み取りが例外 → 実行（理由付き）",
      d1.skip === false &&
        d1.reason === "read_failed" &&
        /ECONNREFUSED/.test(d1.message),
      show(d1),
    );
    const d2 = await mod.shouldSkipOnGha({
      varName: V,
      env,
      client: {
        readJobStates: () => {
          throw new Error("同期の例外");
        },
      },
      now: NOW,
      logger: null,
    });
    record(
      "DBの読み取りが同期的に例外 → 実行",
      d2.skip === false && d2.reason === "read_failed",
      show(d2),
    );
    const started = Date.now();
    const d3 = await mod.shouldSkipOnGha({
      varName: V,
      env,
      client: { readJobStates: () => new Promise(() => {}) },
      now: NOW,
      logger: null,
      policy: { ...mod.GHA_SKIP_POLICY, readTimeoutMs: 50 },
    });
    record(
      "DBの読み取りが応答しない（タイムアウト） → 実行（クライアントがタイムアウトを持たなくても待たされない）",
      d3.skip === false &&
        d3.reason === "read_failed" &&
        Date.now() - started < 2000,
      show(d3),
    );
    for (const [label, rows] of [
      ["null", null],
      ["undefined", undefined],
      ["オブジェクト", { job: "odds" }],
      ["文字列", "ok"],
      [
        "配列の中身が不正（null・数値・jobなし）",
        [null, 1, {}, { mode: "live" }],
      ],
    ]) {
      const d = await mod.shouldSkipOnGha({
        varName: V,
        env,
        client: { readJobStates: async () => rows },
        now: NOW,
        logger: null,
      });
      record(`不正な応答（${label}） → 実行`, d.skip === false, show(d));
    }
    const d4 = await mod.shouldSkipOnGha({
      varName: V,
      env,
      client: fakeClient(good),
      now: NOW,
      logger: null,
    });
    record("（対照）正しい応答なら → スキップ", d4.skip === true);
    const d5 = await mod.shouldSkipOnGha({
      varName: V,
      env: { [V]: "true" },
      now: NOW,
      logger: null,
    });
    record(
      "認証情報（SUPABASE_URL・SUPABASE_SERVICE_KEY）なし・client未指定 → 実行（DBを読めない）",
      d5.skip === false && d5.reason === "no_credentials",
      show(d5),
    );
    const d6 = await mod.shouldSkipOnGha({
      varName: V,
      env: {
        [V]: "true",
        SUPABASE_URL: "not a url",
        SUPABASE_SERVICE_KEY: "k",
      },
      now: NOW,
      logger: null,
    });
    record(
      "SUPABASE_URL が不正 → 実行（例外にしない）",
      d6.skip === false,
      show(d6),
    );
    // ログ
    const lines = [];
    await mod.shouldSkipOnGha({
      varName: V,
      env,
      client: fakeClient(good),
      now: NOW,
      logger: { log: (l) => lines.push(l) },
    });
    await mod.shouldSkipOnGha({
      varName: V,
      env,
      client: fakeClient([]),
      now: NOW,
      logger: { log: (l) => lines.push(l) },
    });
    record(
      "判定結果と理由をログに出す（スキップ: Vercel健全・最終起動N分前／実行: 理由）",
      lines.length === 2 &&
        /^\[gha-skip\] SKIP_ODDS_ON_GHA: スキップ: Vercelが健全（odds: live・最終起動1分前/.test(
          lines[0],
        ) &&
        /^\[gha-skip\] SKIP_ODDS_ON_GHA: 実行: odds: ジョブ状態の行なし/.test(
          lines[1],
        ),
      show(lines),
    );
  }

  // ---- (g) 待機 ----
  {
    const V = "SKIP_POINT_RANK_ON_GHA";
    const env = { [V]: "true" };
    let now = jst("2026-09-24 22:01");
    let sleeps = 0;
    const clock = () => new Date(now);
    const sleep = async (ms) => {
      sleeps++;
      now = new Date(now.getTime() + ms);
    };
    // Vercel が 22:02:30 に処理を完了する
    const client = {
      async readJobStates() {
        return [
          row("point_rank", {
            last_target_date:
              now >= jst("2026-09-24 22:02") &&
              now.getTime() >= jst("2026-09-24 22:02").getTime() + 30000
                ? "2026-09-24"
                : "2026-09-23",
          }),
        ];
      },
    };
    const d1 = await mod.shouldSkipOnGhaWaiting(
      { varName: V, env, client, logger: null },
      { sleep, nowFn: clock },
    );
    record(
      "待機: 22:01に未処理 → 30秒おきに再判定し、Vercelが完了したらスキップ",
      d1.skip === true && sleeps >= 2 && sleeps <= 4,
      show({ d1: d1.reason, sleeps }),
    );
    now = jst("2026-09-24 22:01");
    sleeps = 0;
    const never = {
      async readJobStates() {
        return [row("point_rank", { last_target_date: "2026-09-23" })];
      },
    };
    const d2 = await mod.shouldSkipOnGhaWaiting(
      { varName: V, env, client: never, logger: null },
      { sleep, nowFn: clock },
    );
    record(
      "待機: 完了しなければ、指定時刻から10分で待機を打ち切り、実行（フェイルオーバー）。無限に待たない",
      d2.skip === false && sleeps >= 15 && sleeps <= 20,
      show({ d2: d2.reason, sleeps, at: now.toISOString() }),
    );
    sleeps = 0;
    const shadow = {
      async readJobStates() {
        return [row("point_rank", { mode: "shadow" })];
      },
    };
    const d3 = await mod.shouldSkipOnGhaWaiting(
      { varName: V, env, client: shadow, logger: null },
      { sleep, nowFn: clock },
    );
    record(
      "待機: mode=shadow（待っても変わらない） → 待たずに実行",
      d3.skip === false && sleeps === 0,
    );
    sleeps = 0;
    const d4 = await mod.shouldSkipOnGhaWaiting(
      {
        varName: V,
        env: { [V]: "false" },
        client: throwingClient(),
        logger: null,
      },
      { sleep, nowFn: clock },
    );
    record(
      "待機: 変数が false → 待たず・DBも読まず実行",
      d4.skip === false && sleeps === 0,
    );
    sleeps = 0;
    now = jst("2026-09-24 22:01");
    const d5 = await mod.shouldSkipOnGhaWaiting(
      { varName: V, env, client: never, logger: null },
      { sleep, nowFn: clock, maxPolls: 3 },
    );
    record(
      "待機: 再判定の回数に上限がある（maxPolls）",
      d5.skip === false && sleeps === 3,
      show({ sleeps }),
    );
  }

  // ---- (h) RESTクライアント ----
  {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 200, json: async () => [{ job: "odds" }] };
    };
    const client = mod.createRestJobStateClient({
      url: "https://example.supabase.co",
      key: "SERVICE_KEY",
      fetchImpl,
      timeoutMs: 1000,
    });
    const rows = await client.readJobStates(["odds", "host:boatrace.jp"]);
    const u = new URL(calls[0].url);
    record(
      "RESTクライアント: scrape_job_state から、指定したジョブの行だけを、service_role のキーで読む（select は必要な列のみ）",
      show(rows) === show([{ job: "odds" }]) &&
        u.origin === "https://example.supabase.co" &&
        u.pathname === "/rest/v1/scrape_job_state" &&
        u.searchParams.get("job") === 'in.("odds","host:boatrace.jp")' &&
        u.searchParams.get("select") ===
          "job,mode,last_tick_at,last_success_at,consecutive_failures,last_target_date,breaker_open_until" &&
        calls[0].init.headers.apikey === "SERVICE_KEY" &&
        calls[0].init.headers.Authorization === "Bearer SERVICE_KEY" &&
        calls[0].init.signal instanceof AbortSignal &&
        !("method" in calls[0].init && calls[0].init.method !== "GET"),
      show({ url: calls[0].url, headers: Object.keys(calls[0].init.headers) }),
    );
    let threw = "";
    try {
      await mod
        .createRestJobStateClient({
          url: "https://x.supabase.co",
          key: "k",
          fetchImpl: async () => ({
            ok: false,
            status: 503,
            json: async () => ({}),
          }),
        })
        .readJobStates(["odds"]);
    } catch (e) {
      threw = e.message;
    }
    let threw2 = "";
    try {
      await mod
        .createRestJobStateClient({
          url: "https://x.supabase.co",
          key: "k",
          fetchImpl: async () => ({
            ok: true,
            status: 200,
            json: async () => ({ message: "x" }),
          }),
        })
        .readJobStates(["odds"]);
    } catch (e) {
      threw2 = e.message;
    }
    record(
      "RESTクライアント: HTTPエラー・配列でない応答は、例外（判定側が「実行」にする）",
      /503/.test(threw) && /配列/.test(threw2),
      show({ threw, threw2 }),
    );
    const d = await mod.shouldSkipOnGha({
      varName: "SKIP_ODDS_ON_GHA",
      env: {
        SKIP_ODDS_ON_GHA: "true",
        SUPABASE_URL: "https://x.supabase.co",
        SUPABASE_SERVICE_KEY: "k",
      },
      now: new Date(),
      logger: null,
      client: mod.createRestJobStateClient({
        url: "https://x.supabase.co",
        key: "k",
        fetchImpl: async () => {
          throw new TypeError("fetch failed");
        },
      }),
    });
    record(
      "RESTクライアント経由でネットワーク失敗（fetch failed） → 実行",
      d.skip === false && d.reason === "read_failed",
      show(d),
    );
    record(
      "jobKeysFor: 対象ジョブと、その取得先ホストのブレーカー行だけ（ホストの無いジョブは、ジョブの行のみ）",
      show(mod.jobKeysFor("SKIP_ODDS_ON_GHA")) ===
        show(["odds", "host:boatrace.jp"]) &&
        show(mod.jobKeysFor("SKIP_KFILE_ON_GHA")) ===
          show(["kfile_sync", "host:mbrace.or.jp"]) &&
        show(mod.jobKeysFor("SKIP_ENTRY_COURSE_ON_GHA")) ===
          show(["entry_course_stats"]) &&
        show(mod.jobKeysFor("UNKNOWN")) === show([]),
    );
  }
}

// ---------------------------------------------------------------------------
// 変異検証用: 壊したコピーを作って読み込む
// ---------------------------------------------------------------------------
const SOURCE = fs.readFileSync(path.join(LIB_DIR, "ghaSkipGate.js"), "utf8");
const MUTANT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gha-skip-mutants-"));

async function loadMutant(name, replace, by) {
  const found =
    replace instanceof RegExp ? replace.test(SOURCE) : SOURCE.includes(replace);
  if (!found) {
    throw new Error(`変異の対象が見つかりません（${name}）: ${replace}`);
  }
  const mutated = SOURCE.replace(replace, by).replaceAll(
    'from "./scrapeJobs/',
    `from "${pathToFileURL(path.join(LIB_DIR, "scrapeJobs")).href}/`,
  );
  const file = path.join(MUTANT_DIR, `${name}.mjs`);
  fs.writeFileSync(file, mutated);
  return import(pathToFileURL(file).href);
}

const MUTANTS = [
  ["modeの確認を外す", 'if (row.mode !== "live") {', "if (false) {"],
  [
    "起動の鮮度の確認を外す",
    "if (tickAge < -1 || tickAge >= policy.tickMaxAgeMin) {",
    "if (false) {",
  ],
  ["時計の異常（未来の起動）を許す", "tickAge < -1 || ", ""],
  [
    "連続失敗の確認を外す",
    "if (failures >= policy.maxConsecutiveFailures) {",
    "if (false) {",
  ],
  [
    "ブレーカーの確認を外す（窓型。最初の if (host)）",
    "if (host)",
    "if (false)",
  ],
  [
    "日次: 対象日でなく、何か処理済みならよいことにする",
    "if (done && done >= target) {",
    "if (done) {",
  ],
  [
    "日次: 前日分までを健全とみなす（対象日を1日戻す）",
    "const target = resolveTargetDate(now, def.targetTimeJst);",
    "const target = resolveTargetDate(new Date(now.getTime() - 86400000), def.targetTimeJst);",
  ],
  [
    "チャンク: 指定時刻より前の成功を許す",
    "success >= targetInstant &&",
    "true &&",
  ],
  [
    "チャンク: 成功の鮮度を見ない",
    "minutesSince(success, nowMs) < policy.chunkProgressMaxAgeMin",
    "true",
  ],
  [
    "読み取り失敗を「スキップ」にする",
    /return run\(\s*"read_failed",\s*`Vercelの状態を読み取れない[^`]*`,?\s*\);/,
    'return finish({ skip: true, reason: "read_failed", message: "スキップ", retryable: false, results: [] });',
  ],
  [
    "タイムアウトを外す",
    "return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));",
    "clearTimeout(timer); return promise;",
  ],
  [
    "全ジョブでなく、1つでも健全ならスキップする",
    "if (unhealthy.length === 0) {",
    "if (unhealthy.length < results.length) {",
  ],
  [
    "変数が false でもDBを読む（既定でDBを読まない、を外す）",
    "if (!isTrue(env[varName])) {",
    "if (false) {",
  ],
  [
    "応答が配列でなくても、空として扱わず例外にせず、スキップ扱いにする（行の検証を外す）",
    'if (!row) return bad("no_row", `${job}: ジョブ状態の行なし`);',
    'if (!row) return good("no_row", `${job}`);',
  ],
  [
    "待機の上限を外す（常に retryable）",
    "sinceTargetMin >= 0 &&\n      sinceTargetMin < policy.dailyWaitGraceMin;",
    "true;",
  ],
];

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------
let failures = 0;
const record = (label, pass, detail = "") => {
  if (pass) {
    printOut(`✅ ${label}`);
  } else {
    failures++;
    printErr(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
};

await suite(realGate, record);

// (i) CLI
{
  const out = path.join(MUTANT_DIR, "github-output");
  const run = async (argv, env) => {
    fs.writeFileSync(out, "");
    const logs = [];
    const orig = console.log;
    console.log = (...a) => logs.push(a.join(" "));
    let skip;
    try {
      skip = await gateMain(argv, { GITHUB_OUTPUT: out, ...env });
    } finally {
      console.log = orig;
    }
    return { skip, output: fs.readFileSync(out, "utf8"), logs };
  };
  const r1 = await run(["SKIP_POINT_RANK_ON_GHA", "--wait"], {});
  record(
    "CLI: 変数が未設定 → skip=false を GITHUB_OUTPUT に書く（DBを読まない）",
    r1.skip === false && r1.output === "skip=false\n",
    show(r1),
  );
  const r2 = await run(["SKIP_POINT_RANK_ON_GHA"], {
    SKIP_POINT_RANK_ON_GHA: "true",
  });
  record(
    "CLI: 変数が true・認証情報なし → skip=false（DBを読めない）",
    r2.skip === false && r2.output === "skip=false\n",
    show(r2),
  );
  const r3 = await run(["NOT_A_VAR"], {});
  const r4 = await run([], {});
  record(
    "CLI: 未知の変数・引数なし → skip=false",
    r3.output === "skip=false\n" && r4.output === "skip=false\n",
  );
  const r5 = await gateMain(["SKIP_POINT_RANK_ON_GHA"], {
    SKIP_POINT_RANK_ON_GHA: "true",
    GITHUB_OUTPUT: path.join(MUTANT_DIR, "no-such-dir", "x"),
  });
  record(
    "CLI: GITHUB_OUTPUT に書けなくても、例外にせず skip=false",
    r5 === false,
  );
}

// (j) 配線
{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const vercel = JSON.parse(read("vercel.json"));
  const targets = realGate.GHA_SKIP_TARGETS;
  record(
    "配線: 対象の全ジョブが、レジストリの窓型・日次ジョブ（判定できる種類）",
    Object.values(targets)
      .flat()
      .every((j) => ["window", "daily"].includes(SCRAPE_JOBS[j]?.kind)),
  );
  record(
    "配線: 予測リフレッシュ（SKIP_ODDS_REFRESH_ON_GHA）と展示（SKIP_EXHIBITION_ON_GHA）は対象外（DBのジョブ状態で判定できない）",
    !("SKIP_ODDS_REFRESH_ON_GHA" in targets) &&
      !("SKIP_EXHIBITION_ON_GHA" in targets),
  );
  // 日次ワークフロー: gate ジョブ・変数・ジョブ名の対応
  const wf = {
    "scrape-point-rank.yml": "SKIP_POINT_RANK_ON_GHA",
    "scrape-venue-entry-course-stats.yml": "SKIP_ENTRY_COURSE_ON_GHA",
    "scrape-venue-motor-stats.yml": "SKIP_MOTOR_STATS_ON_GHA",
    "collect-racer-news.yml": "SKIP_RACER_NEWS_ON_GHA",
    "scrape-racer-season-stats.yml": "SKIP_RACER_SEASON_ON_GHA",
  };
  let wfOk = true;
  const wfDetail = [];
  for (const [file, varName] of Object.entries(wf)) {
    const yml = read(`.github/workflows/${file}`);
    const ok =
      varName in targets &&
      yml.includes(`if: \${{ vars.${varName} == 'true' }}`) &&
      yml.includes(
        `run: node scripts/maintenance/gha-skip-gate.js ${varName} --wait`,
      ) &&
      yml.includes("skip: ${{ steps.gate.outputs.skip }}") &&
      yml.includes("needs: gate") &&
      yml.includes(
        "if: ${{ !cancelled() && needs.gate.outputs.skip != 'true' }}",
      ) &&
      /SUPABASE_URL: \$\{\{ secrets\.SUPABASE_URL \}\}/.test(
        yml.split("Check whether Vercel handles this job")[1] ?? "",
      ) &&
      /SUPABASE_SERVICE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_KEY \}\}/.test(
        yml.split("Check whether Vercel handles this job")[1] ?? "",
      ) &&
      /steps:\s+- uses: actions\/checkout@v4\s+- uses: actions\/setup-node@v4\s+with:\s+node-version: '22'\s+- name: Check whether Vercel handles this job\s+id: gate\s+continue-on-error: true/.test(
        yml,
      ) &&
      !yml.includes(`vars.${varName} != 'true'`);
    if (!ok) {
      wfOk = false;
      wfDetail.push(file);
    }
  }
  record(
    "配線: 日次5ワークフロー: 変数が true のときだけ gate（checkout・node・判定。npm ci なし・continue-on-error）が動き、取得ジョブは、未設定・false・gateの失敗でも実行、gateがスキップと判定したときだけ止まる",
    wfOk,
    show(wfDetail),
  );
  const sched = read("scripts/daily/scrape-scheduled.js");
  record(
    "配線: scrape-scheduled.js は、SKIP変数がtrueかを先に確認してから（&&の左）Vercelの健全性を確認する。展示（SKIP_EXHIBITION_ON_GHA）は従来の静的な判定のまま",
    /import \{ shouldSkipOnGha \} from "\.\.\/lib\/ghaSkipGate\.js";/.test(
      sched,
    ) &&
      /isOddsSkippedOnGha\(\) && \(!oddsDue \|\| \(await gateSkips\("SKIP_ODDS_ON_GHA"\)\)\)/.test(
        sched,
      ) &&
      /process\.env\.SKIP_RESULTS_ON_GHA === "true" &&\s*\(!resultsDue/.test(
        sched,
      ) &&
      /process\.env\.SKIP_KFILE_ON_GHA === "true" &&\s*\(!resultsDue/.test(
        sched,
      ) &&
      /hasExhibitionRaces && process\.env\.SKIP_EXHIBITION_ON_GHA !== "true"/.test(
        sched,
      ) &&
      !/SKIP_ODDS_REFRESH_ON_GHA"\)/.test(sched),
  );
  const cronOf = (p) =>
    vercel.crons.filter((c) => c.path === p).map((c) => c.schedule);
  record(
    "配線: 窓型ジョブ（odds・result）のVercel Cronは毎分。tick（5分に1回書く）が、運用窓の中で12分以内に更新される前提が成り立つ",
    cronOf("/api/cron/odds").every((s) => s.startsWith("* ")) &&
      cronOf("/api/cron/result").every((s) => s.startsWith("* ")) &&
      realGate.GHA_SKIP_POLICY.tickMaxAgeMin === 12,
    show(cronOf("/api/cron/odds")),
  );
}

// (k) 変異検証
{
  const mutantResults = [];
  for (const [name, replace, by] of MUTANTS) {
    let killed = false;
    let mutantLoadError = "";
    try {
      const mod = await loadMutant(`m${mutantResults.length}`, replace, by);
      let failed = 0;
      try {
        // 変異により、応答しないDBを待ち続ける（タイムアウトの欠落）場合も、検出として扱う
        let timer;
        await Promise.race([
          suite(mod, (_label, pass) => {
            if (!pass) failed++;
          }),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("suite が終わらない")),
              8000,
            );
          }),
        ]).finally(() => clearTimeout(timer));
      } catch {
        failed++; // 変異したモジュールが例外を投げた場合も、検出とみなす
      }
      killed = failed > 0;
    } catch (error) {
      mutantLoadError = error.message;
    }
    mutantResults.push([name, killed, mutantLoadError]);
  }
  for (const [name, killed, loadError] of mutantResults) {
    record(
      `変異検証: 「${name}」を入れたコピーで、この検証が失敗する（検出できる）`,
      killed,
      loadError || "検出されなかった",
    );
  }
}

fs.rmSync(MUTANT_DIR, { recursive: true, force: true });

if (failures > 0) {
  printErr(`\n❌ ${failures}件の検証に失敗`);
  process.exit(1);
}
printOut("\nALL PASS");
