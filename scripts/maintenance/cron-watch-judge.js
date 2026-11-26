/**
 * Vercel Cron の失敗の判定（純関数）。hq の scripts/cron_watch.py の judge の移し（2026-11-26 窓口の依頼）。
 * 材料は「時間ごと・経路ごと・状態ごとの数」counts = { "YYYY-MM-DDTHH"(UTC): { 経路: { 状態: 数 } } }。
 *
 * 判定（直近24時間。ops 審査 20261122 P1）:
 *  - dispatch 系（経路に -dispatch）と scrape-monitor: 5xx の後に成功が無ければ mid。後の時間か同じ時間に成功があれば
 *    拾い直しで戻ったとみなし鳴らさない（最後の失敗の時間が閉じるまで待つ）。401・404 は外から叩けるので単発では鳴らさない
 *  - release-dispatch・db-apply-dispatch: 5xx 2回以上かつ成功0は high（定時と拾い直しの両方が落ちた＝出荷が止まる）。
 *    24時間まったく呼ばれなければ mid（測りが24時間ある時だけ）
 *  - その他: 成功0で 5xx 1回以上か 4xx 2回以上、または失敗3回以上かつ呼び出しの半分以上で mid（目安・根拠なし）
 *  - key の日は最初に落ちた時間の JST の日（窓の24時間が抜けるまで同じ key ＝ 同じ失敗で再通知しない）
 * 見えない物: 呼ばれもしない cron（SHIP 以外）、モード off・skipped で 200 を返す cron
 */
export const JUDGE_H = 24;
export const RATE_MIN = 3;
export const RATE = 0.5;
export const SHIP = [
  "/api/cron/release-dispatch",
  "/api/cron/db-apply-dispatch",
];
export const WATCHER = "/api/cron/scrape-monitor";

const HOUR = 3600 * 1000;
const hourOf = (d) => d.toISOString().slice(0, 13);
export const jstDay = (hour) =>
  new Date(Date.parse(`${hour}:00:00Z`) + 9 * HOUR).toISOString().slice(0, 10);

/** 経路ごとの集計（窓の外の時間は数えない） */
function tally(counts, cut) {
  const per = {};
  for (const h of Object.keys(counts).sort()) {
    if (h < cut) continue;
    for (const [path, st] of Object.entries(counts[h])) {
      const a = (per[path] ??= {
        ok: 0,
        f4: 0,
        f5: 0,
        first4: null,
        first5: null,
        last5: null,
        lastOk: null,
        codes: {},
      });
      for (const [code, n] of Object.entries(st)) {
        const c = /^\d+$/.test(code) ? Number(code) : 0;
        if (c < 400) {
          a.ok += n;
          a.lastOk = h;
          continue;
        }
        a[c >= 500 ? "f5" : "f4"] += n;
        a.codes[code] = (a.codes[code] ?? 0) + n;
        if (c >= 500) a.last5 = h;
        const k = c >= 500 ? "first5" : "first4";
        a[k] ??= h;
      }
    }
  }
  return per;
}

/** 経路1本の警報（無ければ null）。settled はこの時間より前の失敗だけ「戻っていない」と見る（拾い直しを待つ） */
function judgePath(path, a, settled) {
  const fails = a.f4 + a.f5;
  if (fails === 0) return null;
  const name = path.split("/").pop();
  const codes = Object.entries(a.codes)
    .sort(([x], [y]) => (x < y ? -1 : 1))
    .map(([k, v]) => `${k} ${v}回`)
    .join("・");
  const day = jstDay(a.first5 ?? a.first4);
  const head = `Vercel Cron ${name} が直近24時間で失敗（${codes}、成功 ${a.ok}回、${day} から）`;
  const alert = (prefix, level, text) => ({
    key: `${prefix}:${path}:${day}`,
    level,
    text: `${head}。${text}`,
  });
  const recovered = a.lastOk && a.lastOk >= a.last5;
  if (SHIP.includes(path) && a.f5 >= 2 && a.ok === 0)
    return alert(
      "cron_down",
      "high",
      `定時と拾い直しが両方落ちて本番の出荷が止まっている。Vercel のログ（${path}）を見る。鍵・環境変数ならオーナー`,
    );
  if (
    (path.includes("-dispatch") || path === WATCHER) &&
    a.f5 >= 1 &&
    a.last5 < settled &&
    !recovered
  )
    return alert(
      "cron_fail",
      "mid",
      `最後の失敗の後に成功が無い（${path === WATCHER ? "見張り自身の失敗" : "拾い直しも戻っていない"}）。Vercel のログを見る`,
    );
  if (
    (a.ok === 0 && (a.f5 >= 1 || a.f4 >= 2)) ||
    (fails >= RATE_MIN && fails >= RATE * (a.ok + fails))
  )
    return alert(
      "cron_fail",
      "mid",
      "成功0か半分以上の失敗。Vercel のログを見る（401 が全経路なら CRON_SECRET の不一致＝オーナー）",
    );
  return null;
}

/** 直近 JUDGE_H 時間の数から警報の候補（{key, level, text}） */
export function judge(counts, now, coveredFrom) {
  const cut = hourOf(new Date(now.getTime() - JUDGE_H * HOUR));
  const settled = hourOf(new Date(now.getTime() - HOUR));
  const per = tally(counts, cut);
  const out = Object.entries(per)
    .sort(([x], [y]) => (x < y ? -1 : 1))
    .map(([path, a]) => judgePath(path, a, settled))
    .filter(Boolean);
  if (coveredFrom && now.getTime() - Date.parse(coveredFrom) >= JUDGE_H * HOUR)
    for (const path of SHIP.filter((p) => !per[p]))
      out.push({
        key: `cron_silent:${path}:${jstDay(hourOf(now))}`,
        level: "mid",
        text: `Vercel Cron ${path.split("/").pop()} が直近24時間に1回も呼ばれていない（cron の登録が消えた・Vercel の cron が止まった恐れ）。vercel.json と Vercel の Cron の画面を見る`,
      });
  return out;
}
