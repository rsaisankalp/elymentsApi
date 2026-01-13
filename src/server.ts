import "dotenv/config";
import express, { Request, Response } from "express";
import { ElymentsClient } from "./client.js";

const app = express();
app.use(express.json());

const sessionPath = process.env.ELYMENTS_SESSION_PATH;
const storeDir = process.env.ELYMENTS_STORE_DIR;
const senderName = process.env.ELYMENTS_SENDER_NAME;
const origin = process.env.ELYMENTS_ORIGIN;
const port = Number(process.env.ELYMENTS_PORT ?? 3000);

const client = new ElymentsClient({ sessionPath, storeDir, senderName, origin });
await client.loadSession();

function sanitizeMessage(message: any) {
  return { ...message, raw: undefined };
}

app.post("/login/otp", async (req: Request, res: Response) => {
  try {
    const { countryCode, phoneNumber } = req.body ?? {};
    const result = await client.requestOtp({ countryCode, phoneNumber });
    res.json({ ok: true, result });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/login/verify", async (req: Request, res: Response) => {
  try {
    const { countryCode, phoneNumber, otp, sender } = req.body ?? {};
    if (sender) client.setSenderName(sender);
    const session = await client.verifyOtp({ countryCode, phoneNumber, otp });
    res.json({ ok: true, session });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/chats", async (_req: Request, res: Response) => {
  try {
    const chats = await client.listChats();
    res.json({ ok: true, chats });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/groups", async (_req: Request, res: Response) => {
  try {
    const groups = await client.listGroups();
    res.json({ ok: true, groups });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/recipients/alias", async (req: Request, res: Response) => {
  try {
    const { to, phone, group } = req.body ?? {};
    if (!to || !phone) {
      res.status(400).json({ ok: false, error: "to and phone are required" });
      return;
    }
    const entry = await client.addRecipientAlias(String(to), String(phone), {
      isGroup: Boolean(group)
    });
    res.json({ ok: true, entry });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/messages", async (req: Request, res: Response) => {
  try {
    const { to, message, type, sender, group } = req.body ?? {};
    if (sender) client.setSenderName(sender);
    if (!to || !message) {
      res.status(400).json({ ok: false, error: "to and message are required" });
      return;
    }
    if (type && String(type).toLowerCase() !== "text") {
      res.status(400).json({ ok: false, error: "Only text messages are supported for now." });
      return;
    }
    const recipient = await client.resolveRecipient(String(to), { isGroup: Boolean(group) });
    const id = await client.sendText({
      jid: recipient.jid,
      text: String(message),
      isGroup: recipient.isGroup
    });
    res.json({ ok: true, id, recipient });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/history", async (req: Request, res: Response) => {
  try {
    const to = req.query.to as string;
    if (!to) {
      res.status(400).json({ ok: false, error: "to is required" });
      return;
    }
    const limit = Number(req.query.limit ?? 100);
    const timeout = Number(req.query.timeout ?? 8000);
    const group = String(req.query.group ?? "").toLowerCase() === "true";
    const recipient = await client.resolveRecipient(String(to), { isGroup: group });
    const messages = await client.fetchHistoryMessages(recipient.jid, limit, timeout);
    res.json({ ok: true, recipient, messages: messages.map(sanitizeMessage) });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/events", async (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const to = req.query.to as string | undefined;
  const group = String(req.query.group ?? "").toLowerCase() === "true";
  const recipient = to ? await client.resolveRecipient(to, { isGroup: group }) : null;

  const handler = (msg: any) => {
    if (recipient && !(msg.from.includes(recipient.jid) || msg.to.includes(recipient.jid))) {
      return;
    }
    res.write(`data: ${JSON.stringify(sanitizeMessage(msg))}\n\n`);
  };

  client.on("message", handler);
  await client.connectXmpp();

  req.on("close", () => {
    client.off("message", handler);
  });
});

app.listen(port, () => {
  console.log(`Elyments API listening on http://localhost:${port}`);
});
