import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ElymentsAuthStore } from "../src/store.js";

test("auth store persists device and session", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "elyments-store-"));
  const store = new ElymentsAuthStore(tmpDir);

  const device1 = await store.ensureDevice();
  const device2 = await store.ensureDevice();
  assert.equal(device1.deviceToken, device2.deviceToken);
  assert.equal(device1.resource, device2.resource);

  await store.saveSession({
    userId: "user-1",
    accessToken: "access",
    chatAccessToken: "chat"
  });
  const session = await store.loadSession();
  assert.equal(session?.userId, "user-1");

  await store.saveRecipients([
    {
      jid: "user-1@localhost",
      title: "User One",
      isGroup: false,
      numbers: ["919620515656"],
      updatedAt: "2024-01-01T00:00:00Z"
    }
  ]);
  const recipients = await store.loadRecipients();
  assert.equal(recipients?.[0]?.jid, "user-1@localhost");

  await rm(tmpDir, { recursive: true, force: true });
});
