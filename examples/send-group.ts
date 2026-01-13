import { createClient, ensureSession, requireEnv } from "./utils.js";

const client = createClient();
await ensureSession(client);

const message = requireEnv("ELYMENTS_MESSAGE");
const groupJid = process.env.ELYMENTS_GROUP_JID ?? "";
const groupName = process.env.ELYMENTS_TEST_GROUP ?? "Test Group";

let targetJid = groupJid;
if (!targetJid) {
  const chats = await client.listChats();
  const match = chats.find((chat) => chat.isGroup && chat.title.toLowerCase().includes(groupName.toLowerCase()));
  if (!match) {
    throw new Error(`No group found for name: ${groupName}`);
  }
  targetJid = match.jid;
}

const messageId = await client.sendGroupText(targetJid, message);
console.log(`Sent group message ${messageId} to ${targetJid}`);
