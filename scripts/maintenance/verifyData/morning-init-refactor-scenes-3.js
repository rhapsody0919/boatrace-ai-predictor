/**
 * verify-morning-init-refactor.js の後半の場面（3/3）。verify ではない。
 * 判定と期待値は分ける前の verify-morning-init-refactor.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  parsePcexpect,
  computePcexpectDigest,
  buildUrl,
  runForRaces as runPcexpect,
} from "../../daily/scrape-pcexpect.js";
import { BreakerOpenError } from "../../lib/scrapeJobs/circuitBreaker.js";
import { createFakeSupabaseClient } from "../../lib/scrapeJobs/testing/fakeSupabaseClient.js";

let out, check, show, same, sleep, rejects, fixture, DATE;

/** 元の verify の1つの塊 { } を割った 1/3 */
async function scene1() {
  const html = fixture("pcexpect-12-12.html");
  const payload = parsePcexpect(html);
  check(
    "(d) 実ページ（2026-09-21 住之江12R）の解析: 2連単4点・3連単6点・自信度2",
    payload &&
      payload.focus_2t.length === 4 &&
      payload.focus_3t.length === 6 &&
      payload.confidence === 2 &&
      payload.focus_2t[0].pattern === "4=3",
    show(payload),
  );
  check(
    "(d) 解析結果のダイジェストが、本番DB（external_predictions.payload、朝02:25に保存）と同じ値になる",
    computePcexpectDigest(payload) === "c2ada2c442417b09",
    computePcexpectDigest(payload),
  );
  const reordered = {
    confidence: payload.confidence,
    entry_prediction_image: payload.entry_prediction_image,
    focus_3t: payload.focus_3t.map((x) => ({
      pattern: x.pattern,
      seps: x.seps,
    })),
    focus_2t: payload.focus_2t.map((x) => ({
      pattern: x.pattern,
      seps: x.seps,
    })),
  };
  check(
    "(d) ダイジェストは、JSON のキーの並びに依らない（DB の jsonb と同じ値になる）",
    computePcexpectDigest(reordered) === computePcexpectDigest(payload),
  );
  check(
    "(d) 予想の無いページ（データなし）は null",
    parsePcexpect("<html><body><p>データがありません</p></body></html>") ===
      null,
  );
  check(
    "(d) URL: hd・jcd（2桁）・rno",
    buildUrl({ date: DATE, venueCode: 1, raceNo: 12 }) ===
      "https://www.boatrace.jp/owpc/pc/race/pcexpect?hd=20260921&jcd=01&rno=12",
  );
  const race = {
    race_id: "2026-09-21-12-12",
    venue_code: 12,
    race_number: 12,
    start_time: new Date("2026-09-21T20:30:00+09:00"),
  };
  const shadowClient = createFakeSupabaseClient();
  const [shadow] = await runPcexpect([race], {
    date: DATE,
    mode: "shadow",
    fetchHtml: async () => html,
    client: shadowClient,
  });
  check(
    "(d) shadow: 取得・解析のみ。DBへは何も書かず（接続もせず）、payload のダイジェストを返す",
    shadow.outcome === "ok" &&
      shadow.rowsWritten === 0 &&
      shadow.rowsParsed === 1 &&
      shadow.resultDigest === "c2ada2c442417b09" &&
      shadowClient.calls.length === 0,
    show({ ...shadow, payload: undefined }),
  );
  const liveClient = createFakeSupabaseClient();
  const fixedNow = new Date("2026-09-21T05:00:00Z");
  return { html, payload, race, liveClient, fixedNow };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
async function scene2({ html, payload, race, liveClient, fixedNow }) {
  const [live] = await runPcexpect([race], {
    date: DATE,
    mode: "live",
    fetchHtml: async () => html,
    client: liveClient,
    now: () => fixedNow,
  });
  const row = liveClient.data.external_predictions?.[0];
  check(
    "(d) live: external_predictions へ1行 upsert（source・日付・会場・レース・race_start_at・scraped_at）",
    live.outcome === "ok" &&
      live.rowsWritten === 1 &&
      liveClient.data.external_predictions.length === 1 &&
      row.source === "pcexpect_official" &&
      row.race_date === DATE &&
      row.venue_code === 12 &&
      row.race_no === 12 &&
      row.race_start_at === "2026-09-21T11:30:00.000Z" &&
      row.scraped_at === fixedNow.toISOString() &&
      same(row.payload, payload),
    show(row),
  );
  await runPcexpect([race], {
    date: DATE,
    mode: "live",
    fetchHtml: async () => html,
    client: liveClient,
  });
  check(
    "(d) 同じレースの再取得は、同じ行を更新する（一意制約 source,race_date,venue_code,race_no。行は増えない）",
    liveClient.data.external_predictions.length === 1,
  );
  const emptyClient = createFakeSupabaseClient();
  const [empty] = await runPcexpect([race], {
    date: DATE,
    mode: "live",
    fetchHtml: async () => "<html><body></body></html>",
    client: emptyClient,
  });
  check(
    "(d) 予想が無いページ: no_values（再試行）。書き込まない",
    empty.outcome === "no_values" && emptyClient.writes.length === 0,
  );
  const [failed] = await runPcexpect([race], {
    date: DATE,
    mode: "shadow",
    fetchHtml: async () => {
      throw new Error("HTTP 503");
    },
  });
  check(
    "(d) 取得の失敗: error（メッセージ付き）",
    failed.outcome === "error" && /503/.test(failed.error),
  );
  const until = Date.now() + 60_000;
  const [breaker] = await runPcexpect([race], {
    date: DATE,
    mode: "shadow",
    fetchHtml: async () => {
      throw new BreakerOpenError("host:boatrace.jp", until);
    },
  });
  check(
    "(d) ブレーカーが開いている: breaker_open（ブレーカーが閉じる時刻まで再試行を遅らせる）",
    breaker.outcome === "breaker_open" && breaker.retryAt.getTime() === until,
  );
  const errWriteClient = createFakeSupabaseClient({
    failOn: { "external_predictions:upsert": "boom-ep" },
  });
  return { html, race, errWriteClient };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
async function scene3({ html, race, errWriteClient }) {
  const [writeFail] = await runPcexpect([race], {
    date: DATE,
    mode: "live",
    fetchHtml: async () => html,
    client: errWriteClient,
  });
  check(
    "(d) 書き込みの失敗: error（成功にしない）",
    writeFail.outcome === "error" && /boom-ep/.test(writeFail.error),
    writeFail.error,
  );
  const badMode = await rejects(
    runPcexpect([race], { date: DATE, mode: "dry" }),
  );
  const noClientLive = await rejects(
    runPcexpect([race], {
      date: DATE,
      mode: "live",
      client: null,
      fetchHtml: async () => html,
    }),
  );
  check(
    "(d) mode が不正・live で Supabase が無ければ例外",
    badMode !== null && noClientLive !== null,
  );
  // 複数レース: 1つの失敗で他を止めない・並列度
  const many = Array.from({ length: 6 }, (_, i) => ({
    race_id: `2026-09-21-12-${String(i + 1).padStart(2, "0")}`,
    venue_code: 12,
    race_number: i + 1,
  }));
  let active = 0;
  let maxActive = 0;
  const results = await runPcexpect(many, {
    date: DATE,
    mode: "shadow",
    concurrency: 3,
    fetchHtml: async (url) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await sleep(5);
      active--;
      if (url.includes("rno=2")) throw new Error("HTTP 500");
      return html;
    },
  });
  check(
    "(d) 6レース・並列3: 1レース失敗でも他は完了。結果は入力の順。同時実行は3まで",
    results.map((x) => x.outcome).join(",") === "ok,error,ok,ok,ok,ok" &&
      maxActive === 3 &&
      results.every((x, i) => x.race_id === many[i].race_id),
    `${results.map((x) => x.outcome).join(",")} max=${maxActive}`,
  );
}

async function scene4() {
  {
    const s1 = await scene1();
    const s2 = await scene2(s1);
    await scene3(s2);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（out・check・show・same・sleep・rejects・fixture・DATE） */
export async function runMorningInitRefactorScenes3(env) {
  ({ out, check, show, same, sleep, rejects, fixture, DATE } = env);
  await scene4();
}

function scene5() {
  out.log("\n✅ 全ての検証に合格しました");
}

/** verify から呼ぶ入口。env は verify 側の束縛（out・check・show・same・sleep・rejects・fixture・DATE） */
export function runMorningInitRefactorScenes4(env) {
  ({ out, check, show, same, sleep, rejects, fixture, DATE } = env);
  scene5();
}
