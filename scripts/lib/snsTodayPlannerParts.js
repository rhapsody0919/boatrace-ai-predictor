/**
 * snsTodayPlanner.js から移した、/today 投稿の計画の部品（時刻・型 v3/b の用意・本文 buildTodayPost・日付の道具）。
 * 振る舞いは元のまま。snsTodayPlanner.js が同じ名前で再 export する。
 */
import {
  TODAY_HEADING_BUILTIN,
  normalizeTodayVariants,
  renderTodayHeading,
} from "./snsTodayVariants.js";
import { createHash } from "node:crypto";
import {
  buildTodayDigestV3,
  checkTodayDigestV3,
  loadTodayV3Material,
} from "./snsTodayDigestV3.js";

// 計画の開始と、送る時刻（早くてこの時刻、2026-11-04 オーナー決定 7:00、BOA-1314）。載せるレースは締切がこれより後のものだけ
export const TODAY_PLAN_FROM = "06:30";
export const TODAY_SEND_AT = "07:00";
// 下書きを作れる最後の時刻。過ぎて下書きが無ければ「作れなかった」を知らせる
export const TODAY_LATEST = "08:00";
// item の締切に見立てる時刻と失効（失効は締切の30分前、expiry_minutes=30 と一致）。153 の CHECK: notify_by < veto_until < deadline_at
export const TODAY_DEADLINE = "09:00";
export const TODAY_EXPIRES = "08:30";

/**
 * その日の時刻（ISO）。送る時刻は 7:00 と now（下書きを作る時刻）の遅い方。now を渡さなければ 7:00
 * 締切に見立てる 9:00（失効 8:30）。notify_by は計画の開始、veto_until は送る時刻（153 の CHECK: notify_by < veto_until < deadline_at）
 */
export function todaySchedule(date, now = null) {
  const at = (hhmm) => new Date(`${date}T${hhmm}:00+09:00`).toISOString();
  const sendAt = new Date(
    Math.max(Date.parse(at(TODAY_SEND_AT)), now ? now.getTime() : 0),
  ).toISOString();
  return {
    plan_from: at(TODAY_PLAN_FROM),
    latest: at(TODAY_LATEST),
    scheduled_at: sendAt,
    deadline_at: at(TODAY_DEADLINE),
    notify_by: at(TODAY_PLAN_FROM),
    veto_until: sendAt,
    expires_at: at(TODAY_EXPIRES),
  };
}

/** utm_content は「日付-札」（札は実際に送った型 a・b・c（v3）。hq の比べが GA4 の流入を型で分ける、§10-5） */
export const todayUtmContent = (date, sent) => `${date}-${sent}`;
export const todayTrackingUrlOf = (todayUrl, date, sent = "a") =>
  `${todayUrl}?utm_source=x&utm_medium=social&utm_campaign=today_digest&utm_content=${todayUtmContent(date, sent)}`;

// 本文だけ短い道にする。追跡行には従来の UTM URL を保存する。
export const todayPostUrlOf = (todayUrl, date, sent) =>
  `${new URL("/x/today", todayUrl)}?d=${todayUtmContent(date, sent)}`;

export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/**
 * 型 v3（今の型、BOA-1314）の本文と検査（純粋でない: DB を読む）。返り値 { ok: true, text, picks, featured, blocks, summary, url } か { ok: false, reason }。
 * sent は札（config の current.id、utm_content の末尾）
 */
export async function prepareTodayV3Of(
  todayUrl,
  { date, sendAt, raceDb, t, sent },
) {
  const url = todayPostUrlOf(todayUrl, date, sent);
  const made = buildTodayDigestV3(await loadTodayV3Material(raceDb, date), {
    sendAt,
    t,
    url,
  });
  if (!made.ok) return made;
  const problems = checkTodayDigestV3(made.text, { date, url });
  return problems.length
    ? { ok: false, reason: `check_failed:${problems.join(",")}` }
    : { ...made, url };
}

/** config の型 a（b を出せない日に使う）。config が壊れていれば既定の文 */
export function typeAOf(config) {
  const { fallback, variants } = normalizeTodayVariants(config);
  const a = variants[0];
  return a
    ? {
        type_id: a.type_id,
        heading: a.heading,
        link_lead: a.link_lead,
        link_position: a.link_position,
        variant: { id: a.id, uuid: a.uuid },
      }
    : {
        type_id: "today-a",
        heading: fallback,
        link_lead: null,
        link_position: "after_heading",
        variant: { id: "default", uuid: null },
      };
}

// 本文に載せる区分と人数・最低の走数（2026-10-15 オーナー承認の型）。逃がし・注目レースは、選ぶ式の向きを /today 側で直すまで載せない
// 見出し（2026-10-15 hq 承認の文）。割合は一覧に保存されたしきい値（morning_digest_days.notes.thresholds）を使う
export const TODAY_PICK_RULES = [
  {
    section: "nige",
    mark: "逃げ",
    limit: 3,
    threshold: 70,
    legend: (pct) =>
      `全国で1コースに入ったとき逃げ切った割合${pct}%以上の1号艇`,
  },
  {
    section: "makuri",
    mark: "まくり",
    limit: 2,
    threshold: 25,
    legend: (pct) => `そのコースでまくりで1着の割合${pct}%以上の選手`,
  },
];
export const TODAY_MIN_SAMPLE = 30;
/** 見出しの直後に置くリンクの行の頭 */
export const TODAY_LINK_LABEL = "今日の一覧はこちら：";
export const TODAY_NOTICE =
  "過去の実績は当日の結果を保証しません。展示後は進入と展示タイムも確認してください。";

/** 載せてよい候補（区分・rank の順）。送る時刻までに締切を過ぎる・走数30未満・締切の無い行は除く。区分の中の同じレースは最初の行だけ */
export function todayCandidates(rows, sendAt = TODAY_SEND_AT) {
  return TODAY_PICK_RULES.flatMap(({ section }) => {
    const seen = new Set();
    return rows
      .filter(
        (row) =>
          row.section === section &&
          typeof row.start_time === "string" &&
          row.start_time.slice(0, 5) > sendAt &&
          Number(row.sample_size) >= TODAY_MIN_SAMPLE,
      )
      .sort((a, b) => a.rank - b.rank)
      .filter((row) => !seen.has(row.race_id) && seen.add(row.race_id));
  });
}

/**
 * 決まった型の本文（AI 生成なし）。候補から欠場・中止・締切を確かめられない行（excluded の race_id:艇番）を除き、
 * 区分ごとに上限まで rank の順に選び、全体を締切→会場→R の順に並べる。候補が0件なら null（その日は送らない）
 * 印の意味を1行ずつ、その後に全体を締切の早い順で。1行は「［逃げ］会場R HH:MM締切｜艇番 選手名｜全国N走」（2026-10-15 オーナー回答）
 */
// 注目レースの割合の言い方（選んだ区分ごと）。逃がしからの注目は、向きの確認が済むまで載せない
const FEATURED_RATE = {
  nige: (course) => `${course}コースで逃げ切った割合`,
  makuri: (course) => `${course}コースでまくりで1着の割合`,
};
const pct = (value) => `${Number(value)}%`;

/** /today の注目レース（featured）。逃げ・まくりから選ばれ、送る時刻より後の締切で、数字がそろっているときだけ */
// 画像は対象レースの龍神ソナーの図を最大4枚（2026-10-16 ユーザー決定。X の1投稿の上限が4枚）。
// 図の元データ（analogy-v16-morning）は 7:24〜7:26 に書かれる（10/14〜10/17 の実測）。遅れる日のために 7:30 まではそろうまでやり直し、
// 7:30 を過ぎたら撮れた分で作る（型 a・b だけ。今の型 v3 は画像なし）
export const TODAY_MAX_IMAGES = 4;
export const SONAR_ELEMENT = ".af-hep .af-dark";
// 図の外周の色（.af-dark の放射状のグラデーションの外側、AnalogyV16.css）。撮った画像の上端・下端がこの色でなければ、
// 別の部品が入った画像として撮り直す（2026-10-24 BOA-1013）
export const SONAR_EDGE_COLOR_VAR = "--ryujin-navy-600";
// 図を撮る前に待つ印は条件のカードだけ。段の表示（analogy-stage-chip）は展示のデータが入ると切り替えのボタンに変わり、
// 展示の後に撮ると見えない（2026-10-17 夜の作り直しで4枚とも screenshot_component_missing）
export const SONAR_READY = ['[data-testid="analogy-fact-card"]'];
// 図を待つのは型 a・b だけ（v3 は文だけ）。下書きを作れる最後（8:00）より前に置く（BOA-1314 で 7:00 送りにしたため、ほかの時刻と同じく 8:30 から1時間繰り上げ。図のデータは 7:24〜7:26 に書かれる）
export const SONAR_WAIT_UNTIL = "07:30";
export const SHOT_BUDGET_MS = 120_000;

export function todayFeatured(rows, sendAt = TODAY_SEND_AT) {
  const row = rows.find((r) => r.section === "featured");
  if (
    !row ||
    !FEATURED_RATE[row.from] ||
    typeof row.start_time !== "string" ||
    row.start_time.slice(0, 5) <= sendAt ||
    !Number.isInteger(row.boat_number) ||
    !Number.isInteger(row.course) ||
    !Number.isFinite(Number(row.metric_value)) ||
    !Number.isFinite(Number(row.metric_venue_baseline)) ||
    !Number.isInteger(row.sample_size)
  )
    return null;
  return row;
}

const rowKey = (row) => `${row.race_id}:${row.boat_number}`;

/** 注目レースと一覧の選手を選ぶ（欠場などの excluded を除き、区分ごとの上限まで、締切→会場→R の順） */
function selectTodayRows(digest, sendAt, excluded) {
  const found = todayFeatured(digest.rows, sendAt);
  const featured = found && !excluded.has(rowKey(found)) ? found : null;
  // 注目レースの選手は一覧に重ねて出さない
  const candidates = todayCandidates(digest.rows, sendAt).filter(
    (row) =>
      !excluded.has(rowKey(row)) &&
      (!featured || rowKey(row) !== rowKey(featured)),
  );
  const picks = TODAY_PICK_RULES.flatMap(({ section, limit }) =>
    candidates.filter((row) => row.section === section).slice(0, limit),
  ).sort(
    (a, b) =>
      a.start_time.localeCompare(b.start_time) ||
      a.venue_code - b.venue_code ||
      a.race_number - b.race_number,
  );
  return { featured, picks };
}

// 印の意味（その日に出る区分だけ）を先に1行ずつ、その後に全体を締切の早い順で（2026-10-15 オーナー「締め切り順が良い」）
function pickBlockLines(picks, thresholds, head) {
  if (!picks.length) return [];
  const rules = TODAY_PICK_RULES.filter((rule) =>
    picks.some((row) => row.section === rule.section),
  );
  const mark = Object.fromEntries(
    rules.map((rule) => [rule.section, rule.mark]),
  );
  return [
    ...rules.map(
      (rule) =>
        `［${rule.mark}］${rule.legend(thresholds[rule.section] ?? rule.threshold)}`,
    ),
    "",
    ...picks.map(
      (row) => `［${mark[row.section]}］${head(row)}｜全国${row.sample_size}走`,
    ),
    "",
  ];
}

// 注目レースを先頭に（2026-10-16 オーナー指示。「イン崩れ指数」「AIが算出」の言い方は使わない）
function featuredLines(featured, head) {
  if (!featured) return [];
  return [
    `注目レース：${head(featured)}｜${FEATURED_RATE[featured.from](featured.course)} ${pct(featured.metric_value)}（全国${featured.sample_size}走）・この会場の平均 ${pct(featured.metric_venue_baseline)}`,
    "",
  ];
}

export function buildTodayPostOf(
  model,
  digest,
  {
    t,
    url,
    sendAt = TODAY_SEND_AT,
    excluded = new Set(),
    heading = TODAY_HEADING_BUILTIN,
    linkLead = null,
    linkPosition = "after_heading",
  },
) {
  const { featured, picks } = selectTodayRows(digest, sendAt, excluded);
  if (!picks.length && !featured) return null;
  const head = (row) =>
    `${t(`venues.${row.venue_code}`)}${row.race_number}R ${row.start_time.slice(0, 5)}締切｜${row.boat_number}号艇 ${String(row.racer_name ?? "").replace(/\u3000/g, " ")}`;
  // 見出し（1行目）だけは日替わりの案（config/today-variants.json）。ほかは機械が作る
  // リンクの置き場は型で選ぶ（PD02）。既定は見出しの直後（3行目）。末尾だと長文の折りたたみの先に隠れて押されにくい
  // （2026-10-22 オーナー「前倒しで押される形」、10/20 は表示321・クリック1以下）。reply は本文に置かず自分への返信に置く
  const linkLine = `${linkLead ?? TODAY_LINK_LABEL}${url}`;
  const lines = [renderTodayHeading(heading, model.dateLine), ""];
  if (linkPosition === "after_heading") lines.push(linkLine, "");
  lines.push(
    ...featuredLines(featured, head),
    ...pickBlockLines(picks, digest.day?.notes?.thresholds ?? {}, head),
    TODAY_NOTICE,
  );
  if (linkPosition === "end") lines.push("", linkLine);
  const shown = [featured, ...picks].filter(Boolean);
  return {
    text: lines.join("\n"),
    // 自分への返信に置く文（reply の型だけ）。返信は親の投稿の後に送る（送信の runner が親の posted を待つ）
    reply: linkPosition === "reply" ? linkLine : null,
    // 画像（龍神ソナーの図）を撮るレース。注目レースを先頭に、一覧を締切順で、同じレースは1回
    races: shown
      .filter(
        (row, i, all) => all.findIndex((r) => r.race_id === row.race_id) === i,
      )
      .map(({ race_id, venue_code, race_number, start_time, boat_number }) => ({
        race_id,
        venue_code,
        race_number,
        start_time,
        boat_number,
      })),
    // 送る直前に欠場・中止を読み直す対象（注目レースを含む）
    picks: shown.map((row) => ({
      race_id: row.race_id,
      boat_number: row.boat_number,
    })),
  };
}

export const jstHm = (iso) =>
  new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(11, 16);
export const jstDate = (date) =>
  new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);

/** 確認用の作り直し（cursor.today_rebuild）が今の実行で効くか。送る時刻を過ぎた、その日の分だけ */
export function isTodayRebuild(reviewDate, now) {
  const date = jstDate(now);
  return reviewDate === date && now >= new Date(todaySchedule(date).latest);
}

// 理由の文字列は1件につき最初の1行だけ残す（Playwright の例外はブラウザのログ全文を含み、cursor の記録が切れた。2026-10-17）
export const firstLine = (message) =>
  String(message).split("\n")[0].slice(0, 160);
