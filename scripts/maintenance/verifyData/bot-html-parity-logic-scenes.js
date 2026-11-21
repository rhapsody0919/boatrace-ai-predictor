/**
 * verify-bot-html-parity-logic.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-bot-html-parity-logic.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { evaluateSnapshotStatus, findMissing, parityPaths } from "../../lib/botHtmlParity.js";
import { resolveSnapshotPath } from "../../../src/config/aiCrawlerBots.js";

let ORIGIN, check;

function scene1() {
  // status.json の判定（SEO 再点検 F5）。失敗や途中停止を ok にしない
  {
    const ok = {
      generatedAt: "t",
      ok: true,
      blog: { total: 121, succeeded: 121, failedIds: [], fatalError: null },
    };
    const failed = {
      generatedAt: "t",
      ok: false,
      blog: {
        total: 121,
        succeeded: 119,
        failedIds: ["a", "b"],
        fatalError: null,
      },
    };
    const fatal = {
      generatedAt: "t",
      ok: false,
      blog: { total: 121, succeeded: null, failedIds: [], fatalError: "closed" },
    };
    check(
      "status.json: 全件成功は ok",
      evaluateSnapshotStatus(200, JSON.stringify(ok)).level,
      "ok",
    );
    check(
      "status.json: 失敗があれば fail",
      evaluateSnapshotStatus(200, JSON.stringify(failed)).level,
      "fail",
    );
    check(
      "status.json: 失敗した ID をメッセージに出す",
      evaluateSnapshotStatus(200, JSON.stringify(failed)).message.includes(
        "a, b",
      ),
      true,
    );
    check(
      "status.json: 途中で止まったら fail",
      evaluateSnapshotStatus(200, JSON.stringify(fatal)).level,
      "fail",
    );
    check(
      "status.json: 404 は注記（デプロイ前）",
      evaluateSnapshotStatus(404, "").level,
      "note",
    );
    check(
      "status.json: JSON でない（SPA の外枠）は fail",
      evaluateSnapshotStatus(200, "<!doctype html>").level,
      "fail",
    );
    check(
      "status.json: 形が違えば fail",
      evaluateSnapshotStatus(200, "{}").level,
      "fail",
    );
    check(
      "status.json: 500 は fail",
      evaluateSnapshotStatus(500, "").level,
      "fail",
    );
  }
}

function scene2() {
  // ---- 5b. CSS の text-transform（人の innerText は大文字になる） ----
  {
    const bot = {
      texts: ["Betting deadline", "15:19 JST"],
      hrefs: [],
      head: {
        title: "",
        description: "",
        canonical: "",
        alternates: [],
        jsonLd: [],
      },
    };
    const human = (text) => ({
      text,
      hrefs: [],
      head: {
        title: "",
        description: "",
        canonicals: [""],
        alternates: [],
        jsonLd: [],
      },
    });
    check(
      "uppercase で描かれたラベルは同じとみなす",
      findMissing(bot, human("BETTING DEADLINE\n15:19 JST"), ORIGIN),
      [],
    );
    check(
      "文字が違えば大文字・小文字に関係なく落ちる",
      findMissing(bot, human("BETTING CLOSE\n15:19 JST"), ORIGIN).map(
        (m) => m.value,
      ),
      ["Betting deadline"],
    );
  }
}

function scene3() {
  // ---- 6. 照合するページの一覧 ----
  {
    const langs = ["en", "zh-TW", "ko"];
    const all = () => true;
    check(
      "全部振り分けていれば全部照合する",
      parityPaths([1, 12], { langs, isRouted: all }),
      {
        checked: [
          "/",
          "/venue/1",
          "/venue/12",
          "/today",
          "/en/",
          "/en/venue/1",
          "/zh-TW/",
          "/zh-TW/venue/1",
          "/ko/",
          "/ko/venue/1",
        ],
        skipped: [],
      },
    );
    const jaOnly = (p) => !/^\/(en|zh-TW|ko)\//.test(p) && p !== "/today";
    check(
      "言語版を振り分けていなければ飛ばす",
      parityPaths([1, 12], { langs, isRouted: jaOnly }),
      {
        checked: ["/", "/venue/1", "/venue/12"],
        skipped: [
          "/today",
          "/en/",
          "/en/venue/1",
          "/zh-TW/",
          "/zh-TW/venue/1",
          "/ko/",
          "/ko/venue/1",
        ],
      },
    );
    check(
      "開催が無ければ / と言語版のトップだけ",
      parityPaths([], { langs, isRouted: all }).checked,
      ["/", "/today", "/en/", "/zh-TW/", "/ko/"],
    );
    check(
      "extraPaths（本日のレース詳細）も振り分けているときだけ照合する",
      [
        parityPaths([1], {
          langs: [],
          isRouted: all,
          extraPaths: ["/race/2026-10-12-01-01"],
        }).checked,
        parityPaths([1], {
          langs: [],
          isRouted: (p) => !p.startsWith("/race/"),
          extraPaths: ["/race/2026-10-12-01-01"],
        }).skipped,
      ],
      [
        ["/", "/venue/1", "/today", "/race/2026-10-12-01-01"],
        ["/race/2026-10-12-01-01"],
      ],
    );
    // 照合スクリプトの isRouted（今のリポジトリの振り分け）: 日本語の / と /venue/N は関数へ振り分けている
    const BINGBOT =
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36";
    const isRouted = (p) =>
      resolveSnapshotPath(p, BINGBOT)?.startsWith("/api/bot-page/") ?? false;
    check("今の振り分け: / は照合する", isRouted("/"), true);
    check("今の振り分け: /venue/1 は照合する", isRouted("/venue/1"), true);
    check(
      "今の振り分け: 静的スナップショット（/winning-technique）は照合しない",
      isRouted("/winning-technique"),
      false,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（ORIGIN・check） */
export function runBotHtmlParityLogicScenes1(env) {
  ({ ORIGIN, check } = env);
  scene1();
  scene2();
  scene3();
}
