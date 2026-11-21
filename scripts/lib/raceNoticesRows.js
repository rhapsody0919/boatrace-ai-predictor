// レース特記事項（scrape-race-information.js）の会場ごとの結果 → 書く行の純関数。DB・ファイル・ネットワークに触れない（ログだけ出す）。
// scrape-race-information.js の越え（run）を分けた（中身は元のまま）

/** 取得しなかった（ブレーカーが開いていた・ソフトデッドラインを過ぎた）会場。構造変化の失敗とは区別する */
const NOT_ATTEMPTED_REASONS = new Set(["breaker_open", "deadline"]);

/**
 * 会場ごとの取得・解析の結果（会場コード順）から、race_special_notes の行・race_notices_health の行と集計を作る。
 * ctx: { racerIdOf(racerName) => racer_id|null, existingHealth: Map<venue_code, 既存の行>, date }
 */
export function collectVenueResults(perVenue, { racerIdOf, existingHealth, date }) {
  const allNoteRows = [];
  const healthUpdates = [];
  const venuesFailed = [];
  const venuesNotAttempted = [];
  const capturedPages = [];
  /** 行はあるのに解析できなかった会場（BOA-373） */
  const venuesWithUnparsedRows = [];

  for (const {
    venueCode,
    outcome,
    notes,
    rowsUnparsed,
    capturedPath,
  } of perVenue) {
    if (rowsUnparsed > 0) {
      venuesWithUnparsedRows.push({ venueCode, rows: rowsUnparsed });
    }
    if (capturedPath) {
      capturedPages.push({ venueCode, path: capturedPath });
      console.log(
        `  📸 会場${venueCode}: 通知検出、生HTMLを保管（${capturedPath}）`,
      );
    }
    for (const note of notes) {
      const racerId = racerIdOf(note.racerName);
      allNoteRows.push({
        venue_code: venueCode,
        race_date: note.raceDate,
        category: note.category,
        racer_id: racerId,
        // racer_id は同姓同名で一意に特定できない選手がnullになり、一意制約の差別化に使えない
        // （BOA-371）ため、必ず取得できる生の選手名表記（racer_name）を差別化キーに使う
        racer_name: note.racerName,
        boat_number: null, // 情報ページ自体には艇番の記載がないため未実装（将来race_entries突き合わせで補完可）
        detail_text: note.detailText,
        structured_data: {
          ...note.structuredData,
          racerName: note.racerName,
        },
      });
    }

    if (NOT_ATTEMPTED_REASONS.has(outcome.reason)) {
      // 取得していない会場は、構造変化の判定材料にならないため、集計行を作らない
      venuesNotAttempted.push(venueCode);
      console.log(`  ⏭️ 会場${venueCode}: 取得せず（${outcome.reason}）`);
      continue;
    }

    const prev = existingHealth.get(venueCode);
    const hadSuccess = (prev?.had_success ?? false) || outcome.success;
    const lastReason = outcome.success
      ? (prev?.last_reason ?? null)
      : outcome.reason;
    healthUpdates.push({
      venue_code: venueCode,
      check_date: date,
      had_success: hadSuccess,
      last_reason: lastReason,
      last_checked_at: new Date().toISOString(),
    });

    if (!outcome.success) {
      venuesFailed.push({ venueCode, reason: outcome.reason });
      console.log(`  ⚠️ 会場${venueCode}: ${outcome.reason}`);
    } else if (notes.length > 0) {
      console.log(`  📝 会場${venueCode}: 通知あり`);
    }
  }

  return {
    allNoteRows,
    healthUpdates,
    venuesFailed,
    venuesNotAttempted,
    capturedPages,
    venuesWithUnparsedRows,
  };
}
