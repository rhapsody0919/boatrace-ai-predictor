/**
 * verify-ai-copy-text.js の言語ごとの文面の検査（出典・前提の行・注記・展開予測・訳し漏れ）。大きさの関所のため、本文を字のまま移した。verify ではない。
 * check・build などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

/** 1つの言語の文面を検査する（元の verify の for (const lang of LANGS) の中身） */
export function checkLangText(lang, env) {
  const { dict, a, text } = checkHeadAndNotes(lang, env);
  checkOrderAndWording(lang, env, { dict, a, text });
}

/** 出典1行・前提の行・注記 */
function checkHeadAndNotes(lang, { RACE_ID, row, ROWS, build, check }) {
  const { dict, text } = build(lang);
  const a = dict.aiCopy;
  const lines = text.split("\n");
  const url =
    lang === "ja"
      ? `https://www.boat-ai.jp/race/${RACE_ID}`
      : `https://www.boat-ai.jp/${lang}/race/${RACE_ID}`;

  // 出典1行
  const last = lines[lines.length - 1];
  check(
    `[${lang}] 末尾が出典1行`,
    last.includes(dict.nav.logoText) && last.endsWith(url),
    last,
  );
  check(`[${lang}] 出典は1回だけ`, text.split(dict.nav.logoText).length === 2);

  // 前提の行が見出しの直後にある
  check(`[${lang}] 1行目が見出し`, lines[0].startsWith("## "), lines[0]);
  check(
    `[${lang}] 見出しの直後に日付`,
    lines[2] === `- ${a.premiseDate}: 2026-10-05`,
    lines[2],
  );
  check(`[${lang}] 締切`, text.includes(`- ${a.premiseDeadline}: 15:23`));
  check(
    `[${lang}] グレード・節・日目`,
    text.includes(
      `- ${a.premiseMeet}: G1 / 周年記念 / ${dict.raceDetailPage.seriesDayNth.replace("{{day}}", "3")}`,
    ),
  );
  check(
    `[${lang}] 風速・波高・観測時刻`,
    text.includes("3.0m") && text.includes("3cm") && text.includes("14:52"),
  );
  check(
    `[${lang}] 風向は会場ごとに本当の方位に直す（徳山の DB「北西」→ 北。BOA-819）`,
    text.includes(`${dict.beforeInfo.windDirection.n} 3.0m`) &&
      !text.includes(`${dict.beforeInfo.windDirection.nw} 3.0m`),
  );
  check(
    `[${lang}] データの時点（JST）`,
    text.includes(`- ${a.premiseAsOf}: `) && text.includes("2026-10-05 14:58"),
  );
  check(
    `[${lang}] 展示前の断り`,
    text.includes(a.premiseExhibitionUnpublished),
  );

  // 注記（行名は表の行と同じ文字列。訳語のずれで注記を引けなくならないように）
  for (const key of [
    "winRate",
    "motor",
    "form",
    "avgSt",
    "avgSt30",
    "st",
    "exSt",
    "exhibition",
    "exhibitionCourse",
    "partsChanged",
    "courseRate",
    "technique",
    "returnRate",
  ]) {
    check(
      `[${lang}] 注記 ${key}（表の行名つき）`,
      text.includes(`\n- ${key}: ${a.note[key]}`),
    );
  }
  // BOA-1318: 旧行の入力は保ち、差し替え後の行だけを別の入力で検証する。
  const expectedCourseLabel = dict.dataTable.rowExpectedCourseWinRate;
  const { text: expectedCourseText } = build(lang, {
    rows: ROWS.map((r) => r.key === "courseRate"
      ? row("expectedCourseWinRate", expectedCourseLabel)
      : r),
  });
  check(
    `[${lang}] 想定コース1着率の注記（表の行名つき）`,
    typeof a.note.expectedCourseWinRate === "string" &&
      expectedCourseText.includes(`\n- ${expectedCourseLabel}: ${a.note.expectedCourseWinRate}`),
  );
  check(`[${lang}] 新しい行だけなら旧courseRateの注記は出さない`,
    !expectedCourseText.includes(a.note.courseRate));
  check(`[${lang}] 旧行だけなら想定コース1着率の注記は出さない`,
    !text.includes(a.note.expectedCourseWinRate));
  check(`[${lang}] 「—」の注記`, text.includes(`- ${a.note.dash}`));
  // 総合力順位は画面に無く、1着候補と食い違って読めるので入れない
  check(`[${lang}] 総合力順位を入れない`, !text.includes(" > "));
  check(
    `[${lang}] 2着・3着の列の説明`,
    text.includes(a.turnPredictionCandidateNote),
  );
  return { dict, a, text };
}

/** 注記と展開予測の順・種別・訳し漏れ・気象と展示・追加の文言 */
function checkOrderAndWording(lang, { lookup, row, build, check }, { dict, a, text }) {
  // 表の後ろに注記、注記の後ろに展開予測
  const tableEnd = text.lastIndexOf("| returnRate |");
  // 種別はページの見出しと同じく分類名で出す（会場独自の名前「東尋坊ドリーム」→「ドリーム戦」）
  const { text: dream } = build(lang, {
    context: { raceStage: "東尋坊ドリーム" },
  });
  check(
    `[${lang}] 種別は分類名`,
    dream.includes(` / ${lookup(dict, "raceStage.dream")}\n`),
    dream.split("\n")[4],
  );
  const notesAt = text.indexOf(a.notesHeading);
  const turnAt = text.indexOf(a.turnPredictionHeading);
  check(
    `[${lang}] 表 → 注記 → 展開予測 の順`,
    tableEnd < notesAt && notesAt < turnAt,
    `${tableEnd} ${notesAt} ${turnAt}`,
  );
  check(`[${lang}] 単勝でも展開予測が入る`, turnAt > 0);

  // 訳し漏れ
  check(
    `[${lang}] キーがそのまま出ていない`,
    !/aiCopy\.|beforeInfo\.|raceDetailPage\./.test(text),
  );
  check(`[${lang}] {{}} が残っていない`, !text.includes("{{"));
  check(`[${lang}] undefined / NaN が無い`, !/undefined|NaN/.test(text));
  check(`[${lang}] 「競艇」が無い`, !text.includes("競艇"));

  // 気象が無い・展示後
  const { text: noWeather } = build(lang, {
    context: { weather: null, startTime: null },
    exhibitionPublished: true,
  });
  check(
    `[${lang}] 気象が無いと各項目が未取得`,
    noWeather.includes(`${dict.beforeInfo.waveHeightLabel} ${a.unpublished}`) &&
      noWeather.includes(`${a.premiseWind} ${a.unpublished}`),
  );
  check(
    `[${lang}] 締切が無いと未発表`,
    noWeather.includes(`- ${a.premiseDeadline}: ${a.unpublished}`),
  );
  check(
    `[${lang}] 展示後は展示前の断りが無い`,
    !noWeather.includes(a.premiseExhibitionUnpublished),
  );

  // 取得失敗で展示の有無が分からないときは「未反映」と言い切らない
  const { text: unknownEx } = build(lang, { exhibitionPublished: null });
  check(
    `[${lang}] 展示の有無が不明なら未反映の行を出さない`,
    !unknownEx.includes(a.premiseExhibitionUnpublished),
  );

  // 表に無い行の注記は出さない
  const { text: fewRows } = build(lang, {
    rows: [row("name", "name"), row("form", "form")],
  });
  check(
    `[${lang}] 表に無い行の注記は出さない`,
    !fewRows.includes(a.note.partsChanged) &&
      fewRows.includes(a.note.form) &&
      fewRows.includes(a.note.dash),
  );

  // 追加した文言に「競艇」が無い
  const added = [
    ...Object.values(a.note),
    a.followUp1,
    a.followUp2,
    a.followUp3,
    a.followUpHeading,
    a.promptTurn,
    a.promptDataOnly,
    a.promptSelectorTurn,
    a.promptSelectorDataOnly,
    a.premiseExhibitionUnpublished,
    a.sourceLine,
    a.previewToggleLabel,
  ];
  check(
    `[${lang}] 追加文言に「競艇」が無い`,
    added.every((s) => !s.includes("競艇")),
  );
  if (lang === "ja") {
    // 的中・回収を示唆する表現（BOA-617）。単勝回収率の注記は既存の指標名なので「回収率」だけ許す
    const hint = /的中|当た|勝てる|儲|稼|狙い目/;
    const bad = added.filter((s) => hint.test(s) || /回収(?!率)/.test(s));
    check(
      "[ja] 追加文言に的中・回収を示唆する語が無い",
      bad.length === 0,
      bad.join(" / "),
    );
  }
}
