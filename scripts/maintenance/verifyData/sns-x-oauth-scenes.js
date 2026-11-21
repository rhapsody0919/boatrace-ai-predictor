/**
 * verify-sns-x-oauth.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-sns-x-oauth.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createPostgrestTokenDb, getXAccessToken } from "../../../api/_lib/snsTokenStore.js";

let json, memoryDb, storedRow, NOW, refreshMock, base;

function scene1() {
  test("PostgREST: ロックは期限切れか空のときだけ取り、保存は locked_by が自分のときだけ", async () => {
    const calls = [];
    const db = createPostgrestTokenDb({
      url: "https://example.supabase.co",
      key: "service",
      fetchImpl: async (url, options) => {
        calls.push({ url: decodeURIComponent(String(url)), options });
        return json([{ provider: "x" }]);
      },
    });
    assert.equal(
      await db.tryLock("me", NOW, new Date(NOW.getTime() + 90000)),
      true,
    );
    assert.match(
      calls[0].url,
      /sns_oauth_tokens\?provider=eq\.x&or=\(lock_until\.is\.null,lock_until\.lt\.2026-10-13T03:00:00\.000Z\)$/,
    );
    assert.equal(calls[0].options.method, "PATCH");
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      lock_until: "2026-10-13T03:01:30.000Z",
      locked_by: "me",
    });
    assert.equal(await db.saveLocked("me", { ciphertext: "c" }), true);
    assert.match(calls[1].url, /provider=eq\.x&locked_by=eq\.me$/);
    assert.deepEqual(JSON.parse(calls[1].options.body), {
      ciphertext: "c",
      lock_until: null,
      locked_by: null,
    });
  });
  test("access token: refresh 中にオーナーが連携をやり直したら、誤って『やり直しが要る』を出さず新しいトークンを使う", async () => {
    const db = memoryDb(await storedRow("2026-10-13T02:00:00Z"));
    const reconnected = await storedRow("2026-10-13T05:00:00Z", {
      access_token: "reconnected-access",
      refresh_token: "reconnected-refresh",
    });
    const notices = [];
    const result = await getXAccessToken(
      base(db, {
        notify: async (m) => notices.push(m),
        fetchImpl: async () => {
          await db.upsert(reconnected); // コールバックの upsert がロックを外して新しい値を入れる
          return json({
            access_token: "access-2",
            refresh_token: "refresh-2",
            expires_in: 7200,
          });
        },
      }),
    );
    assert.equal(result.accessToken, "reconnected-access");
    assert.deepEqual(notices, []);
  });
  test("access token: 保存の DB エラーは理由つきで通知し、通知の失敗で元のエラーを隠さない、鍵の版違いは拒否する", async () => {
    const db = memoryDb(await storedRow("2026-10-13T02:00:00Z"));
    db.saveLocked = async () => {
      throw new Error("HTTP 500");
    };
    const notices = [];
    await assert.rejects(
      getXAccessToken(
        base(db, {
          fetchImpl: refreshMock().fetchImpl,
          notify: async (m) => notices.push(m),
        }),
      ),
      /DB の保存に失敗: HTTP 500/,
    );
    assert.match(notices[0], /HTTP 500/);

    const failing = memoryDb(await storedRow("2026-10-13T02:00:00Z"));
    await assert.rejects(
      getXAccessToken(
        base(failing, {
          fetchImpl: refreshMock({ status: 400 }).fetchImpl,
          notify: async () => {
            throw new Error("Slack down");
          },
        }),
      ),
      /トークンを取得できません/,
    );

    const old = { ...(await storedRow("2026-10-13T05:00:00Z")), key_version: 2 };
    await assert.rejects(getXAccessToken(base(memoryDb(old))), /未対応の鍵の版/);
  });
}

function scene2() {
  test("access token: 保存が成り立たず、確かめるための読み直しも失敗したら、連携のやり直しを通知してから投げる（D1）", async () => {
    for (const breakRead of [
      (db) => {
        db.read = async () => {
          throw new Error("HTTP 503");
        };
      },
      (db) => {
        // 別のトークンが入ったように見えるが、壊れていて復号できない
        const original = db.read.bind(db);
        db.read = async () => ({
          ...(await original()),
          ciphertext: "AAAA",
          auth_tag: "AAAAAAAAAAAAAAAAAAAAAA==",
        });
      },
    ]) {
      const db = memoryDb(await storedRow("2026-10-13T02:00:00Z"));
      const notices = [];
      let reads = 0;
      const realRead = db.read.bind(db);
      db.saveLocked = async () => false; // ロックを別の呼び出しに取られた
      const harness = {
        ...db,
        read: async () => {
          reads += 1;
          // 1・2回目（ロック前後の読み取り）は通し、保存の後の読み直しだけを壊す
          if (reads <= 2) return realRead();
          return harness.brokenRead();
        },
        tryLock: db.tryLock.bind(db),
        saveLocked: db.saveLocked,
        release: db.release.bind(db),
      };
      const broken = { read: realRead };
      breakRead(broken);
      harness.brokenRead = broken.read;
      await assert.rejects(
        getXAccessToken(
          base(harness, {
            fetchImpl: refreshMock().fetchImpl,
            notify: async (m) => notices.push(m),
          }),
        ),
        /連携のやり直し/,
      );
      assert.equal(notices.length, 1);
      assert.match(notices[0], /連携のやり直しが要る/);
    }
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（json・memoryDb・storedRow・NOW・refreshMock・base） */
export function runSnsXOauthScenes1(env) {
  ({ json, memoryDb, storedRow, NOW, refreshMock, base } = env);
  scene1();
  scene2();
}
