import { createClient, ensureSession, requireEnv } from "./utils.js";

const client = createClient();
await ensureSession(client);

const message = requireEnv("ELYMENTS_MESSAGE");
const toJid = process.env.ELYMENTS_TO_JID;
const toName = process.env.ELYMENTS_TO_NAME;

let targetJid = toJid ?? "";
if (!targetJid) {
  if (!toName) {
    throw new Error("Set ELYMENTS_TO_JID or ELYMENTS_TO_NAME.");
  }
  const chats = await client.listChats();
  const match = chats.find((chat) => chat.title.toLowerCase().includes(toName.toLowerCase()));
  if (!match) {
    throw new Error(`No chat found for name: ${toName}`);
  }
  targetJid = match.jid;
}

const messageId = await client.sendText({ jid: targetJid, text: message, isGroup: false });
console.log(`Sent message ${messageId} to ${targetJid}`);
