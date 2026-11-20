// 送る直前の読み直し（snsClaimCheck.js の createReadCurrent）の、下書きの種類ごとの読み手。元の分岐を、順のまま1種類1関数に取り出した。
// 種類を決める定数（優勝戦・思考投稿の part と variant、思考投稿の kind）と締切の ISO も、読み手が使うのでここに置く（snsClaimCheck.js が再 export する）。
import {
  digestRevision,
  isTodayDraft,
  pickRaceStatus,
} from "./snsTodayDigest.js";
import {
  DAILY_IMAGE_TYPES,
  researchTextReasons,
  setsuRacerReasons,
} from "./snsResearchImage.js";
import {
  parseSetsuId,
  SETSU_KIRYOKU_SHORT_KIND,
  setsuItemVariantOf,
} from "./snsSetsuKiryokuShort.js";
import { parseUpsetId, UPSET_WIN_SHORT_KIND } from "./snsUpsetWinShort.js";
import { deadlineIso } from "../../scripts/lib/sns/deadlineIso.js";

/** 優勝戦の投稿の部分（下書きの source_data.finals_image.part）と item の variant（176・177）。part の無い下書きは本投稿 */
export const FINALS_PART_VARIANTS = Object.freeze({
  main: "finals",
  poll: "finals_poll",
  reply: "finals_reply",
});

/** /today の対象レースの思考投稿（BOA-1169、189）の部分（下書きの source_data.today_thinking.part）と item の variant。part の無い下書きは本投稿 */
export const THINKING_PART_VARIANTS = Object.freeze({
  main: "thinking",
  poll: "thinking_poll",
  reply: "thinking_reply",
});
/** /today の対象レースの思考投稿の item の kind（189） */
export const TODAY_THINKING_KIND = "today_thinking";

/** レースの行・出走表・展示の3つの読み（db の呼び出しの配列。Promise.all の先頭に並べる） */
export const raceCalls = (db, id) => [
  db(`races?race_id=eq.${id}&select=race_date,start_time,cancellation_status`),
  db(`race_entries?race_id=eq.${id}&select=is_absent`),
  db(`exhibition_data?race_id=eq.${id}&select=is_absent`),
];

/** 読み直しの結果（欠場・中止・締切・版）。レースの行を持つ型に共通 */
export const raceCurrent = (race, entries, exhibition, revision) => ({
  withdrawn: [...entries, ...exhibition].some((r) => r.is_absent === true),
  cancelled: race.cancellation_status != null,
  deadline_at: deadlineIso(race),
  source_revision: revision,
});

/** /today の投稿（tasks 19b）は、その日の一覧を読み直して版を返す（レースではないので欠場・中止は無い。締切は下書きの値） */
async function readToday(draft, { db, getDigest }) {
  // 載せた候補のどれかが欠場・中止になっていたら、その朝の投稿は送らない（1行だけ消して送る作りにはしない）
  const statuses = await pickRaceStatus(
    db,
    draft.source_data.digest.picks ?? [],
  );
  return {
    withdrawn: statuses.some((p) => p.reason === "absent"),
    cancelled: statuses.some((p) => p.reason && p.reason !== "absent"),
    deadline_at: draft.source_data.deadline_queue?.deadline_at ?? null,
    source_revision: await digestRevision(
      await getDigest(draft.source_data.digest.date),
    ),
  };
}

/**
 * 全貌動画（161、scripts/sns/push-full-picture.js）: 数値の照合は作り手の検査（review.p0_count=0）に任せ、送る直前は
 * レースの中止・欠場・締切だけを読み直す。版は取り込んだ時の値（下書きの source_data.full_picture.revision）
 */
async function readFullPicture(draft, { db }) {
  const { race_id: raceId, revision } = draft.source_data.full_picture;
  const id = encodeURIComponent(raceId);
  const [[race], entries, exhibition] = await Promise.all(raceCalls(db, id));
  if (!race) throw new Error("race_not_found");
  return raceCurrent(race, entries, exhibition, revision);
}

/**
 * 優勝戦の画像（176、scripts/sns/push-finals-image.js）: 全貌と同じ読み直しに、優勝戦であること・同じレースの finals_image を
 * まだ送っていないこと・自動送信の許可（finals_image_enabled）を足す。違えば投げる（runner の claim の前の検査で止まる。
 * claim の後の検査で投げた場合は claim で使った日次の枠・予約額が残る。許可は transition_sns_send_139（176）も claim で見る）
 * 本投稿へのリプ（177）は同じ読み直しで、送ったかは自分の種類（variant）だけを見る（本投稿を送った後に子が止まらないように）
 */
async function readFinals(draft, { db }) {
  const {
    race_id: raceId,
    revision,
    part = "main",
  } = draft.source_data.finals_image;
  const variant = FINALS_PART_VARIANTS[part];
  if (!variant) throw new Error("finals_part_unknown");
  const id = encodeURIComponent(raceId);
  const [[race], entries, exhibition, [conditions], sent, [control]] =
    await Promise.all([
      ...raceCalls(db, id),
      db(`race_conditions?race_id=eq.${id}&select=race_stage`),
      db(
        `sns_auto_send_items?kind=eq.finals_image&variant=eq.${variant}&race_id=eq.${id}&state=eq.sent&select=id`,
      ),
      db("sns_auto_send_control?channel=eq.x&select=finals_image_enabled"),
    ]);
  if (!race) throw new Error("race_not_found");
  if (control?.finals_image_enabled !== true)
    throw new Error("finals_image_disabled");
  if (conditions?.race_stage !== "優勝戦") throw new Error("not_finals");
  if (sent.length) throw new Error("finals_already_sent");
  return raceCurrent(race, entries, exhibition, revision);
}

/** 1日1本の画像の型の定義（下書きの source_data にその型のキーがあれば、その型） */
const dailyTypeOf = (draft) =>
  Object.values(DAILY_IMAGE_TYPES).find(
    (t) => draft?.source_data?.[t.sourceKey]?.[t.idField],
  );

/** 下書きの画像が1枚で、カバー画像と同じか（媒体の欄が X の画像1枚の形か） */
const dailyImageOk = (row, images) =>
  !(
    row?.platform !== "x" ||
    row.video_storage_path ||
    !Array.isArray(images) ||
    images.length !== 1 ||
    images[0] !== row.cover_image_path
  );

/**
 * 1日1本の画像の型（「数字で見たら」research_image 179・180、「節の機力」setsu_kiryoku 194。scripts/sns/push-research-image.js）:
 * レースを持たないので、中止・欠場・締切は無く、リンク先の表示の確認も無い（本文にリンクを置かない型。preflight は
 * public_check='none' のとき本文にリンクが無いことだけを見る）。代わりに、item がその型であること・自動送信の許可（型ごとの列）・
 * 同じ日に送った同じ型が無いこと・禁止表現・加重280・リンクなし・画像1枚（節の機力は選手の名前と級も）を、DB の下書きから
 * 読み直して確かめる。違えば投げる（runner の claim の前の検査で止まる）
 */
async function readDaily(draft, { db, draftId }) {
  const daily = dailyTypeOf(draft);
  const source = draft.source_data[daily.sourceKey];
  const { [daily.idField]: dailyId, revision } = source;
  const parsed = daily.parseId(dailyId);
  if (!parsed) throw new Error(daily.errors.idInvalid);
  const [[item], sent, [control], [row]] = await Promise.all([
    db(`sns_auto_send_items?draft_id=eq.${draftId}&select=kind,race_id`),
    db(
      `sns_auto_send_items?kind=eq.${daily.kind}&channel=eq.x&race_id=like.${encodeURIComponent(`${daily.idPrefix}:${parsed.date}:*`)}&state=eq.sent&select=id`,
    ),
    db(`sns_auto_send_control?channel=eq.x&select=${daily.enabledColumn}`),
    db(
      `sns_drafts?id=eq.${draftId}&select=platform,caption_text,hashtags,cover_image_path,video_storage_path`,
    ),
  ]);
  if (item?.kind !== daily.kind || item.race_id !== dailyId)
    throw new Error(daily.errors.itemMismatch);
  if (control?.[daily.enabledColumn] !== true)
    throw new Error(daily.errors.disabled);
  if (sent.length) throw new Error(daily.errors.alreadySent);
  if (!dailyImageOk(row, draft.source_data.image_paths))
    throw new Error(daily.errors.imageCount);
  if (
    researchTextReasons({
      caption: row.caption_text,
      hashtags: row.hashtags ?? [],
    }).length
  )
    throw new Error(daily.errors.textRejected);
  if (daily.hasRacers && setsuRacerReasons(source.racers).length)
    throw new Error(daily.errors.racers);
  return {
    withdrawn: false,
    cancelled: false,
    deadline_at: draft.source_data.deadline_queue?.deadline_at ?? null,
    source_revision: revision,
    public_check: "none",
  };
}

/**
 * /today の対象レースの思考投稿（BOA-1169、189、scripts/sns/push-finals-image.js の today_thinking）: 優勝戦の画像と同じ読み直しから
 * 段（race_stage）を外し、item が today_thinking であること・同じレースの自分の種類（variant）をまだ送っていないこと・
 * 自動送信の許可（today_thinking_enabled）を見る。違えば投げる（許可は transition_sns_send_139（189）も claim で見る）
 */
async function readThinking(draft, { db, draftId }) {
  const {
    race_id: raceId,
    revision,
    part = "main",
  } = draft.source_data.today_thinking;
  const variant = THINKING_PART_VARIANTS[part];
  if (!variant) throw new Error("thinking_part_unknown");
  const id = encodeURIComponent(raceId);
  const [[race], entries, exhibition, [item], sent, [control]] =
    await Promise.all([
      ...raceCalls(db, id),
      db(
        `sns_auto_send_items?draft_id=eq.${draftId}&select=kind,race_id,variant`,
      ),
      db(
        `sns_auto_send_items?kind=eq.${TODAY_THINKING_KIND}&variant=eq.${variant}&race_id=eq.${id}&state=eq.sent&select=id`,
      ),
      db("sns_auto_send_control?channel=eq.x&select=today_thinking_enabled"),
    ]);
  // 下書きのキーと item の kind・レース・本数の種類（variant）が食い違うなら送らない
  if (
    item?.kind !== TODAY_THINKING_KIND ||
    item.race_id !== raceId ||
    item.variant !== variant
  )
    throw new Error("thinking_item_mismatch");
  if (!race) throw new Error("race_not_found");
  if (control?.today_thinking_enabled !== true)
    throw new Error("today_thinking_disabled");
  if (sent.length) throw new Error("thinking_already_sent");
  return {
    ...raceCurrent(race, entries, exhibition, revision),
    // 本文にリンクを置かない型（オーナー 2026-10-27）。リンク先の表示の確認の代わりに、送る文にリンクが無いことを preflight が見る
    // （research_image と同じ契約。Chromium を使わない）
    public_check: "none",
  };
}

/** 優勝戦の型（final_gap）で優勝戦が今日の節の機力の Shorts の、優勝戦の中止・欠場の読み直し（前夜は出走表がまだ無い） */
async function setsuFinalState(db, finalDate, parsed) {
  const [final] = await db(
    `race_conditions?race_id=like.${encodeURIComponent(`${finalDate}-${parsed.venue}-*`)}&race_stage=eq.${encodeURIComponent("優勝戦")}&select=race_id`,
  );
  if (!final) throw new Error("setsu_final_not_found");
  const id = encodeURIComponent(final.race_id);
  const [[race], entries, exhibition] = await Promise.all([
    db(`races?race_id=eq.${id}&select=cancellation_status`),
    db(`race_entries?race_id=eq.${id}&select=is_absent`),
    db(`exhibition_data?race_id=eq.${id}&select=is_absent`),
  ]);
  if (!race) throw new Error("race_not_found");
  return {
    cancelled: race.cancellation_status != null,
    withdrawn: [...entries, ...exhibition].some((r) => r.is_absent === true),
  };
}

/**
 * YouTube Shorts「節の機力」（193、scripts/sns/push-setsu-kiryoku-short.js）: レースを持たない単独の Shorts。数の照合は作り手の型の検査
 * （setsuKiryoku/model.js の checkBundle、push で通した）に任せ、送る直前は、item が setsu_kiryoku_short で日と会場が下書きと合うこと・
 * 自動送信の許可（youtube の行の setsu_kiryoku_short_enabled）・同じ日に同じ版（item の variant。border の束は 'border'、ほかは 'main'、201）で
 * 送った setsu_kiryoku_short が無いことを読み直す（朝の border と夜の節の機力は同じ日に両方送る、BOA-1249）。
 * 優勝戦の型（final_gap）で優勝戦が今日（when=today）なら、その優勝戦の中止・欠場も見る（前夜は出走表がまだ無い）。
 * リンク先（説明欄の会場のページ）の表示の確認は public_check を返さず、preflight が queue の public_url・screen_key=venue で行う
 */
async function readSetsu(draft, { db, draftId }) {
  const {
    setsu_id: setsuId,
    revision,
    variant,
    when,
    final_date: finalDate,
  } = draft.source_data.setsu_kiryoku_short;
  const parsed = parseSetsuId(setsuId);
  if (!parsed) throw new Error("setsu_id_invalid");
  const itemVariant = setsuItemVariantOf(variant);
  const [[item], sent, [control]] = await Promise.all([
    db(
      `sns_auto_send_items?draft_id=eq.${draftId}&select=kind,race_id,variant`,
    ),
    db(
      `sns_auto_send_items?kind=eq.${SETSU_KIRYOKU_SHORT_KIND}&channel=eq.youtube&race_id=like.${encodeURIComponent(`setsu:${parsed.date}:*`)}&variant=eq.${itemVariant}&state=eq.sent&select=id`,
    ),
    db(
      "sns_auto_send_control?channel=eq.youtube&select=setsu_kiryoku_short_enabled",
    ),
  ]);
  if (
    item?.kind !== SETSU_KIRYOKU_SHORT_KIND ||
    item.race_id !== setsuId ||
    item.variant !== itemVariant
  )
    throw new Error("setsu_item_mismatch");
  if (control?.setsu_kiryoku_short_enabled !== true)
    throw new Error("setsu_kiryoku_short_disabled");
  if (sent.length) throw new Error("setsu_already_sent_today");
  const { withdrawn, cancelled } =
    variant === "final_gap" && when === "today"
      ? await setsuFinalState(db, finalDate, parsed)
      : { withdrawn: false, cancelled: false };
  return {
    withdrawn,
    cancelled,
    deadline_at: draft.source_data.deadline_queue?.deadline_at ?? null,
    source_revision: revision,
  };
}

/**
 * YouTube Shorts【人気薄の1着】（200、scripts/sns/push-upset-win-short.js）: 前日の終わったレースの振り返りの単独の Shorts。
 * 数の照合は作り手の型の検査（upsetWin/model.js の checkBundle）と、push での DB の読み直し（そのレースの6艇の値・1着・単勝）に任せ、
 * 送る直前は、item が upset_win_short で日とレースが下書きと合うこと・自動送信の許可（youtube の行の upset_win_short_enabled）・
 * 同じ日に送った upset_win_short が無いこと・そのレースの中止と1着（取り込んだ時の rank1 と同じか）を読み直す。欠場は push の時点で外してある（false を返す）。
 * リンク先（説明欄の龍神ソナーのレースの頁）の表示の確認は、preflight が queue の public_url・screen_key=race-sonar で行う
 */
async function readUpset(draft, { db, draftId }) {
  const {
    upset_id: upsetId,
    revision,
    rank1,
  } = draft.source_data.upset_win_short;
  const parsed = parseUpsetId(upsetId);
  if (!parsed) throw new Error("upset_id_invalid");
  const id = encodeURIComponent(parsed.raceId);
  const [[item], sent, [control], [race], [result]] = await Promise.all([
    db(`sns_auto_send_items?draft_id=eq.${draftId}&select=kind,race_id`),
    db(
      `sns_auto_send_items?kind=eq.${UPSET_WIN_SHORT_KIND}&channel=eq.youtube&race_id=like.${encodeURIComponent(`upset:${parsed.date}:*`)}&state=eq.sent&select=id`,
    ),
    db(
      "sns_auto_send_control?channel=eq.youtube&select=upset_win_short_enabled",
    ),
    db(`races?race_id=eq.${id}&select=cancellation_status`),
    db(`race_results?race_id=eq.${id}&select=rank1`),
  ]);
  if (item?.kind !== UPSET_WIN_SHORT_KIND || item.race_id !== upsetId)
    throw new Error("upset_item_mismatch");
  if (control?.upset_win_short_enabled !== true)
    throw new Error("upset_win_short_disabled");
  if (sent.length) throw new Error("upset_already_sent_today");
  if (!race || !result) throw new Error("race_not_found");
  // 終わったレースの1着が、取り込んだ後に訂正されていれば送らない
  if (result.rank1 !== rank1) throw new Error("upset_result_changed");
  return {
    withdrawn: false,
    // 1着があるので行われたレース（confirmed のまま結果がある行もある。docs/knowledge/data-definitions.md）。中止は1着が無いこと（上で race_not_found）
    cancelled: false,
    deadline_at: draft.source_data.deadline_queue?.deadline_at ?? null,
    source_revision: revision,
  };
}

/** 種類を決める条件と読み手（この順に試す。どれにも合わなければ素材バンドル v1 の読み直し） */
const READERS = [
  { match: (draft) => isTodayDraft(draft), read: readToday },
  { match: (d) => d?.source_data?.full_picture?.race_id, read: readFullPicture },
  { match: (d) => d?.source_data?.finals_image?.race_id, read: readFinals },
  { match: dailyTypeOf, read: readDaily },
  { match: (d) => d?.source_data?.today_thinking?.race_id, read: readThinking },
  { match: (d) => d?.source_data?.setsu_kiryoku_short?.setsu_id, read: readSetsu },
  { match: (d) => d?.source_data?.upset_win_short?.upset_id, read: readUpset },
];

/** 下書きの種類の読み手（無ければ undefined） */
export const readerFor = (draft) => READERS.find((r) => r.match(draft));

export { deadlineIso } from "../../scripts/lib/sns/deadlineIso.js";
