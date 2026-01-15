import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ElymentsClient } from "../src/client.js";

class TestClient extends ElymentsClient {
  constructor(storeDir: string) {
    super({ storeDir });
  }

  protected async fetchChats() {
    return [
      {
        id: "direct-1",
        jid: "user-1@localhost",
        isGroup: false,
        title: "Swamiji Office Vds Aol",
        lastMessage: "hi",
        raw: { phoneNumber: "+919620515656" }
      },
      {
        id: "group-1",
        jid: "group-1@muclight.localhost",
        isGroup: true,
        title: "Test Group",
        lastMessage: "",
        raw: {}
      }
    ];
  }
}

class ContactSyncClient extends ElymentsClient {
  constructor(
    storeDir: string,
    private readonly contacts: Array<{ name: string; phone: string }>,
    private readonly profileContacts: Array<{ contactId: string; name: string }>
  ) {
    super({ storeDir });
  }

  protected async fetchChats() {
    return [];
  }

  protected async loadLocalContacts() {
    return this.contacts;
  }

  protected async fetchProfileContacts() {
    return this.profileContacts;
  }
}

test("resolveRecipient accepts jid", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "elyments-recipient-"));
  const client = new TestClient(tmpDir);
  try {
    const recipient = await client.resolveRecipient("abc@localhost");
    assert.equal(recipient.jid, "abc@localhost");
    assert.equal(recipient.isGroup, false);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("resolveRecipient matches chat title", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "elyments-recipient-"));
  const client = new TestClient(tmpDir);
  try {
    const recipient = await client.resolveRecipient("Swamiji Office Vds Aol");
    assert.equal(recipient.jid, "user-1@localhost");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("resolveRecipient matches group by name with flag", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "elyments-recipient-"));
  const client = new TestClient(tmpDir);
  try {
    const recipient = await client.resolveRecipient("Test Group", { isGroup: true });
    assert.equal(recipient.jid, "group-1@muclight.localhost");
    assert.equal(recipient.isGroup, true);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("resolveRecipient matches phone numbers", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "elyments-recipient-"));
  const client = new TestClient(tmpDir);
  try {
    const recipient = await client.resolveRecipient("+919620515656");
    assert.equal(recipient.jid, "user-1@localhost");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("resolveRecipient maps phone via contacts sync", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "elyments-recipient-"));
  const client = new ContactSyncClient(
    tmpDir,
    [{ name: "Contact Sync User", phone: "+919999999999" }],
    [{ contactId: "user-42", name: "Contact Sync User" }]
  );
  try {
    const recipient = await client.resolveRecipient("+919999999999");
    assert.equal(recipient.jid, "user-42@localhost");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
