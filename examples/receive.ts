import { createClient, ensureSession } from "./utils.js";

const client = createClient();
await ensureSession(client);

client.on("message", (msg) => {
  console.log(`[${msg.type}] ${msg.from} -> ${msg.to}: ${msg.text ?? ""}`);
});

client.on("online", () => {
  console.log("XMPP online.");
});

client.on("offline", () => {
  console.log("XMPP offline.");
});

await client.connectXmpp();

const historyJid = process.env.ELYMENTS_HISTORY_JID;
if (historyJid) {
  await client.fetchHistory(historyJid, 100);
}

setInterval(() => {}, 1000);
