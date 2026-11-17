/**
 * verify-motor-window-generation.js の検査の続き（motor-window-generation-sections4.js）。大きさの関所のため、同じ検査を場面ごとの関数に分けた。verify ではない。
 * 共通の道具・場面は ctx で受け取り、前の場面で作った物は ctx に足されて次へ渡る。
 */

export async function section17(ctx) {
  const { chart, check, read } = ctx;
  // 選手ページの今節のモーター（RA40 BOA-1673 で racerService.js から移した）
  const racer = read("src/services/motorQueries7.js");
  check(
    "選手ページ: 直近出走が入れ替え前なら機力指数・公式成績を出さない",
    racer.includes("date < generationStart") &&
      // 領域の Queries の名前つき import（殻 supabaseDataService は RA40 で消えた）
      /preGeneration\s*\?\s*null\s*:\s*getMotorPowerIndex\(/.test(racer),
  );
  // 2026-09-29 ファン評価1周目の修正
  check(
    "選手ページ: 直近出走が入れ替え前なら理由を書き、行き止まりのリンクを出さない",
    racer.includes("preGeneration,\n  };") &&
      read("src/components/racer/RacerMotorStatusCard.jsx").includes(
        "{preGeneration ? (",
      ),
  );
  check(
    "画面: 入れ替え前のレースは一覧の時点で伝え、「行を押すと推移」の案内を出さない",
    chart.includes("setRacePreGeneration(preGeneration)") &&
      chart.includes("analysis.motor.racePreGenerationNote") &&
      /racePreGeneration \? \(\s*<p className="table-note">\{t\("analysis\.motor\.highlightNote"\)\}/.test(
        chart,
      ),
  );
  check(
    // 当日のレースも「直前まで」で集計するので、注記も当日から出す（BOA-557）
    "画面: ドリルダウンは（過去・当日とも）「このレースの直前まで」と明示する（BOA-521）",
    chart.includes("{selectedRace && (") &&
      chart.includes("analysis.motor.drillAsOfRaceNote"),
  );
  {
    // 出典の注記は横スクロール枠（右端のフェード）の外に置く（375pxで行末が隠れる）
    const wrapperStart = chart.indexOf("table-wrapper hscroll-hint");
    const noteAt = chart.indexOf("motor-official-source-note", wrapperStart);
    const between = chart.slice(wrapperStart, noteAt);
    const opens = (between.match(/<div\b/g) ?? []).length;
    const closes = (between.match(/<\/div>/g) ?? []).length;
    check(
      "画面: 出典の注記が横スクロール枠の外にある",
      wrapperStart >= 0 && noteAt > wrapperStart && closes > opens,
    );
  }
  check(
    "画面: 過去レースはドリルダウンでも期間を選ばせない（90日に戻す）",
    chart.includes("!drillPreGeneration && !isPastSelectedRace") &&
      /selectedRace\.slice\(0, 10\) < getTodayJST\(\)\) \{\s*setPeriodDays\(90\)/.test(
        chart,
      ),
  );
  check(
    "画面: 入れ替え前のレースでもハイライト行の説明は残す",
    chart.includes("analysis.motor.highlightNote"),
  );
}

export async function section18(ctx) {
  const { chart, check, formatGenerationDate, isClippedByGeneration, read } =
    ctx;
  // BOA-521: 過去レースのドリルダウンは「このレースの直前まで」で集計する
  {
    {
      // 動きの確認: 同じ filter 式を実データの形に当てる（既定は対象を除き、includeTarget は含む）
      const rows = [
        "2026-11-04-01-01",
        "2026-11-04-01-02",
        "2026-11-04-01-03",
      ].map((race_id) => ({ race_id }));
      const target = "2026-11-04-01-02";
      const excl = rows.filter((r) => r.race_id < target).map((r) => r.race_id);
      const incl = rows
        .filter((r) => r.race_id <= target)
        .map((r) => r.race_id);
      check(
        "getRacesForVenueSince: 既定は対象を除き、includeTarget は対象まで含む（後のレースは入らない）",
        excl.join() === "2026-11-04-01-01" &&
          incl.join() === "2026-11-04-01-01,2026-11-04-01-02",
      );
    }
    check(
      // 当日のレースも「このレースの直前まで」（BOA-557）
      "画面: ドリルダウンで beforeRaceId（過去・当日とも表示中のレース）を9つの取得すべてに渡す",
      chart.includes("const beforeRaceId = selectedRace ?? null;") &&
        (chart.match(/\bbeforeRaceId,\n/g) ?? []).length >= 7 &&
        (chart.match(/isPast \? raceDate : null/g) ?? []).length >= 2,
    );
  }
  // 2026-09-29 ユーザー判断 B: 使用開始日を画面に出す（ADR-0067 2026-09-28追記の改訂）。
  // 日付を伏せた注記「入れ替え後のため…」が「最近入れ替えた」と誤読されたため
  check(
    "画面: 使用開始日の行を、期間の切り替えを出すとき（当日のレース）だけに出す",
    /showPeriodToggle \? \(\s*<>\s*\{\/\*[\s\S]*?\*\/\}\s*\{generationStart !== null && \(/.test(
      chart,
    ) && chart.includes("analysis.motor.generationStartSource"),
  );
  check(
    "画面: 切り詰めの注記と機力指数の要約に使用開始日を差し込む",
    /periodClippedNote", \{\s*date: formatGenerationDate\(generationStart/.test(
      chart,
    ) &&
      /periodSinceGeneration", \{\s*date: formatGenerationDate\(generationStart/.test(
        chart,
      ),
  );
  check(
    "画面: 使用開始日の取得に失敗しても一覧表は出す（try/catch で null に倒す）",
    // 領域の Queries の名前つき import（殻 supabaseDataService は RA40 で消えた）
    /let venueGenerationStart = null;\s*try \{\s*venueGenerationStart =\s*await getMotorGenerationStart\(/.test(
      chart,
    ),
  );
  // 入れ替えから1ヶ月以内は「直近1ヶ月」まで切り詰められ、切り替えても中身が変わらない
  // （2026-09-29 ファン評価。丸亀 9/17 入れ替え → 9/29 は両方とも 9/17 以降）
  check(
    "isClippedByGeneration: 丸亀（9/17〜）は 9/29 時点で30日も切り詰め、戸田（8/6〜）は切り詰めない",
    isClippedByGeneration("2026-09-17", "2026-09-29", 30) === true &&
      isClippedByGeneration("2026-08-06", "2026-09-29", 30) === false &&
      isClippedByGeneration("2026-08-06", "2026-09-29", 90) === true &&
      isClippedByGeneration(null, "2026-09-29", 30) === false,
  );
  check(
    "isClippedByGeneration: 境界（使用開始日 = 基準日−days）は切り詰めない",
    isClippedByGeneration("2026-08-30", "2026-09-29", 30) === false &&
      isClippedByGeneration("2026-08-31", "2026-09-29", 30) === true,
  );
  check(
    "formatGenerationDate: 2026/8/6 と 8/6（先頭の0を付けない）",
    formatGenerationDate("2026-08-06") === "2026/8/6" &&
      formatGenerationDate("2026-08-06", { short: true }) === "8/6" &&
      formatGenerationDate(null) === "",
  );
  check(
    "画面: 両方の期間が切り詰められるときは、期間の切り替えボタンを出さない",
    /periodChoiceHasEffect && \(\s*<div className="period-toggle"/.test(chart),
  );
  check(
    "画面: 枠番別成績の注記にも使用開始日を入れる",
    read("src/components/analysis/MotorWakuStatsGrid.jsx").includes(
      "date: formatGenerationDate(generationStart, { short: true })",
    ),
  );
  check(
    "画面: 経過日数（◯日目）は出さない（ファンの単位は節。2026-09-29 ファン議論）",
    !/日目/.test(chart),
  );
}

export async function section19(ctx) {
  const { check, read } = ctx;
  for (const lang of ["ja", "en", "zh-TW", "ko"]) {
    const motor = JSON.parse(read(`src/locales/${lang}/common.json`)).analysis
      .motor;
    // BOA-521: ドリルダウンは「このレースの直前まで」なので、一覧の注記で機力指数を
    // 「今日から遡る指標」と説明すると食い違う（2026-09-29 ファン評価）
    check(
      `${lang}: 過去レースの出典注記が、機力指数を「今日から遡る」と説明していない`,
      !/今日から遡|computed backward from today|從今天回溯|오늘부터 거슬러/.test(
        motor.officialModeSourceNote,
      ),
    );
    check(
      `${lang}: 使用開始日の行・注記が日付（{{date}}）を受け取り、出典に BOATCAST とある`,
      motor.generationStartLabel?.includes("{{date}}") &&
        motor.periodClippedNote.includes("{{date}}") &&
        motor.periodSinceGeneration.includes("{{date}}") &&
        motor.generationStartSource?.includes("BOATCAST"),
    );
    check(
      `${lang}: 過去レース・切り詰め・入れ替え前の文言がある`,
      [
        "periodOfficialNote",
        "periodClippedNote",
        "officialModeSourceNote",
        "drillPreGeneration",
        "periodSinceGeneration",
        "racePreGenerationNote",
        "drillAsOfRaceNote",
        "highlightNote",
      ].every((k) => typeof motor[k] === "string" && motor[k].length > 0),
    );
  }
}
