/**
 * verify-pit-report-job.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-pit-report-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import * as realParser from "../../lib/pitReportParser.js";
import { createFakeClient } from "./pit-report-job-fixtures.js";
import { evaluateParser, evaluateRows } from "./pit-report-job-parse-rows.js";
import { evaluateJob } from "./pit-report-job-job.js";
import { safeEval } from "./pit-report-job-scenes-1.js";

let out, check, evaluateWindow, withMutant;

const parserMutants = [
  [
    "★の数を、空（☆）の数にする",
    [['filter((c) => c === "★")', 'filter((c) => c === "☆")']],
  ],
  [
    "本文から自信度の末尾を分離しない",
    [
      [
        'text: source.slice(0, m.index).replace(/\\s+$/u, ""),',
        "text: source,",
      ],
    ],
  ],
  [
    "最終日の「12Rが」を単独の範囲にしない（toを常に空にする）",
    [
      [
        "to: range[2] ? Number(range[2]) : from }",
        "to: range[2] ? Number(range[2]) : 0 }",
      ],
    ],
  ],
  [
    "「表示対象レースではありません」を判別しない",
    [['if (text.includes("表示対象レースではありません")) {', "if (false) {"]],
  ],
  [
    "艇の行を見つけない",
    [["[class*='is-boatColor']", "[class*='is-boatColorX']"]],
  ],
  [
    "前走を読まない",
    [
      [
        "previousRaceNumber: prevMatch ? Number(prevMatch[1]) : null,",
        "previousRaceNumber: null,",
      ],
    ],
  ],
  [
    "登録番号を読まない",
    [
      [
        "racerNumber: idMatch ? Number(idMatch[1]) : null,",
        "racerNumber: null,",
      ],
    ],
  ],
  [
    "<br>を改行にしない",
    [['.replace(/ ?\\uE000 ?/g, "\\n")', '.replace(/ ?\\uE000 ?/g, "")']],
  ],
];

const rowsMutants = [
  [
    "SGを7R以降だけにする",
    [
      [
        'if (raceGrade === "SG") return true;',
        'if (raceGrade === "SG") return raceNumber >= 7;',
      ],
    ],
  ],
  ["G2を対象グレードから外す", [['["SG", "G1", "G2"]', '["SG", "G1"]']]],
  [
    "内容ハッシュにコメント本文を含めない",
    [["        b.commentText,\n", "        null,\n"]],
  ],
  [
    "未公開を ok にする",
    [["return PIT_REPORT_OUTCOMES.pending;", "return PIT_REPORT_OUTCOMES.ok;"]],
  ],
  [
    "登録番号の突合をしない",
    [
      [
        "if (b.racerNumber !== null && b.racerNumber !== expected) {",
        "if (false) {",
      ],
    ],
  ],
  [
    "★を保存しない",
    [["confidence_stars: b.confidenceStars,", "confidence_stars: null,"]],
  ],
  [
    "未公開の再試行の間隔を、発走までの時間によらず一定にする",
    [
      [
        "if (minutesToStart > config.nearFromMin) return config.farSec;",
        "if (false) return config.farSec;",
      ],
    ],
  ],
];

const jobMutants = [
  [
    "公開後、コメントが足りなくても完了にする（BOA-611 の取りこぼし）",
    [["commentCount < expectedBoats &&", "false &&"]],
  ],
  [
    "発走後もコメントが足りない間は再試行し続ける",
    [["minutesToStart > 0", "minutesToStart > -Infinity"]],
  ],
  ["shadow でも書く", [['mode !== "live" ||', "false ||"]]],
  [
    "内容が同じでも毎回書く",
    [["existing.content_hash === digest &&", "false &&"]],
  ],
  [
    "未適用のDBを確認せずに書く",
    [["if (!(await detectPitReportSchema(client))) {", "if (false) {"]],
  ],
  ["対象外のレースも取得する", [["!skipCandidateCheck &&", "false &&"]]],
  [
    "艇ごとの行を別の表（race_pit_reports）へ書く",
    [
      [
        '"race_pit_comments",\n      rows.comments,',
        '"race_pit_reports",\n      rows.comments,',
      ],
    ],
  ],
];

async function scene1() {
  for (const [label, replacements] of parserMutants) {
    const failed = await withMutant(
      "pitReportParser.js",
      replacements,
      async (m) => safeEval(() => evaluateParser(m)),
    );
    check(
      `(g) 変異検証（パーサー）: ${label} → 検証が失敗する（${failed.length}項目）`,
      failed.length > 0,
    );
  }
  // 窓（レジストリ）の変異: 当初の窓（発走60分前から）に戻すと、実測した公開時刻（120〜180分前）を取り逃がす
  for (const [label, replacements] of [
    [
      "窓の開始を発走60分前に戻す（実測した公開時刻より遅い）",
      [
        [
          "offsets: [-240],\n    graceMin: 420,",
          "offsets: [-60],\n    graceMin: 420,",
        ],
      ],
    ],
    [
      "窓の終わりを発走前に縮める",
      [
        [
          "offsets: [-240],\n    graceMin: 420,",
          "offsets: [-240],\n    graceMin: 200,",
        ],
      ],
    ],
  ]) {
    const failed = await withMutant(
      "scrapeJobs/registry.js",
      replacements,
      async (m) => safeEval(() => evaluateWindow(m.SCRAPE_JOBS)),
    );
    check(
      `(g) 変異検証（窓）: ${label} → 検証が失敗する（${failed.length}項目）`,
      failed.length > 0,
    );
  }
  for (const [label, replacements] of rowsMutants) {
    const failed = await withMutant("pitReportRows.js", replacements, async (m) =>
      safeEval(() => evaluateRows(m, realParser)),
    );
    check(
      `(g) 変異検証（行の組み立て）: ${label} → 検証が失敗する（${failed.length}項目）`,
      failed.length > 0,
    );
  }
  for (const [label, replacements] of jobMutants) {
    let failed;
    try {
      failed = await withMutant("pitReportJob.js", replacements, async (m) =>
        evaluateJob(m.processPitReportRace),
      );
    } catch (e) {
      failed = [`例外: ${e.message}`];
    }
    check(
      `(g) 変異検証（取得ジョブ）: ${label} → 検証が失敗する（${failed.length}項目）`,
      failed.length > 0,
    );
  }
}

async function scene2() {
  {
    const failed = await withMutant(
      "pitReportJob.js",
      [
        [
          "isPitReportCandidate({\n            raceGrade: r.race_grade,",
          "((x) => true)({\n            raceGrade: r.race_grade,",
        ],
      ],
      async (m) => {
        const client = createFakeClient({
          tables: {
            races: [
              {
                race_id: "2026-09-21-17-12",
                race_date: "2026-09-21",
                race_number: 12,
                race_grade: "G1",
                start_time: "16:00:00",
              },
              {
                race_id: "2026-09-21-17-01",
                race_date: "2026-09-21",
                race_number: 1,
                race_grade: "G1",
                start_time: "10:00:00",
              },
            ],
            scrape_slots: [],
          },
        });
        await m.createPitReportStore(client, { base: {} }).ensureSlots({
          date: "2026-09-21",
          jobs: ["pit_reports"],
          now: new Date("2026-09-21T07:00:00+09:00"),
        });
        return client.state.scrape_slots.length === 1
          ? []
          : ["1R（対象外）にもスロットができた"];
      },
    );
    check(
      `(g) 変異検証（予定表）: 対象レースの絞り込みを外すと、対象外のスロットができる → 検証が失敗する（${failed.length}項目）`,
      failed.length > 0,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（out・check・evaluateWindow・withMutant） */
export async function runPitReportJobScenes3(env) {
  ({ out, check, evaluateWindow, withMutant } = env);
  await scene1();
  await scene2();
}

function scene3() {
  out.log("\nALL OK");
}

/** verify から呼ぶ入口。env は verify 側の束縛（out・check・evaluateWindow・withMutant） */
export function runPitReportJobScenes4(env) {
  ({ out, check, evaluateWindow, withMutant } = env);
  scene3();
}
