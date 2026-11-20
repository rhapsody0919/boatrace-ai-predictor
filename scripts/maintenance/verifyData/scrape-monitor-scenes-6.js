/**
 * verify-scrape-monitor.js の後半の場面（6/8）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-monitor.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  livenessCheckable,
  evaluateJobStates,
  applyDedupe,
  formatAlertMessage,
} from "../../lib/scrapeJobs/monitor.js";

let check, show, at, iso;

/** 元の verify の1つの塊 { } を割った 1/3 */
function scene1() {
  const now = at("12:00");
  const minAgo = (m) => iso(new Date(now.getTime() - m * 60000));
  const base = (over) => ({
    mode: "live",
    consecutive_failures: 0,
    last_error: null,
    last_tick_at: minAgo(1),
    ...over,
  });
  const kinds = (rows, when = now) =>
    evaluateJobStates(rows, when).map(
      (a) => `${a.kind}:${a.key.split(":")[1]}`,
    );
  check("正常なジョブは通知なし", kinds([base({ job: "odds" })]).length === 0);
  check(
    "死活: last_tick_at が10分以上前で通知（9分前は通知しない）",
    show(kinds([base({ job: "odds", last_tick_at: minAgo(10) })])) ===
      '["liveness:odds"]' &&
      kinds([base({ job: "odds", last_tick_at: minAgo(9) })]).length === 0,
  );
  check(
    "死活: last_tick_at が未記録（有効化したのに一度も起動していない）でも通知",
    show(kinds([base({ job: "odds", last_tick_at: null })])) ===
      '["liveness:odds"]',
  );
  check(
    "死活: mode=off のジョブは判定しない（誤報なし）",
    kinds([base({ job: "odds", mode: "off", last_tick_at: null })]).length ===
      0,
  );
  check(
    "死活: 運用窓の開始直後（07:00〜07:09）と窓の外（00:30）は判定しない",
    kinds([base({ job: "odds", last_tick_at: minAgo(600) })], at("07:05"))
      .length === 0 &&
      kinds(
        [base({ job: "odds", last_tick_at: minAgo(600) })],
        at("00:30", "2026-09-20"),
      ).length === 0 &&
      kinds([base({ job: "odds", last_tick_at: minAgo(600) })], at("07:10"))
        .length === 1 &&
      livenessCheckable(at("23:59")) &&
      !livenessCheckable(at("06:59")),
  );
  check(
    "死活: 10分ごとの常駐型（race_status）も判定する。25分以上前で通知、24分前は通知しない（BOA-373）。race_notices は 2026-10-03 から日次（夜1回）なので、死活では判定しない",
    show(
      kinds([
        // race_notices は日次。前日（指定 22:30 から解決した対象日）は処理済みなので、何も通知しない
        base({
          job: "race_notices",
          last_tick_at: minAgo(25),
          last_target_date: "2026-09-18",
        }),
        base({ job: "race_status", last_tick_at: minAgo(25) }),
      ]),
    ) === '["liveness:race_status"]' &&
      kinds([base({ job: "race_status", last_tick_at: minAgo(24) })]).length ===
        0 &&
      kinds([base({ job: "race_status", mode: "off", last_tick_at: null })])
        .length === 0,
  );
  return { now, minAgo, base, kinds };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
function scene2({ now, minAgo, base, kinds }) {
  check(
    "死活: 常駐型は、朝の初回（07:00）が1回届かないだけでは通知しない。07:24 は判定せず、07:25 から判定する（BOA-373）",
    kinds(
      [
        base({
          job: "race_status",
          last_tick_at: "2026-09-18T14:50:00.000Z", // 前日 23:50 JST
        }),
      ],
      at("07:24"),
    ).length === 0 &&
      show(
        kinds(
          [
            base({
              job: "race_status",
              last_tick_at: "2026-09-18T14:50:00.000Z",
            }),
          ],
          at("07:25"),
        ),
      ) === '["liveness:race_status"]',
  );
  check(
    "死活: 日次ジョブは last_tick_at の古さでは通知しない（期限超過の判定は別）",
    kinds([base({ job: "kfile_sync", last_tick_at: minAgo(600) })]).every(
      (k) => !k.startsWith("liveness:"),
    ),
  );
  check(
    "連続失敗: 成功フックで動く prediction_odds（registry に無い）も通知する。死活は見ない。off は通知しない（BOA-645）",
    show(
      kinds([
        base({
          job: "prediction_odds",
          consecutive_failures: 3,
          last_error: "x",
          last_tick_at: null,
        }),
      ]),
    ) === '["failures:prediction_odds"]' &&
      kinds([
        base({
          job: "prediction_odds",
          mode: "off",
          consecutive_failures: 5,
          last_error: "x",
        }),
      ]).length === 0,
  );
  check(
    "連続失敗: 3回以上で通知（2回は通知しない）",
    show(
      kinds([base({ job: "odds", consecutive_failures: 3, last_error: "x" })]),
    ) === '["failures:odds"]' &&
      kinds([base({ job: "odds", consecutive_failures: 2 })]).length === 0,
  );
  check(
    "0件エラー: last_error に『0件』を含む失敗中のジョブを通知",
    kinds([
      base({
        job: "odds",
        consecutive_failures: 1,
        last_error: "期待件数が6件なのに、解析できた行が0件でした",
      }),
    ]).includes("zero_rows:odds"),
  );
  check(
    "0件エラー: 『10件』『20件』のような他の数字の末尾の0は、0件エラーとみなさない",
    !kinds([
      base({
        job: "odds",
        consecutive_failures: 1,
        last_error: "期待10件のうち20件を解析",
      }),
    ]).includes("zero_rows:odds"),
  );
  return { now, minAgo, kinds };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
function scene3({ now, minAgo, kinds }) {
  check(
    "ブレーカー: 開いているホストを通知（期限を過ぎていれば通知しない）",
    show(
      kinds([
        {
          job: "host:boatrace.jp",
          mode: "off",
          breaker_open_until: iso(new Date(now.getTime() + 30000)),
          last_error: "HTTP 429",
        },
      ]),
    ) === '["breaker:host"]' &&
      kinds([
        { job: "host:boatrace.jp", mode: "off", breaker_open_until: minAgo(1) },
      ]).length === 0,
  );
  check(
    "監視・保守のジョブ（モードのゲートなし）も、連続失敗を通知する",
    kinds([
      {
        job: "scrape-monitor",
        mode: "off",
        consecutive_failures: 3,
        last_error: "Slack",
      },
    ]).length === 1,
  );
  // 日次ジョブの期限超過（point_rank は 22:00 指定。3時間後の 01:00 以降で未処理なら通知）
  const daily = (over) => ({
    job: "point_rank",
    mode: "live",
    consecutive_failures: 0,
    last_target_date: "2026-09-18",
    ...over,
  });
  const overdueNow = at("01:05", "2026-09-20");
   // 対象日 2026-09-19 の 22:00 から 3時間5分
  check(
    "日次: 指定時刻から3時間を過ぎても対象日が未処理なら通知",
    evaluateJobStates([daily({})], overdueNow).some(
      (a) =>
        a.kind === "daily_overdue" &&
        a.key === "daily_overdue:point_rank:2026-09-19",
    ),
  );
  check(
    "日次: 対象日を処理済みなら通知しない。3時間以内でも通知しない。shadow では通知しない",
    evaluateJobStates([daily({ last_target_date: "2026-09-19" })], overdueNow)
      .length === 0 &&
      evaluateJobStates([daily({})], at("23:30")).filter(
        (a) => a.kind === "daily_overdue",
      ).length === 0 &&
      evaluateJobStates([daily({ mode: "shadow" })], overdueNow).length === 0,
  );
}

function scene4() {
  {
    const s1 = scene1();
    const s2 = scene2(s1);
    scene3(s2);
  }
  // ---------------------------------------------------------------------------
  // (d) 重複抑制
  // ---------------------------------------------------------------------------
  {
    const now = at("12:00");
    const a = (key) => ({ key, kind: key.split(":")[0], text: key });
    let r = applyDedupe([a("expired:odds:r1:-60"), a("liveness:odds")], {}, now);
    check("初回はすべて送る", r.toSend.length === 2);
    const later = (h) => new Date(now.getTime() + h * 3600 * 1000);
    const r2 = applyDedupe(
      [a("expired:odds:r1:-60"), a("liveness:odds")],
      r.notified,
      later(1),
    );
    check("1時間後: 同じ内容は再通知しない", r2.toSend.length === 0);
    const r3 = applyDedupe(
      [a("expired:odds:r1:-60"), a("liveness:odds")],
      r2.notified,
      later(7),
    );
    check(
      "7時間後: 持続する状態（死活）は再通知するが、expired・未実行は再通知しない",
      r3.toSend.length === 1 && r3.toSend[0].key === "liveness:odds",
      show(r3.toSend.map((x) => x.key)),
    );
    const r4 = applyDedupe(
      [],
      { "old:key": iso(later(-100)), "new:key": iso(later(-1)) },
      now,
    );
    check(
      "72時間より古い記録は削除される",
      !("old:key" in r4.notified) && "new:key" in r4.notified,
    );
    const { message: msg, includedCount } = formatAlertMessage([a("x")], now);
    check(
      "アラートのメッセージ: 件数と内容を含み、絵文字を使わない",
      /1件の異常/.test(msg.text) &&
        includedCount === 1 &&
        /・x/.test(msg.attachments[0].blocks[0].text.text) &&
        !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(show(msg)),
    );
    // 多数のアラート: 本文の予算内に収め、載せなかった分は「ほかN件」にする
    const many = Array.from({ length: 200 }, (_, i) =>
      a(`expired:odds:2026-09-19-01-${i}:-60`),
    ).map((x) => ({ ...x, text: `${x.key} `.padEnd(120, "x") }));
    const big = formatAlertMessage(many, now);
    const bigText = big.message.attachments[0].blocks[0].text.text;
    check(
      "アラートが多数でも、本文は3000字以内に収め、載せなかった件数を明記する",
      bigText.length <= 3000 &&
        big.includedCount > 0 &&
        big.includedCount < 200 &&
        new RegExp(`ほか${200 - big.includedCount}件`).test(bigText),
      `${bigText.length}字、載せた${big.includedCount}件`,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・at・iso） */
export function runScrapeMonitorScenes6(env) {
  ({ check, show, at, iso } = env);
  scene4();
}
