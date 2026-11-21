/** 節の機力の Shorts の締切の DB 照合（border・final_gap の当日と前夜）。push-setsu-kiryoku-short.js から移した（字は同じ） */
import {
  borderDeadlineMismatch,
  eveDeadlineMismatch,
  finalDeadlineMismatch,
  raceNumberOf,
} from "../lib/sns/setsuDeadlines.js";

/** border の締切（races.start_time）を読んで当日の races と照合する。理由の配列（無ければ空） */
async function borderReasons(store, bundle, venueCode) {
  let rows;
  try {
    rows = await store.raceStartTimes(
      bundle.date, venueCode, bundle.racers.map((r) => raceNumberOf(r)),
    );
  } catch (error) {
    return [`border の締切（races.start_time）が読めない: ${error.message}`];
  }
  const why = borderDeadlineMismatch(bundle.racers, rows);
  return why ? [why] : [];
}

// 優勝戦が今日の型は、その優勝戦が DB にあり、中止・欠場が無いこと（前夜は出走表がまだ無い）
async function finalTodayReasons(store, bundle, venueCode) {
  // 締切があれば、束が指した R の優勝戦を照らす（男女W優勝戦で2つあるとき、先頭の1件で比べない。Codex P1）
  const final = await store.finalRace(
    bundle.final_date,
    venueCode,
    raceNumberOf(bundle.final_deadline),
  );
  if (!final)
    return [`${bundle.final_date} の ${bundle.venue} の優勝戦が DB に無い`];
  if (final.cancelled) return ["優勝戦が中止"];
  if (final.withdrawn) return ["優勝戦に欠場がある"];
  const deadlineWhy = finalDeadlineMismatch(bundle.final_deadline, final);
  return deadlineWhy ? [deadlineWhy] : [];
}

// 前夜の型の締切は、前夜に取った表（eve_race_deadlines、#2249 のマイグレーション202）の優勝戦の行と照らす。
// hq は表から入れるので、表が読めない・優勝戦の行が無い・違うなら送らない（誤った締切を焼き込んだ動画を出さない）
async function eveReasons(store, bundle, venueCode) {
  let finals;
  try {
    finals = await store.eveFinals(bundle.final_date, venueCode);
  } catch (error) {
    return [`前夜の締切の表が読めない: ${error.message}`];
  }
  const why = eveDeadlineMismatch(bundle.final_deadline, finals);
  return why ? [why] : [];
}

/** 型ごとの締切の DB 照合（border・final_gap の当日と前夜）。理由の配列（無ければ空） */
export async function deadlineReasons(store, bundle, venueCode) {
  if (bundle.variant === "border") return borderReasons(store, bundle, venueCode);
  if (bundle.variant !== "final_gap") return [];
  if (bundle.when === "today") return finalTodayReasons(store, bundle, venueCode);
  if (bundle.when === "eve" && bundle.final_deadline != null)
    return eveReasons(store, bundle, venueCode);
  return [];
}
