import "dotenv/config";
import { Command } from "commander";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { ElymentsClient } from "./client.js";
import { resolveStoreDir } from "./store.js";

const program = new Command();
program.name("elyments").description("Elyments CLI (Baileys-style)");

function resolveSessionPath(option?: string): string | undefined {
  return option ?? process.env.ELYMENTS_SESSION_PATH;
}

function resolveStorePath(option?: string): string | undefined {
  return option ?? resolveStoreDir();
}

function resolveSenderName(option?: string): string | undefined {
  return option ?? process.env.ELYMENTS_SENDER_NAME;
}

function createClient(
  sessionPath?: string,
  senderName?: string,
  storeDir?: string
): ElymentsClient {
  return new ElymentsClient({
    sessionPath,
    storeDir,
    origin: process.env.ELYMENTS_ORIGIN,
    senderName
  });
}

program
  .command("login")
  .requiredOption("--num <phone>", "phone number including country code")
  .option("--country <code>", "country code", process.env.ELYMENTS_COUNTRY_CODE ?? "+91")
  .option("--otp <otp>", "OTP code")
  .option("--session <path>", "session path")
  .option("--store <path>", "store directory (default ~/.elyments)")
  .action(async (opts) => {
    const sessionPath = resolveSessionPath(opts.session);
    const storeDir = resolveStorePath(opts.store);
    const client = createClient(sessionPath, undefined, storeDir);
    client.on("error", (err) => {
      console.error("XMPP error:", err.message);
    });
    await client.loadSession();

    if (!opts.otp) {
      await client.requestOtp({ countryCode: opts.country, phoneNumber: opts.num });
      const rl = readline.createInterface({ input, output });
      const otp = await rl.question("Enter OTP: ");
      rl.close();
      opts.otp = otp.trim();
    }

    await client.verifyOtp({ countryCode: opts.country, phoneNumber: opts.num, otp: opts.otp });
    console.log(`Session saved to ${sessionPath ?? storeDir}`);
  });

program
  .command("listChats")
  .option("--session <path>", "session path")
  .option("--store <path>", "store directory (default ~/.elyments)")
  .action(async (opts) => {
    const client = createClient(
      resolveSessionPath(opts.session),
      undefined,
      resolveStorePath(opts.store)
    );
    client.on("error", (err) => {
      console.error("XMPP error:", err.message);
    });
    await client.loadSession();
    const chats = await client.listChats();
    console.table(
      chats.map((chat) => ({
        title: chat.title,
        jid: chat.jid,
        isGroup: chat.isGroup,
        lastMessage: chat.lastMessage ?? ""
      }))
    );
  });

program
  .command("listGroups")
  .option("--session <path>", "session path")
  .option("--store <path>", "store directory (default ~/.elyments)")
  .action(async (opts) => {
    const client = createClient(
      resolveSessionPath(opts.session),
      undefined,
      resolveStorePath(opts.store)
    );
    client.on("error", (err) => {
      console.error("XMPP error:", err.message);
    });
    await client.loadSession();
    const groups = await client.listGroups();
    console.table(groups.map((chat) => ({ title: chat.title, jid: chat.jid })));
  });

program
  .command("mapPhone")
  .requiredOption("--phone <phone>", "phone number including country code")
  .requiredOption("--to <recipient>", "jid, phone number, or chat title")
  .option("--group", "treat recipient as group name")
  .option("--session <path>", "session path")
  .option("--store <path>", "store directory (default ~/.elyments)")
  .action(async (opts) => {
    const client = createClient(
      resolveSessionPath(opts.session),
      resolveSenderName(),
      resolveStorePath(opts.store)
    );
    client.on("error", (err) => {
      console.error("XMPP error:", err.message);
    });
    await client.loadSession();
    const entry = await client.addRecipientAlias(opts.to, opts.phone, {
      isGroup: Boolean(opts.group)
    });
    console.log(`Mapped ${opts.phone} -> ${entry.title} (${entry.jid})`);
  });

program
  .command("sendMessage")
  .requiredOption("--type <type>", "Text | Image | Video | Audio | Voice | Document | File")
  .option("--message <message>", "message text (for Text type) or caption (for media)")
  .option("--file <path>", "file path for media upload")
  .requiredOption("--to <recipient>", "jid, phone number, or chat title")
  .option("--group", "treat recipient as group name")
  .option("--session <path>", "session path")
  .option("--store <path>", "store directory (default ~/.elyments)")
  .option("--sender <name>", "sender name")
  .action(async (opts) => {
    const senderName = resolveSenderName(opts.sender);

    const client = createClient(
      resolveSessionPath(opts.session),
      senderName,
      resolveStorePath(opts.store)
    );
    client.on("error", (err) => {
      console.error("XMPP error:", err.message);
    });
    await client.loadSession();

    const type = String(opts.type).toLowerCase();
    const isText = type === "text";

    let id: string;
    const recipient = await client.resolveRecipient(opts.to, { isGroup: Boolean(opts.group) });

    if (isText) {
      if (!opts.message) throw new Error("--message is required for type Text.");
      id = await client.sendText({
        jid: recipient.jid,
        text: opts.message,
        isGroup: recipient.isGroup
      });
    } else {
      if (!opts.file) throw new Error("--file is required for media types.");
      id = await client.uploadAndSendMedia(opts.file, opts.to, {
        isGroup: Boolean(opts.group),
        caption: opts.message,
        senderName,
        type
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
    await client.disconnectXmpp();
    console.log(`Sent ${type} message ${id} to ${recipient.title} (${recipient.jid})`);
  });

program
  .command("history")
  .requiredOption("--to <recipient>", "jid, phone number, or chat title")
  .option("--limit <number>", "message limit", "100")
  .option("--timeout <ms>", "wait time for MAM results", "8000")
  .option("--group", "treat recipient as group name")
  .option("--session <path>", "session path")
  .option("--store <path>", "store directory (default ~/.elyments)")
  .action(async (opts) => {
    const client = createClient(
      resolveSessionPath(opts.session),
      resolveSenderName(),
      resolveStorePath(opts.store)
    );
    client.on("error", (err) => {
      console.error("XMPP error:", err.message);
    });
    await client.loadSession();
    const recipient = await client.resolveRecipient(opts.to, { isGroup: Boolean(opts.group) });
    const messages = await client.fetchHistoryMessages(
      recipient.jid,
      Number(opts.limit),
      Number(opts.timeout)
    );
    console.table(
      messages.map((msg) => ({
        time: msg.timestamp ?? "",
        type: msg.type,
        fromName: msg.senderName ?? "",
        from: msg.from,
        to: msg.to,
        text: msg.text ?? "",
        messageId: msg.messageId ?? ""
      }))
    );
    await client.disconnectXmpp();
  });

program
  .command("listen")
  .option("--to <recipient>", "jid, phone number, or chat title")
  .option("--group", "treat recipient as group name")
  .option("--session <path>", "session path")
  .option("--store <path>", "store directory (default ~/.elyments)")
  .action(async (opts) => {
    const client = createClient(
      resolveSessionPath(opts.session),
      resolveSenderName(),
      resolveStorePath(opts.store)
    );
    client.on("error", (err) => {
      console.error("XMPP error:", err.message);
    });
    await client.loadSession();

    let filterJid: string | null = null;
    if (opts.to) {
      const recipient = await client.resolveRecipient(opts.to, { isGroup: Boolean(opts.group) });
      filterJid = recipient.jid;
    }

    client.on("message", (msg) => {
      if (filterJid && !(msg.from.includes(filterJid) || msg.to.includes(filterJid))) {
        return;
      }
      const stamp = msg.timestamp ?? new Date().toISOString();
      const fromLabel = msg.senderName ? `${msg.senderName} (${msg.from})` : msg.from;
      console.log(`[${stamp}] ${msg.type} ${fromLabel} -> ${msg.to}: ${msg.text ?? ""}`);
    });

    await client.connectXmpp();
    console.log("Listening for incoming messages...");
    setInterval(() => {}, 1000);
  });

program.parseAsync(process.argv);
