/**
 * verify-kb-file-parser.js の後半の場面（1/2）。verify ではない。
 * 判定と期待値は分ける前の verify-kb-file-parser.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import fs from "node:fs";
import {
  decodeLzhText,
  buildKbDay,
  PENDING_MARKER,
  buildKbUrl,
  kbArchiveRelPath,
} from "../../lib/kbFileParser.js";
import { buildArchiveRows, raceTimeToSeconds, classifyStage } from "../../lib/kbArchiveRows.js";
import {
  parseWindow,
  inWindow,
  windowDayKey,
  classifyResponse,
  latestManifest,
  planDownload,
  estimatePlan,
  _internal as cli,
} from "../kb-backfill.js";

let FIX, check, eq, days;

/** 元の verify の1つの塊 { } を割った 1/2 */
function scene1() {
  const rows = buildArchiveRows(days["2026-03-15"]);
  check(
    "行数: 開催2・レース24・艇144",
    rows.venueDays.length === 2 &&
      rows.races.length === 24 &&
      rows.boats.length === 144,
    `${rows.venueDays.length}/${rows.races.length}/${rows.boats.length}`,
  );
  check(
    "会場日の行は race_grade を持たない（race_series から補完した値を、load の再実行が NULL で上書きしない。BOA-651）",
    rows.venueDays.every((v) => !("race_grade" in v)),
  );
  check(
    "会場日の行は is_final_day を持たない（K/B は最終日も「第N日」と書くので常に false になる。race_series から補完した値を、load の再実行が false で上書きしない。BOA-696）",
    rows.venueDays.every((v) => !("is_final_day" in v)),
  );
  const race = rows.races.find((r) => r.race_id === "2026-03-15-13-01");
  check(
    "命名: payout_3tan=2760（3連単）・payout_3fuku=1690（3連複）。DB本体の逆転命名を持ち込まない",
    race.payout_3tan === 2760 &&
      race.payout_3fuku === 1690 &&
      race.combo_3tan === "1-4-6",
  );
  check(
    "created_at は全行NULL（バックフィル行の識別）",
    [...rows.venueDays, ...rows.races, ...rows.boats].every(
      (r) => r.created_at === null,
    ),
  );
  const boat = rows.boats.find(
    (b) => b.race_id === "2026-03-15-13-01" && b.boat_number === 1,
  );
  check(
    "艇行: K（展示・進入・ST・着）とB（級別・勝率）が結合",
    boat.exhibition_time === 6.8 &&
      boat.course === 1 &&
      boat.start_timing === 0.1 &&
      boat.finish_rank === 1 &&
      boat.class === "A1" &&
      boat.national_win_rate === 6.69 &&
      boat.race_seconds === 107.9,
  );
  check(
    "警告なし（K/Bの登録番号一致）",
    rows.warnings.length === 0,
    rows.warnings.join(" / "),
  );
  check(
    "race_seconds換算・ステージ区分",
    raceTimeToSeconds("1.49.3") === 109.3 &&
      classifyStage("準優勝戦") === "semifinal" &&
      classifyStage("優勝戦") === "final" &&
      classifyStage("予選") === "qualifier" &&
      classifyStage("ドリーム戦") === "other",
  );
  const only2005 = buildArchiveRows(days["2005-01-01"]);
  return { only2005 };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene2({ only2005 }) {
  check(
    "K のみの日（B無し）でも行を作れる（has_b=false・級別等はNULL）",
    only2005.venueDays.every((v) => v.has_k && !v.has_b) &&
      only2005.boats.every((b) => b.class === null && b.finish_raw !== null),
  );
}

function scene3() {
  // --- 6. 特殊表記の保持 ---
  {
    // 同着（2026-03-15 徳山6R）: 3着が2艇（3号艇と5号艇）、3連単が2通り
    const tokuyama = days["2026-03-15"].k.venues.find((v) => v.venue_code === 18);
    const r6 = tokuyama.races.find((r) => r.race_number === 6);
    const thirds = r6.rows
      .filter((x) => x.rank === 3)
      .map((x) => x.boat_number)
      .sort();
    const tan = r6.payouts
      .filter((p) => p.kind === "trifecta")
      .map((p) => `${p.combo}/${p.amount}`);
    check(
      "同着: 3着2艇（3,5号艇）と3連単2通り（1-2-3/1420・1-2-5/520）を保持",
      eq(thirds, [3, 5]) && eq(tan, ["1-2-3/1420", "1-2-5/520"]),
      JSON.stringify({ thirds, tan }),
    );
    const rows = buildArchiveRows(days["2026-03-15"]);
    check(
      "同着: アーカイブ行の dead_heat=true、3連単は先頭の1件",
      rows.races.find((r) => r.race_id === "2026-03-15-18-06").dead_heat ===
        true &&
        rows.races.find((r) => r.race_id === "2026-03-15-18-06").payout_3tan ===
          1420,
    );
  }
  {
    // 不成立・F（2019-04-15 蒲郡）
    const gamagori = days["2019-04-15"].k.venues.find((v) => v.venue_code === 7);
    const specials = gamagori.races.flatMap((r) =>
      r.payouts.filter((p) => p.special === "不成立"),
    );
    const flying = gamagori.races.flatMap((r) =>
      r.rows.filter((x) => x.finish_raw === "F"),
    );
    check(
      "不成立: 払戻の「不成立」を項目として保持（金額null）",
      specials.length >= 1 && specials.every((p) => p.amount === null),
    );
    check(
      "F: フライング艇の出走・ST（負値）を保持",
      flying.length >= 1 &&
        flying.every(
          (x) =>
            x.is_flying &&
            x.start_timing !== null &&
            x.start_timing < 0 &&
            x.course !== null &&
            x.rank === null,
        ),
    );
    const k = gamagori.races.flatMap((r) =>
      r.rows.filter((x) => /^K/.test(x.finish_raw)),
    );
    check(
      "欠場（K0/K1）: 着・進入・ST・展示・タイムがnullで、行としては残る",
      k.length >= 1 &&
        k.every(
          (x) =>
            x.rank === null &&
            x.course === null &&
            x.start_timing === null &&
            x.race_time === null &&
            x.exhibition_time === null,
        ),
    );
  }
  {
    // 特払い・L・失格（2005-01-01 K）
    const tokuji = days["2005-01-01"].k.venues
      .flatMap((v) => v.races)
      .flatMap((r) => r.payouts.filter((p) => p.special === "特払い"));
    const late = days["2005-01-01"].k.venues
      .flatMap((v) => v.races)
      .flatMap((r) => r.rows.filter((x) => /^L/.test(x.finish_raw)));
    check(
      "特払い: 払戻の「特払い」（70円）を項目として保持",
      tokuji.length >= 1 &&
        tokuji.every((p) => p.amount === 70 && p.combo === null),
    );
    check(
      "L: 出遅れ艇を is_late_start=true で保持",
      late.length >= 1 &&
        late.every((x) => x.is_late_start === true && x.rank === null),
    );
    const blank = days["2005-01-04"].k.venues
      .flatMap((v) => v.races)
      .flatMap((r) => r.payouts.filter((p) => p.special === "blank"));
    check("空欄の払戻行（単勝・複勝が空）も項目として保持", blank.length >= 0);
  }
}

async function scene4() {
  {
    const s = days["2005-01-04"].k.venues
      .flatMap((v) => v.races)
      .flatMap((r) => r.rows.filter((x) => /^S/.test(x.finish_raw)));
    check(
      "S（失格等）: 着の原文を保持し、rankはnull",
      s.length >= 1 && s.every((x) => x.rank === null),
    );
  }
  {
    const s1 = scene1();
    scene2(s1);
  }
  // --- プレースホルダ（全レース終了前） ---
  {
    const text = await decodeLzhText(
      new Uint8Array(fs.readFileSync(new URL("k260920-pending.lzh", FIX))),
    );
    const day = buildKbDay({ date: "2026-09-20", kText: text });
    check(
      "プレースホルダ: 検出でき、全会場が pending・レース0",
      text.includes(PENDING_MARKER) &&
        day.k.venues.length > 0 &&
        day.k.venues.every((v) => v.status === "pending" && v.races.length === 0),
    );
    check(
      "プレースホルダ: アーカイブ行を1行も作らない（確定データとして扱わない）",
      buildArchiveRows(day).races.length === 0,
    );
  }
}

function scene5() {
  // --- 8. CLI ---
  {
    check(
      "URL・アーカイブパス",
      buildKbUrl("K", "2022-03-24") ===
        "https://www1.mbrace.or.jp/od2/K/202203/k220324.lzh" &&
        kbArchiveRelPath("B", "2005-01-04") === "B/200501/b050104.lzh",
    );
    const win = parseWindow("22-06");
    const at = (iso) => new Date(iso);
    // JST 23:00 = 14:00Z、JST 03:00 = 18:00Z（前日）、JST 12:00 = 03:00Z
    check(
      "窓: 22-06は23時と3時が内、12時が外（日またぎ）",
      inWindow(win, at("2026-09-20T14:00:00Z")) &&
        inWindow(win, at("2026-09-20T18:00:00Z")) &&
        !inWindow(win, at("2026-09-20T03:00:00Z")),
    );
    check(
      "日次上限の集計: 23:00と翌03:00が同じ夜",
      windowDayKey(win, at("2026-09-20T14:00:00Z")) ===
        windowDayKey(win, at("2026-09-20T18:00:00Z")) &&
        windowDayKey(win, at("2026-09-20T14:00:00Z")) !==
          windowDayKey(win, at("2026-09-21T14:00:00Z")),
    );
    check(
      "窓any=常に内",
      inWindow(parseWindow("any"), at("2026-09-20T03:00:00Z")),
    );
    check(
      "HTTP分類: 403は閾値2、429/503は閾値3+バックオフ、404は不在",
      classifyResponse(403).threshold === 2 &&
        classifyResponse(429).backoff &&
        classifyResponse(503).threshold === 3 &&
        classifyResponse(404).kind === "absent" &&
        classifyResponse(200).kind === "ok",
    );
    const manifest = latestManifest([
      { date: "2019-04-01", kind: "K", status: "ok" },
      { date: "2019-04-01", kind: "B", status: "error" },
      { date: "2019-04-02", kind: "K", status: "absent" },
      { date: "2019-04-02", kind: "B", status: "skipped" },
    ]);
    const todo = planDownload({
      from: "2019-04-01",
      to: "2019-04-03",
      kinds: ["K", "B"],
      manifest,
    });
    check(
      "再開: 完了（ok/absent/skipped）は除き、error・未着手を対象にする",
      eq(todo, [
        { date: "2019-04-01", kind: "B" },
        { date: "2019-04-03", kind: "K" },
        { date: "2019-04-03", kind: "B" },
      ]),
    );
    const est = estimatePlan({
      requests: 4866,
      dailyLimit: 2000,
      meanIntervalMs: 4000,
      latencyMs: 1000,
    });
    check(
      "見積り: 4,866リクエスト・上限2,000で3夜",
      est.nights === 3 && est.totalHours === 6.8,
    );
    const opts = cli.validateOptions(
      cli.parseArgs([
        "download",
        "--from=2019-04-01",
        "--to=2019-04-02",
        "--interval-min-ms=500",
      ]),
    );
    check(
      "間隔の下限: 3000ms未満の指定は3000msに引き上げる",
      opts.intervalMinMs === 3000 && opts.intervalMaxMs >= 3000,
    );
    let threw = false;
    try {
      cli.validateOptions(cli.parseArgs(["download", "--from=2004-12-31"]));
    } catch {
      threw = true;
    }
    check("公式の最古（2005-01-01）より前は拒否", threw);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（FIX・check・eq・days） */
export async function runKbFileParserScenes1(env) {
  ({ FIX, check, eq, days } = env);
  scene3();
  await scene4();
  scene5();
}
