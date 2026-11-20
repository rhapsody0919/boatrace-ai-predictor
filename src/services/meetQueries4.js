import { meetExclusionsOf } from "./meetExclusion.js";
import {
  countsForSeriesScore,
  prelimEndDayOf,
  noRaceDaysOf,
  semifinalSlotsOf,
  scoreTableFor,
  postPrelimFlyingRacerIds,
  runFinishLabel,
} from "../pure/seriesPoints.js";
import { pickMeetPretestByRacer } from "../utils/pretestRows";

// **残りの予選走数**（表示中のレースを含む）。公式の「必要得点」は
// 「準優ボーダーをクリアするために必要な得点」で、実データから
// 逆算すると `ボーダー × (今の走数 + 残り走数) − 今の得点` だった
// （公式の図: 篠崎 得点率5.75・残り2走 → 13点／池田 7.00・残り1走 → 1点）。
// 残り走数は**番組が出ている予選レース**からしか数えられないので、
// 当社は当日ぶんまでで数える（翌日以降の出走表は未取得のことが多い）。
// 画面側はその旨を注記する
//
// **算入判定は得点率と同じ `countsForSeriesScore` を通す**。
// 以前は「種別に『予選』を含むレース」だけを数えていたため、
// 予選期間内でも会場固有名のレース（芦屋「サンライズＸ戦」、桐生
// 「ドラドキ３」等）が残り走数から漏れ、必要得点が過大になっていた
// （BOA-457）
// 残り走で取りうる**最大得点**。残りの本数だけでは出せない（ドリーム戦の
// 1着は12点、特選は11点）。予選配点の10点で決め打ちすると、ドリーム戦が
// 残っている選手を「届かず」と誤って出す（BOA-457）
function remainingByRacer({ meetRows, raceId, stageById, prelimEnd, add }) {
  const byRacer = {};
  for (const e of meetRows) {
    if (e.race_id < raceId) continue;
    const st = stageById.get(e.race_id) ?? "";
    if (!countsForSeriesScore(st, e.race_id, prelimEnd)) continue;
    byRacer[e.racer_id] = (byRacer[e.racer_id] ?? 0) + add(st);
  }
  return byRacer;
}

// **この節をまだ1走もしていない選手**（BOA-690）。表示中のレースより前に、
// 結果の出たレースが1つも無い選手。中止で流れたレースは走ったうちに数えない
// （津 9/22 が丸一日中止で、9/23 に初めて走る選手を「走った」と数えていた）。
// 「表示中のレース以降に番組がある」には絞らない。絞ると、中止になったレースに
// しか番組が無かった選手がどこにも数えられず、人数の足し算が合わなかった
// （津 9/21 の 6R〜12R。ファン評価1周目）。全部の走が欠場の選手は、結果の出た
// レースに入っているのでここには入らない（absentOnly の側）。
// この選手がいる間は順位の対象がそろっていないので、画面は準優の目安を伏せ、
// 人数の行に書き足す。追加クエリ0本
function notYetStartedOf(meetRows, raceId, resultById) {
  const ran = new Set();
  const all = new Set();
  for (const e of meetRows) {
    if (e.racer_id == null) continue;
    all.add(e.racer_id);
    if (e.race_id < raceId && resultById.has(e.race_id)) ran.add(e.racer_id);
  }
  return [...all].filter((id) => !ran.has(id));
}

// その日の会場の展示タイム平均（水面の重さ）。同じ6.90でも日によって
// 意味が変わるため、選手個人の推移を読むときの補正に使う。
// 実測（若松2026-09-22〜27）で日ごとに 6.829〜6.907 と0.08秒動く
function venueDailyExhibitionAvgOf(meetExhibition) {
  const byDate = (meetExhibition ?? [])
    .filter((r) => r.exhibition_time != null)
    .reduce((map, r) => {
      const d = r.race_id.slice(0, 10);
      const cur = map.get(d) ?? { sum: 0, n: 0 };
      cur.sum += Number(r.exhibition_time);
      cur.n += 1;
      map.set(d, cur);
      return map;
    }, new Map());
  return Object.fromEntries([...byDate].map(([d, v]) => [d, v.sum / v.n]));
}

// race_id → (boat_number → 値) の二段の索引
function indexByRaceBoat(rows, valueOf) {
  const byRace = new Map();
  for (const r of rows) {
    if (!byRace.has(r.race_id)) byRace.set(r.race_id, new Map());
    byRace.get(r.race_id).set(r.boat_number, valueOf(r));
  }
  return byRace;
}

// 本番STの数値。Fの艇・未取得は null
function stOf(stRow) {
  return stRow && !stRow.is_flying && stRow.start_timing != null
    ? Number(stRow.start_timing)
    : null;
}

// 1艇1走ぶんの推移の点（ST・STの順位・展示・着順）
function runPointOf(e, { exByRace, stByRace, resultById }) {
  const ex = exByRace.get(e.race_id)?.get(e.boat_number) ?? null;
  const stRow = stByRace.get(e.race_id)?.get(e.boat_number) ?? null;
  const st = stOf(stRow);
  // そのレースの中で何番目のSTだったか（1が最速、同着は同順位）。
  // 「毎回ちゃんと届いているか」は平均STより順位の方が直接的で、
  // 日和の「安定率」（当社定義は最速STとの差0.05以内の割合）が
  // 答えようとしている問いに、%より読みやすい形で答えられる。
  // Fの艇は順位から外す（異常値のため）
  const sameRace = [...(stByRace.get(e.race_id)?.values() ?? [])]
    .filter((r) => !r.is_flying && r.start_timing != null)
    .map((r) => Number(r.start_timing));
  return {
    raceId: e.race_id,
    date: e.race_id.slice(0, 10),
    // その走の着順（1〜6・F・欠・転など）。推移の点の下に出す（BOA-537）
    finish: runFinishLabel(
      resultById.get(e.race_id) ?? null,
      e.boat_number,
      stRow,
      stByRace.has(e.race_id),
    ),
    exhibition: ex === null ? null : Number(ex),
    st,
    stRank: st === null ? null : sameRace.filter((v) => v < st).length + 1,
  };
}

// 6艇それぞれの今節の走（ST・展示）。選手単位で引くと6本増えるため、
// 節の全レースぶんを2クエリで取って画面側で選手ごとに畳む
// 推移も**表示中のレースより前**だけ（未実施のレースは
// 展示もSTも無いので実害は無いが、過去日を開いたときに
// 同じ日の後のレースを拾わないよう明示的に切る）
function meetRunsByRacerOf({
  meetRows,
  raceId,
  meetExhibition,
  meetStarts,
  resultById,
}) {
  const exByRace = indexByRaceBoat(
    meetExhibition ?? [],
    (r) => r.exhibition_time,
  );
  const stByRace = indexByRaceBoat(meetStarts ?? [], (r) => r);
  const maps = { exByRace, stByRace, resultById };
  const byRacer = {};
  for (const e of meetRows) {
    if (e.race_id >= raceId) continue;
    (byRacer[e.racer_id] ??= []).push(runPointOf(e, maps));
  }
  for (const id of Object.keys(byRacer)) {
    byRacer[id].sort((a, b) => a.raceId.localeCompare(b.raceId));
  }
  return byRacer;
}

// 得点率の計算は画面側の純関数（seriesPoints.js）と同じ規則。
// ここでは素材（着順と種別）だけ渡し、集計は呼び出し側に任せる。
// **表示中のレースより前だけ**を渡す。過去日を開いているときは
// 同じ日の後のレースにも結果があるため、範囲を広げたまま渡すと
// 「5Rを見ているのに9Rの結果まで得点率に入る」状態に戻る
// （2026-09-28、必要得点のために取得範囲を広げた際に一度再発させた）
function entriesOf({ meetRows, raceId, stageById, resultById, startMaps }) {
  const { startedKeys, racesWithSt, markByKey, flyingKeys } = startMaps;
  return meetRows
    .filter((e) => e.race_id < raceId)
    .map((e) => ({
      raceId: e.race_id,
      boatNumber: e.boat_number,
      racerId: e.racer_id,
      playerName: e.player_name,
      raceStage: stageById.get(e.race_id) ?? null,
      // 欠場を走数から外すための材料（BOA-489）
      finishMark: markByKey.get(`${e.race_id}|${e.boat_number}`) ?? null,
      isFlying: flyingKeys.has(`${e.race_id}|${e.boat_number}`),
      started:
        !racesWithSt.has(e.race_id) ||
        startedKeys.has(`${e.race_id}|${e.boat_number}`),
      ...(resultById.get(e.race_id) ?? {}),
    }));
}

// 節の基本・公式値・除外・残り走数・予選終了の日目。説明は旧コードの字のまま:
// 【currentStage】
// 表示中レースの種別。早見（得点率がどう動くか）の出し分けに使う
// 【prelimEndRaceId】
// **予選の終わり**＝種別が「予選」の最後のレースの race_id。
// 得点率はここで確定し、以降は算入されない。公式の得点率一覧も
// 「4日目12R終了時点」で止まる（2026-09-27に若松G1で確認）。
//
// 最初の準優を境にすると**予選終了後の一般戦を算入してしまう**。
// 若松は9/25(4日目)で予選が終わり、9/26は1R〜8Rが一般戦・9R〜11Rが
// 準優だった。「最初の準優より前」で切ると9/26の一般戦が入り、
// 52人中32人の得点率が公式とズレた（公式と照合して5/5で確認）。
// 無い（予選中でまだ予選が終わっていない）なら null
// 【officialByRacer】
// **公式の得点率一覧（`racer_series_points`）の行**。
// `buildMeetRanking` がこれを受け取ると、当社計算ではなく公式の値で
// 得点率・節内順位・着順の並びを出す（BOA-475）。
//
// **予選が終わった後の表示でだけ渡す**。公式の行は節に1行しか無く、
// 中身は「◯日目１２R終了時点」＝予選終了時点のスナップショットなので、
// 予選中のレースを開いているときに使うと**まだ走っていない走を含む
// 得点率・順位**を出してしまう（レース詳細は過去日も開ける）。
// 予選中は従来どおり当社計算で、減点のズレは残る（公式の行が生えるのも
// 4日目以降なので、予選中は直しようが無い）
// 「使ってよいか」の判断は純関数に切り出してある（回帰テスト可能）。
// 節ページが公式値を使うと決めたとき（useOfficial）はそちらに従う
// 【officialPenaltyByRacer / officialPrelimAsOf】
// 予選中に当社計算へ足す、公式の前夜の減点（BOA-782）。`buildMeetRanking` が引く。
// 表の時点（YYYY-MM-DD）は画面の注記に使う。使えなければ null
// 【meetExclusionsOf の展開】
// **順位の対象から外す選手と、その理由**（途中帰郷・賞典除外）。
// 公式の順位表はこの選手たちを順位から外すため、当社が全員で順位を
// 振ると下位ほどズレ、ボーダーの目安も狂う。理由は画面の説明の出し分けに使う
// 【postPrelimFlyingRacerIds】
// **予選が終わった後のレースで今節Fを切った選手**（BOA-626）。
// 順位は予選終了で確定しているので順位の対象からは外さない（上の判定は
// 予選終了までのFだけを見る。公式の得点率一覧も同じ、BOA-649）。同じ
// 「今節F」で片方は除外・片方は順位付きになる理由を、画面が順位の下で断るのに使う。
// `meetStarts` は表示中レースの直前までなので、まだ切っていないFは入らない
// 【remainingPrelim*ByRacer】残りの予選走数・最大得点の説明は remainingByRacer の上
// 【noRaceDays】
// **丸一日レースが無かった日**（全レースが中止・順延、BOA-636）。表示中の日
// より前だけ。推移の横軸から抜ける理由と、予選終了の日目が日付の数と
// 合わない理由を、画面が断るのに使う。追加クエリ0本
// 【prelimEndDay】
// 予選が終わった日が節の何日目か（公式の「4日目12R終了時点」に合わせる）
// 中止の日を数えないよう `series_day` を使う（BOA-578、prelimEndDayOf）
function headFieldsOf(ctx) {
  const { meetStart, date, raceId, meetRows, conditions, raceIds } = ctx;
  const { stageById, prelimEnd, usesOfficialSeries, officialSeries } = ctx;
  const { prelimOfficial, resultById, cancelledRaceIds, meetStarts } = ctx;
  const officialRows = officialSeries ?? [];
  return {
    meetStart,
    meetEnd: date,
    currentStage: stageById.get(raceId) ?? null,
    prelimEndRaceId: prelimEnd,
    // 予選の後（または useOfficial）だけ公式の行を渡す（BOA-475）
    officialByRacer:
      !usesOfficialSeries || officialRows.length === 0
        ? null
        : Object.fromEntries(officialRows.map((r) => [r.racer_id, r])),
    officialPenaltyByRacer: prelimOfficial?.penaltyByRacer ?? null,
    officialPrelimAsOf: prelimOfficial?.asOf ?? null,
    // 順位の対象から外す選手と理由（途中帰郷・賞典除外）
    ...meetExclusionsOf({
      usesOfficialSeries,
      officialSeries,
      conditions,
      meetStarts,
      meetRows,
      prelimOfficial,
      date,
    }),
    // 予選後に今節Fを切った選手（BOA-626）
    postPrelimFlyingRacerIds: postPrelimFlyingRacerIds(
      meetStarts,
      meetRows,
      prelimEnd,
    ),
    // 残りの予選走数と最大得点（表示中のレースを含む。BOA-457）
    remainingPrelimRunsByRacer: remainingByRacer({
      meetRows,
      raceId,
      stageById,
      prelimEnd,
      add: () => 1,
    }),
    remainingPrelimMaxPointsByRacer: remainingByRacer({
      meetRows,
      raceId,
      stageById,
      prelimEnd,
      add: (st) => scoreTableFor(st)[1],
    }),
    // 丸一日レースが無かった日（BOA-636）
    noRaceDays: noRaceDaysOf(
      raceIds.filter((id) => id.slice(0, 10) < date),
      cancelledRaceIds,
    ),
    // 予選が終わった日が節の何日目か（BOA-578）
    prelimEndDay: prelimEndDayOf(
      prelimEnd,
      conditions ?? [],
      raceIds,
      new Set(resultById.keys()),
    ),
  };
}

// 準優の枠数・シリーズ・出場者
function seriesFieldsOf(ctx) {
  const { seriesConditions, cancelledRaceIds, resultById, racersByRace } = ctx;
  const { currentSeries, meetSeries, meetRows, raceId, stageById } = ctx;
  return {
    // **この節に組まれた準優勝戦の枠数**。慣例は3個レース=18名で、決められない
    // とき（予選中で準優がまだ番組に出ていない等）は **null**（0ではない）。
    // 画面は `?? SEMIFINAL_DEFAULT_SLOTS` で既定の18枠に落とす。
    // 「準優進出戦」は準優の1つ前の勝ち上がり戦なので数えない（BOA-457）。
    // 中止で流れた準優も数えない。番組に2日ぶん残る中止順延で枠数が倍になり、
    // ボーダー・必要得点・「届かず」まで狂う（BOA-490）
    // 枠数は本数 × 6 ではなく実人数で数える。多摩川のＷ準優戦は
    // 同じ12名が2回走るヒートで、本数で数えると倍になる
    semifinalSlots: semifinalSlotsOf(seriesConditions, {
      cancelledRaceIds,
      ranRaceIds: new Set(resultById.keys()),
      racersByRace,
    }),
    // **男女Ｗ優勝戦の節で、表示中の6艇が属するシリーズの選手**（BOA-511）。
    // null なら通常の節で、画面はこれまでどおり節全体を母集団にする。
    // 2シリーズを混ぜて順位を振ると、節内順位・出場人数・準優の目安が
    // すべて実際の勝ち上がり争いとズレる
    seriesRacerIds: currentSeries ? [...currentSeries] : null,
    notYetStartedRacerIds: notYetStartedOf(meetRows, raceId, resultById),
    // **節の出場者**（表示日までの出走表に載った選手、当日の番組を含む。BOA-660）。
    // 得点率の母集団（表示中のレースより前に走った選手）で数えると、初日の2Rで
    // 「節の出場は6人」になった。追加クエリ0本
    meetEntrantIds: [
      ...new Set(meetRows.map((e) => e.racer_id).filter((id) => id != null)),
    ],
    // **節がＷ開催か**（`seriesRacerIds` とは別）。両方の選手が乗るレースでは
    // 分けられないので `seriesRacerIds` が null になるが、そのときも
    // 「なぜ節全体で出しているのか」を画面が断れるようにする（BOA-511）
    isSplitMeet: Boolean(meetSeries),
    // 節の全レースの種別が取れているか（取れていなければ枠数は目安のまま）
    stagesKnown: stageById.size > 0,
  };
}

// 展示・ST・前検・得点率の素材
function runFieldsOf(ctx, { pretest, meetExhibition, meetStarts }) {
  const { meetRows, raceId, resultById } = ctx;
  return {
    venueDailyExhibitionAvg: venueDailyExhibitionAvgOf(meetExhibition),
    meetRunsByRacer: meetRunsByRacerOf({
      meetRows,
      raceId,
      meetExhibition,
      meetStarts,
      resultById,
    }),
    // 選手ごとの前検（節の最初の行＝前検日のもの）。
    // 直近は節の中の複数日に行があるため、最も古い日付を採る。
    // 採り方の根拠と、モータ情報タブ（最新の行を採る）と必ず一致することの
    // 実測は src/utils/pretestRows.js を読むこと
    pretestByRacer: Object.fromEntries(
      pickMeetPretestByRacer(
        pretest,
        new Map(
          meetRows
            .filter((e) => e.motor_number != null)
            .map((e) => [e.racer_id, e.motor_number]),
        ),
      ),
    ),
    entries: entriesOf({
      meetRows,
      raceId,
      stageById: ctx.stageById,
      resultById,
      startMaps: ctx.startMaps,
    }),
  };
}

export { headFieldsOf, seriesFieldsOf, runFieldsOf };
