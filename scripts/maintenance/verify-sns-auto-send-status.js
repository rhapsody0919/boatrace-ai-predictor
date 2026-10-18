#!/usr/bin/env node
/**
 * SNS ハブの自動送信ページ（/admin/sns-hub/auto、2026-10-18）の振り分けと、deadline-queue API の状態の返し方（ci）。
 *
 * - 要対応: 失敗・保留・送れずに失効したものは直近3日（JST）だけ。要照合は日付に関係なく出す。
 *   承認の失効（cancelled）・予定・公開済みは出さない
 * - 今日の一覧は JST の日付で切る（端末の時差に左右されない）
 * - 状態（モード・試運転・停止）が読めなくても待ち行列は返す（画面は「状態を取得できません」と出す）
 * - 状態の帯: 自動・本番／自動・試運転／個別承認、停止中は「全部止める」を押せない
 *
 *   node --test scripts/maintenance/verify-sns-auto-send-status.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  attentionRows,
  needsAttention,
  rowsOfDay,
  todayDay,
} from "../../src/utils/snsAutoSendStatus.js";

// JST 2026-10-18 12:00
const NOW = Date.parse("2026-10-18T03:00:00Z");
const at = (iso) => new Date(iso).toISOString();
const row = (over) => ({ id: over.id, channel: "x", ...over });

test("要対応: 直近3日の失敗・保留・失効だけ。要照合は古くても出す", () => {
  const rows = [
    row({
      id: "failed-today",
      state: "failed",
      scheduled_at: at("2026-10-18T01:00:00Z"),
    }),
    row({
      id: "held-2days",
      state: "held",
      scheduled_at: at("2026-10-16T01:00:00Z"),
      expires_at: at("2026-10-19T00:00:00Z"),
    }),
    row({
      id: "failed-old",
      state: "failed",
      scheduled_at: at("2026-10-15T01:00:00Z"),
    }),
    row({
      id: "reconcile-old",
      state: "reconcile",
      scheduled_at: at("2026-09-01T01:00:00Z"),
    }),
    row({
      id: "expired-queued",
      state: "queued",
      scheduled_at: at("2026-10-17T05:00:00Z"),
      expires_at: at("2026-10-17T06:00:00Z"),
    }),
    row({
      id: "cancelled",
      state: "cancelled",
      scheduled_at: at("2026-10-18T00:00:00Z"),
    }),
    row({
      id: "planned",
      state: "queued",
      scheduled_at: at("2026-10-18T06:00:00Z"),
      expires_at: at("2026-10-18T07:00:00Z"),
    }),
    row({
      id: "posted",
      state: "posted",
      posted_at: at("2026-10-18T01:30:00Z"),
    }),
    row({
      id: "failed-tomorrow",
      state: "failed",
      scheduled_at: at("2026-10-19T01:00:00Z"),
    }),
  ];
  assert.deepEqual(
    attentionRows(rows, NOW).map((r) => r.id),
    ["reconcile-old", "held-2days", "expired-queued", "failed-today"],
  );
});

test("今日は JST の日付で切る（UTC では前日の 15:00 以降も今日）", () => {
  assert.equal(todayDay(NOW), "2026-10-18");
  const rows = [
    row({
      id: "jst-morning",
      state: "posted",
      posted_at: at("2026-10-17T15:30:00Z"),
    }), // JST 10/18 00:30
    row({
      id: "jst-yesterday",
      state: "posted",
      posted_at: at("2026-10-17T14:30:00Z"),
    }), // JST 10/17 23:30
    row({
      id: "jst-evening",
      state: "queued",
      scheduled_at: at("2026-10-18T09:00:00Z"),
    }),
  ];
  assert.deepEqual(
    rowsOfDay(rows, todayDay(NOW)).map((r) => r.id),
    ["jst-morning", "jst-evening"],
  );
  assert.equal(needsAttention(rows[2], NOW), false);
});

test("deadline-queue API: 状態が読めなくても待ち行列を返し、読めれば control を付ける", async () => {
  const source = await readFile(
    new URL("../../api/admin/sns-hub/deadline-queue.js", import.meta.url),
    "utf8",
  );
  // 置き換え先の from '...' を閉じないよう、' も符号化する
  const stub = (code) =>
    "data:text/javascript," + encodeURIComponent(code).replaceAll("'", "%27");
  const load = async (control) => {
    globalThis.__queueTest = { control };
    const code = source
      .replace(
        /from ['"][^'"]*adminAuth\.js['"]/,
        `from '${stub("export const requireAdminAuth=async()=>null;")}'`,
      )
      .replace(
        /from ['"][^'"]*snsHubHelpers\.js['"]/,
        `from '${stub("export const isConfigured=()=>true;export const jsonResponse=(b,s=200)=>new Response(JSON.stringify(b),{status:s});")}'`,
      )
      .replace(
        /from ['"][^'"]*snsXSendStore\.js['"]/,
        `from '${stub("export const xSendStore={queue:async()=>[{id:'a'}],sendControl:async()=>{const c=globalThis.__queueTest.control;if(c instanceof Error)throw c;return c;}};")}'`,
      );
    const mod = await import(stub(code) + `#${Math.random()}`);
    const res = await mod.default(
      new Request("https://example.test/api/admin/sns-hub/deadline-queue"),
    );
    return { status: res.status, body: await res.json() };
  };
  const ok = await load({
    paused: false,
    channels: [{ channel: "x", mode: "auto", dry_run: false }],
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.data, [{ id: "a" }]);
  assert.equal(ok.body.control.channels[0].mode, "auto");
  const originalError = console.error;
  console.error = () => {};
  try {
    const failed = await load(new Error("offline"));
    assert.equal(failed.status, 200);
    assert.deepEqual(failed.body.data, [{ id: "a" }]);
    assert.equal(failed.body.control, null);
  } finally {
    console.error = originalError;
    delete globalThis.__queueTest;
  }
});

test("状態の帯: モードの表示と、停止中・取得できないときの表示", async () => {
  const { transform } = await import("esbuild");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const React = await import("react");
  let source = await readFile(
    new URL(
      "../../src/pages/admin/sns-hub/DeadlineQueuePanel.jsx",
      import.meta.url,
    ),
    "utf8",
  );
  source = source
    .replace(
      /import \{ useEffect, useRef, useState \} from "react";/,
      `import React, {useEffect,useRef,useState} from '${new URL("../../node_modules/react/index.js", import.meta.url).href}';`,
    )
    .replace(
      /import MonthCalendar from ["'][^"'\n]+["'];/,
      "const MonthCalendar=()=>null;",
    )
    .replace(
      /import \{[\s\S]*?\} from ["'][^"'\n]*snsMonthCalendar\.js["'];/,
      "const calendarMonth=()=>[],calendarRowDay=()=>null;",
    )
    .replace(
      /import \{[\s\S]*?\} from ["'][^"'\n]*snsAutoSendStatus\.js["'];/,
      "const attentionRows=()=>[],rowsOfDay=()=>[],todayDay=()=>'';",
    )
    .replace(
      /import \{[\s\S]*?\} from ["'][^"'\n]*snsHubService\.js["'];/,
      "const getDeadlineQueue=async()=>({rows:[],control:null}),stopXSend=async()=>{};",
    );
  const code = (await transform(source, { loader: "jsx", format: "esm" })).code;
  const { SendControlBand } = await import(
    "data:text/javascript," + encodeURIComponent(code)
  );
  const render = (control) =>
    renderToStaticMarkup(
      React.createElement(SendControlBand, {
        control,
        busy: false,
        onStop: async () => {},
      }),
    );
  const running = render({
    paused: false,
    channels: [
      { channel: "x", mode: "auto", dry_run: false },
      { channel: "youtube", mode: "auto", dry_run: true },
    ],
  });
  assert.match(running, /自動・本番/);
  assert.match(running, /自動・試運転/);
  assert.match(running, /動いている/);
  assert.match(running, /<button[^>]*>全部止める<\/button>/);
  const paused = render({
    paused: true,
    channels: [{ channel: "x", mode: "manual", dry_run: true }],
  });
  assert.match(paused, /個別承認/);
  assert.match(paused, /止まっている/);
  assert.match(paused, /<button[^>]*disabled[^>]*>全部止める<\/button>/);
  assert.match(render(null), /送信の状態を取得できません/);
});
