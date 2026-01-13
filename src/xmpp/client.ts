import { client as createClient, xml } from "@xmpp/client";
import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import WebSocket from "ws";
import { OAuthBearerMechanism } from "./oauthbearer.js";
import { ElymentsMessage, ElymentsSession, SendTextRequest } from "../types.js";

type XmppClientOptions = {
  session: ElymentsSession;
  origin: string;
  resource?: string;
  domain?: string;
  service?: string;
  wsOrigin?: string;
  tlsInsecure?: boolean;
};

export class ElymentsXmppClient extends EventEmitter {
  private xmpp: ReturnType<typeof createClient> | null = null;
  private readonly session: ElymentsSession;
  private readonly origin: string;
  private readonly resource: string;
  private readonly domain: string;
  private readonly service: string;
  private readonly wsOrigin: string;
  private readonly tlsInsecure: boolean;

  constructor(options: XmppClientOptions) {
    super();
    this.session = options.session;
    this.origin = options.origin;
    this.resource = options.resource ?? "web";
    this.domain = options.domain ?? "localhost";
    this.service = options.service ?? "wss://chatim.elyments.com:5285/ws-xmpp";
    this.wsOrigin = options.wsOrigin ?? "https://web.elyments.com";
    this.tlsInsecure =
      options.tlsInsecure ?? process.env.ELYMENTS_TLS_INSECURE === "1";
  }

  async connect(): Promise<void> {
    if (this.xmpp) return;
    ensureWebSocket(this.wsOrigin, this.tlsInsecure);
    const { userId, chatAccessToken } = this.session;

    const xmpp = createClient({
      service: this.service,
      domain: this.domain,
      username: userId,
      resource: this.resource,
      credentials: async (
        authenticate: (
          creds: { username: string; token?: string; password?: string },
          mechanism: string
        ) => Promise<void>,
        mechanisms: string[]
      ) => {
        if (mechanisms.includes("OAUTHBEARER")) {
          await authenticate({ username: userId, token: chatAccessToken }, "OAUTHBEARER");
          return;
        }
        if (mechanisms.includes("PLAIN")) {
          await authenticate({ username: userId, password: chatAccessToken }, "PLAIN");
          return;
        }
        throw new Error(`No supported mechanisms offered: ${mechanisms.join(", ")}`);
      }
    });

    xmpp.saslFactory.use(OAuthBearerMechanism);

    xmpp.on("online", async () => {
      this.emit("online");
      await this.startSession().catch((error) => this.emit("error", error));
      await xmpp.send(
        xml(
          "presence",
          { xmlns: "jabber:client" },
          xml("show", {}, "chat"),
          xml("priority", {}, "10")
        )
      );
      await this.enableCarbons().catch((error) => this.emit("error", error));
      await this.requestRoster().catch((error) => this.emit("error", error));
      this.startKeepalive();
    });

    xmpp.on("stanza", (stanza: any) => {
      if (process.env.ELYMENTS_XMPP_DEBUG === "1") {
        console.log("XMPP_IN", stanza.toString());
      }
      if (!stanza.is("message")) return;
      const message = parseMessage(stanza);
      if (message) this.emit("message", message);
    });

    if (process.env.ELYMENTS_XMPP_DEBUG === "1") {
      xmpp.on("send", (stanza: any) => {
        console.log("XMPP_OUT", stanza.toString());
      });
      xmpp.on("element", (stanza: any) => {
        if (!stanza?.is) {
          console.log("XMPP_ELEMENT", stanza?.toString?.() ?? stanza);
          return;
        }
        if (stanza.is("features") || stanza.is("challenge") || stanza.is("success")) {
          console.log("XMPP_ELEMENT", stanza.toString());
        }
      });
    }

    xmpp.on("error", (error: Error) => this.emit("error", error));
    xmpp.on("offline", () => this.emit("offline"));
    xmpp.on("offline", () => this.stopKeepalive());

    this.xmpp = xmpp;
    await xmpp.start();
  }

  async disconnect(): Promise<void> {
    if (!this.xmpp) return;
    this.stopKeepalive();
    await this.xmpp.stop();
    this.xmpp = null;
  }

  async sendText(request: SendTextRequest): Promise<string> {
    if (!this.xmpp) throw new Error("XMPP is not connected.");

    const stanzaId = crypto.randomUUID();
    const bodyId = crypto.randomBytes(16).toString("hex").toUpperCase();
    const body = JSON.stringify({
      senderName: request.senderName,
      ver: 1,
      info: { message: request.text },
      id: bodyId,
      type: "text",
      lang: request.lang ?? "en",
      isFwd: false,
      origin: request.origin ?? this.origin
    });

    const type = request.isGroup ? "groupchat" : "chat";
    const stanza = xml(
      "message",
      { xmlns: "jabber:client", id: stanzaId, to: request.jid, type },
      xml("origin-id", { xmlns: "urn:xmpp:sid:0", id: stanzaId }),
      xml("body", {}, body)
    );

    await this.xmpp.send(stanza);
    return bodyId;
  }

  async sendDisplayed(jid: string, messageId: string, isGroup?: boolean): Promise<void> {
    if (!this.xmpp) throw new Error("XMPP is not connected.");
    const type = isGroup ? "groupchat" : "chat";
    const stanza = xml(
      "message",
      { xmlns: "jabber:client", id: `${messageId}-disp`, to: jid, type },
      xml("origin-id", { xmlns: "urn:xmpp:sid:0", id: `${messageId}-disp` }),
      xml("displayed", { xmlns: "urn:xmpp:chat-markers:0", id: messageId })
    );
    await this.xmpp.send(stanza);
  }

  async fetchHistory(jid: string, max = 100): Promise<void> {
    if (!this.xmpp) throw new Error("XMPP is not connected.");
    const queryId = crypto.randomUUID();
    const stanza = xml(
      "iq",
      { xmlns: "jabber:client", id: queryId, type: "set" },
      xml(
        "query",
        { xmlns: "urn:xmpp:mam:2", queryid: queryId },
        xml("set", { xmlns: "http://jabber.org/protocol/rsm" }, xml("before"), xml("max", {}, String(max))),
        xml(
          "x",
          { xmlns: "jabber:x:data", type: "submit" },
          xml("field", { var: "FORM_TYPE", type: "hidden" }, xml("value", {}, "urn:xmpp:mam:2")),
          xml("field", { var: "with", type: "text-single" }, xml("value", {}, jid))
        )
      )
    );
    await this.xmpp.send(stanza);
  }

  private keepaliveTimer?: NodeJS.Timeout;

  private startKeepalive(): void {
    if (this.keepaliveTimer) return;
    this.keepaliveTimer = setInterval(() => {
      if (!this.xmpp) return;
      const id = crypto.randomUUID();
      const stanza = xml(
        "iq",
        { xmlns: "jabber:client", id, type: "get", to: this.domain },
        xml("ping", { xmlns: "urn:xmpp:ping" })
      );
      this.xmpp.send(stanza).catch((error: Error) => this.emit("error", error));
    }, 30000);
  }

  private stopKeepalive(): void {
    if (!this.keepaliveTimer) return;
    clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = undefined;
  }

  private async enableCarbons(): Promise<void> {
    if (!this.xmpp) return;
    const id = crypto.randomUUID();
    const stanza = xml(
      "iq",
      { xmlns: "jabber:client", id, type: "set" },
      xml("enable", { xmlns: "urn:xmpp:carbons:2" })
    );
    await this.xmpp.send(stanza);
  }

  private async startSession(): Promise<void> {
    if (!this.xmpp) return;
    const id = crypto.randomUUID();
    const stanza = xml(
      "iq",
      { xmlns: "jabber:client", id, type: "set" },
      xml("session", { xmlns: "urn:ietf:params:xml:ns:xmpp-session" })
    );
    await this.xmpp.send(stanza);
  }

  private async requestRoster(): Promise<void> {
    if (!this.xmpp) return;
    const id = crypto.randomUUID();
    const stanza = xml(
      "iq",
      { xmlns: "jabber:client", id, type: "get" },
      xml("query", { xmlns: "jabber:iq:roster" })
    );
    await this.xmpp.send(stanza);
  }
}

let wsPatched = false;
function ensureWebSocket(origin: string, tlsInsecure: boolean): void {
  if (wsPatched) return;
  class ElymentsWebSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, {
        origin,
        headers: { Origin: origin },
        rejectUnauthorized: tlsInsecure ? false : undefined
      });
    }
  }
  (globalThis as any).WebSocket = ElymentsWebSocket;
  wsPatched = true;
}

function parseMessage(stanza: any): ElymentsMessage | null {
  const from = stanza.attrs.from ?? "";
  const to = stanza.attrs.to ?? "";
  const type = stanza.attrs.type ?? "chat";

  const directBody = stanza.getChildText("body");
  if (directBody) {
    const stamp = extractDelayStamp(stanza);
    return createMessage(from, to, type, directBody, stanza, stamp);
  }

  const mamResult = stanza.getChild("result", "urn:xmpp:mam:2");
  const forwarded = mamResult?.getChild("forwarded", "urn:xmpp:forward:0");
  const inner = forwarded?.getChild("message");
  const mamBody = inner?.getChildText("body");
  if (mamBody) {
    const stamp = extractDelayStamp(forwarded);
    return createMessage(
      inner.attrs.from ?? from,
      inner.attrs.to ?? to,
      inner.attrs.type ?? type,
      mamBody,
      stanza,
      stamp
    );
  }

  return null;
}

function createMessage(
  from: string,
  to: string,
  type: string,
  body: string,
  raw: unknown,
  timestamp?: string
): ElymentsMessage {
  let text: string | undefined;
  let senderName: string | undefined;
  let messageId: string | undefined;
  try {
    const parsed = JSON.parse(body) as {
      info?: { message?: string };
      senderName?: string;
      sender_name?: string;
      id?: string;
    };
    text = parsed?.info?.message;
    senderName = parsed?.senderName ?? parsed?.sender_name;
    messageId = parsed?.id;
  } catch {
    text = body;
  }
  return {
    id: crypto.randomUUID(),
    jid: to,
    from,
    to,
    type: type === "groupchat" ? "groupchat" : "chat",
    text,
    senderName,
    messageId,
    timestamp,
    raw
  };
}

function extractDelayStamp(stanza: any): string | undefined {
  const delay = stanza?.getChild?.("delay", "urn:xmpp:delay");
  return delay?.attrs?.stamp;
}
