import { createClient, ensureSession } from "./utils.js";

const client = createClient();

await ensureSession(client);
const chats = await client.listChats();

const rows = chats.map((chat) => ({
  title: chat.title,
  jid: chat.jid,
  isGroup: chat.isGroup,
  lastMessage: chat.lastMessage ?? ""
}));

console.table(rows);
