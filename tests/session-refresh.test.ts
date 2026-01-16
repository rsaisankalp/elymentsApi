import test from "node:test";
import assert from "node:assert/strict";
import { ElymentsClient } from "../src/client.js";
import type { ElymentsSession } from "../src/types.js";

class RefreshTestClient extends ElymentsClient {
  refreshCount = 0;

  async refreshSession(): Promise<ElymentsSession> {
    this.refreshCount += 1;
    return (this as any).session;
  }
}

function buildToken(expOffsetSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + expOffsetSeconds;
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64");
  return `header.${payload}.sig`;
}

test("ensureValidSession refreshes when token is expiring", async () => {
  const client = new RefreshTestClient();
  (client as any).session = {
    userId: "user-1",
    accessToken: buildToken(-10),
    chatAccessToken: buildToken(120),
    refreshToken: "refresh-1"
  } satisfies ElymentsSession;

  await client.ensureValidSession();
  assert.equal(client.refreshCount, 1);
});

test("ensureValidSession skips refresh when tokens look valid", async () => {
  const client = new RefreshTestClient();
  (client as any).session = {
    userId: "user-1",
    accessToken: buildToken(3600),
    chatAccessToken: buildToken(3600),
    refreshToken: "refresh-1"
  } satisfies ElymentsSession;

  await client.ensureValidSession();
  assert.equal(client.refreshCount, 0);
});
