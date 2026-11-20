/**
 * registry.js の validateRegistry から移した、ジョブ定義ごとの検査（problems へ追記する。順・文は元のまま）。
 * validateJobDef が1つのジョブの検査を元の順に呼ぶ。
 */
import {
  SOFT_DEADLINE_MARGIN_SEC,
  graceMinFor,
  hhmmToMinutes,
  isCatchupOffset,
  mainWindowOffsetsOf,
} from "./registryParts.js";

function checkMaxDuration(name, def, problems) {
  if (!(def.maxDurationSec - SOFT_DEADLINE_MARGIN_SEC > 0)) {
    problems.push(
      `${name}: maxDurationSec(${def.maxDurationSec}) がソフトデッドラインの余白(${SOFT_DEADLINE_MARGIN_SEC}秒)以下です`,
    );
  }
}

function checkLease(name, def, problems) {
  if (!Number.isInteger(def.leaseSec) || def.leaseSec < 1) {
    problems.push(`${name}: leaseSec が不正です: ${def.leaseSec}`);
  }
}

function checkFinalRun(name, def, problems) {
  if (def.finalRunAfterJst !== undefined) {
    const ok = /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(def.finalRunAfterJst);
    if (
      def.kind !== "daily" ||
      !ok ||
      !(hhmmToMinutes(def.finalRunAfterJst) > hhmmToMinutes(def.targetTimeJst))
    ) {
      problems.push(
        `${name}: finalRunAfterJst は日次ジョブの、targetTimeJst より後の同じ日の HH:MM にしてください: ${def.finalRunAfterJst}`,
      );
    }
  }
}

function checkActiveHours(name, def, problems) {
  if (def.activeHoursJst !== undefined) {
    const ok = (t) => /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(t ?? "");
    if (
      !ok(def.activeHoursJst.start) ||
      !ok(def.activeHoursJst.end) ||
      hhmmToMinutes(def.activeHoursJst.start) >=
        hhmmToMinutes(def.activeHoursJst.end)
    ) {
      problems.push(
        `${name}: activeHoursJst は同じ日の HH:MM で start < end にしてください: ${JSON.stringify(def.activeHoursJst)}`,
      );
    }
  }
}

function checkWindowGrace(name, def, graceSec, problems) {
  if (!Number.isInteger(def.graceMin) || def.graceMin < 0) {
    problems.push(`${name}: graceMin が不正です: ${def.graceMin}`);
  }
  if (def.leaseSec >= graceSec) {
    problems.push(
      `${name}: リース(${def.leaseSec}秒)は許容幅(${graceSec}秒)より短くしてください`,
    );
  }
  if (def.retrySec >= graceSec) {
    problems.push(
      `${name}: 再試行の間隔(${def.retrySec}秒)は許容幅(${graceSec}秒)より短くしてください`,
    );
  }
}

function checkWindowOffsets(name, def, problems) {
  if (
    !Array.isArray(def.offsets) ||
    def.offsets.length === 0 ||
    def.offsets.some((o) => !Number.isInteger(o) || o < -32768 || o > 32767) ||
    new Set(def.offsets).size !== def.offsets.length
  ) {
    problems.push(`${name}: offsets が不正です: ${def.offsets}`);
  }
}

function checkWindowWaves(name, def, problems) {
  const waves = Math.ceil(def.claimLimit / def.concurrency);
  if (waves * def.slotSecEstimate > def.leaseSec - 10) {
    problems.push(
      `${name}: 最後のスロットの完了見込み(${waves}回 × ${def.slotSecEstimate}秒)が、リース(${def.leaseSec}秒)に余裕(10秒)を残して収まりません。claimLimit を減らすか、リースを延ばしてください`,
    );
  }
  if (!(def.concurrency >= 1) || def.concurrency > def.claimLimit) {
    problems.push(
      `${name}: concurrency(${def.concurrency}) は 1以上・claimLimit(${def.claimLimit})以下にしてください`,
    );
  }
}

function checkGraceMinByOffset(name, def, problems) {
  // 窓ごとの許容幅の上書き（graceMinByOffset）: 窓（offsets）に含まれ、ジョブの許容幅以上の整数。
  // 延長した窓は、リース・再試行の間隔より長く、次の窓の開始（発走に近い側の隣の窓の期限）を超えない
  // （超えると、次の窓と同じ時間帯に2つの窓が重なる）
  if (def.graceMinByOffset !== undefined) {
    const sortedOffsets = [...(def.offsets ?? [])].sort((a, b) => a - b);
    for (const [key, grace] of Object.entries(def.graceMinByOffset)) {
      const offset = Number(key);
      if (!Array.isArray(def.offsets) || !def.offsets.includes(offset)) {
        problems.push(
          `${name}: graceMinByOffset のキー(${key})が offsets に含まれていません`,
        );
        continue;
      }
      if (!Number.isInteger(grace) || grace < def.graceMin) {
        problems.push(
          `${name}: graceMinByOffset[${key}] は、graceMin(${def.graceMin})以上の整数にしてください: ${grace}`,
        );
        continue;
      }
      if (def.leaseSec >= grace * 60 || def.retrySec >= grace * 60) {
        problems.push(
          `${name}: graceMinByOffset[${key}](${grace}分)は、リース(${def.leaseSec}秒)・再試行の間隔(${def.retrySec}秒)より長くしてください`,
        );
      }
      const next = sortedOffsets.find((o) => o > offset);
      if (next !== undefined && offset + grace > next) {
        problems.push(
          `${name}: graceMinByOffset[${key}](${grace}分)は、次の窓(${next})の開始を超えています（窓が重なります）`,
        );
      }
    }
  }
}

function checkCatchupOffsets(name, def, graceSec, problems) {
  // 窓の外の補完のスロット（catchupOffsets）: 発走の後（正の整数）。補完の再試行の間隔は、許容幅より短い
  if (def.catchupOffsets !== undefined) {
    if (
      !Array.isArray(def.catchupOffsets) ||
      def.catchupOffsets.length === 0 ||
      def.catchupOffsets.some((o) => !Number.isInteger(o) || o <= 0)
    ) {
      problems.push(
        `${name}: catchupOffsets が不正です（発走の後の分を表す正の整数の配列）: ${JSON.stringify(def.catchupOffsets)}`,
      );
    }
    if (
      !Number.isInteger(def.catchupRetrySec) ||
      def.catchupRetrySec < 1 ||
      def.catchupRetrySec >= graceSec
    ) {
      problems.push(
        `${name}: catchupRetrySec(${def.catchupRetrySec}) は、許容幅(${graceSec}秒)より短い正の整数にしてください`,
      );
    }
  }
}

function checkWeightOnlyOffsets(name, def, graceSec, problems) {
  // 体重だけの窓（weightOnlyOffsets）: 発走の前（負の整数）で offsets に含まれ、補完の窓と重ならない。
  // 次の窓の開始を超えない（超えると、同じレースの2つの窓が同じ時間帯に重なる）。再試行の間隔は許容幅より短い
  if (def.weightOnlyOffsets !== undefined) {
    const sortedOffsets = [...(def.offsets ?? [])].sort((a, b) => a - b);
    if (
      !Array.isArray(def.weightOnlyOffsets) ||
      def.weightOnlyOffsets.length === 0 ||
      def.weightOnlyOffsets.some(
        (o) =>
          !Number.isInteger(o) ||
          o >= 0 ||
          !(def.offsets ?? []).includes(o) ||
          isCatchupOffset(def, o),
      )
    ) {
      problems.push(
        `${name}: weightOnlyOffsets が不正です（offsets に含まれる、発走の前の分を表す負の整数の配列。補完の窓とは別）: ${JSON.stringify(def.weightOnlyOffsets)}`,
      );
    } else {
      for (const offset of def.weightOnlyOffsets) {
        const next = sortedOffsets.find((o) => o > offset);
        if (next !== undefined && offset + graceMinFor(def, offset) > next) {
          problems.push(
            `${name}: 体重だけの窓(${offset})の許容幅(${graceMinFor(def, offset)}分)が、次の窓(${next})の開始を超えています（窓が重なります）`,
          );
        }
      }
    }
    if (
      !Number.isInteger(def.weightOnlyRetrySec) ||
      def.weightOnlyRetrySec < 1 ||
      def.weightOnlyRetrySec >= graceSec
    ) {
      problems.push(
        `${name}: weightOnlyRetrySec(${def.weightOnlyRetrySec}) は、許容幅(${graceSec}秒)より短い正の整数にしてください`,
      );
    }
  }
}

function checkPollMinBefore(name, def, problems) {
  // 取りに行く時刻の予定（pollMinBefore。締切の何分前か）: 狭義の降順の正の整数で、通常の窓
  // （体重だけ・補完以外の offsets）の中に収まる（最初 ≦ −offset、最後 ≧ −(offset＋許容幅)）
  if (def.pollMinBefore !== undefined) {
    const main = mainWindowOffsetsOf(def);
    const p = def.pollMinBefore;
    const valid =
      Array.isArray(p) &&
      p.length > 0 &&
      p.every(
        (m, i) => Number.isInteger(m) && m > 0 && (i === 0 || m < p[i - 1]),
      );
    if (!valid || main.length !== 1) {
      problems.push(
        `${name}: pollMinBefore は、通常の窓が1つのジョブに、狭義の降順の正の整数の配列で指定してください: ${JSON.stringify(p)}`,
      );
    } else {
      const offset = main[0];
      const end = -(offset + graceMinFor(def, offset));
      // 最後の予定は、窓の終わりより1分以上前（毎分の Cron の起動の遅れで、claim の前に expired にならない。BOA-1145）
      if (p[0] > -offset || p[p.length - 1] < end + 1) {
        problems.push(
          `${name}: pollMinBefore(${JSON.stringify(p)}) が通常の窓（締切の${-offset}〜${end + 1}分前。最後は窓の終わり${end}分前より1分以上前）の外にあります`,
        );
      }
    }
  }
}

function checkBreakerUrls(name, def, problems) {
  if (def.breakerUrls !== undefined) {
    const ok =
      Array.isArray(def.breakerUrls) &&
      def.breakerUrls.every((u) => {
        try {
          return new URL(u).protocol === "https:";
        } catch {
          return false;
        }
      });
    if (!ok) {
      problems.push(
        `${name}: breakerUrls は https の URL の配列にしてください: ${JSON.stringify(def.breakerUrls)}`,
      );
    }
  }
}

/** kind が window のジョブの検査（許容幅・窓・並列度・補完・体重だけ・予定時刻・URL）を元の順に行う */
function checkWindow(name, def, problems) {
  if (def.kind !== "window") return;
  const graceSec = def.graceMin * 60;
  checkWindowGrace(name, def, graceSec, problems);
  checkWindowOffsets(name, def, problems);
  checkWindowWaves(name, def, problems);
  checkGraceMinByOffset(name, def, problems);
  checkCatchupOffsets(name, def, graceSec, problems);
  checkWeightOnlyOffsets(name, def, graceSec, problems);
  checkPollMinBefore(name, def, problems);
  checkBreakerUrls(name, def, problems);
}

function checkDailyTarget(name, def, problems) {
  if (
    def.kind === "daily" &&
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(def.targetTimeJst ?? "")
  ) {
    problems.push(
      `${name}: targetTimeJst が HH:MM ではありません: ${def.targetTimeJst}`,
    );
  }
}

function checkRunDays(name, def, problems) {
  if (def.runDaysOfMonth !== undefined) {
    const ok = Object.values(def.runDaysOfMonth).every(
      (days) =>
        Array.isArray(days) &&
        days.length > 0 &&
        days.every((d) => Number.isInteger(d) && d >= 1 && d <= 31),
    );
    if (!ok || !Array.isArray(def.runDaysOfMonth.default)) {
      problems.push(
        `${name}: runDaysOfMonth が不正です（{default: [日], [月]: [日]}、日は1〜31）: ${JSON.stringify(def.runDaysOfMonth)}`,
      );
    }
  }
}

/**
 * 1つのジョブ定義を検査して、違反を problems に足す。kind が不正なら、その1件だけで終える
 * @returns {void}
 */
export function validateJobDef(name, def, problems) {
  if (!["window", "daily", "continuous", "monitor"].includes(def.kind)) {
    problems.push(`${name}: kind が不正です: ${def.kind}`);
    return;
  }
  checkMaxDuration(name, def, problems);
  checkLease(name, def, problems);
  checkFinalRun(name, def, problems);
  checkActiveHours(name, def, problems);
  checkWindow(name, def, problems);
  checkDailyTarget(name, def, problems);
  checkRunDays(name, def, problems);
}
