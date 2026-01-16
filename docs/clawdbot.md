# Clawdbot Integration Notes

This repo exposes a minimal adapter so Elyments can be wired as a Clawdbot provider.

## Outbound adapter

Import the adapter and map it to the WhatsApp-style outbound interface:

```ts
import { sendMessageElyments } from "elyments-sdk";

// Signature matches sendMessageWhatsApp shape.
await sendMessageElyments("+919999999999", "Hi", {
  mediaUrl: "https://example.com/file.jpg",
  type: "image",
  senderName: "Display Name"
});
```

Notes:
- `mediaUrl` is downloaded to a temp file before sending.
- Reactions and polls are not supported (the adapter throws).

## Inbound (XMPP)

Use `ElymentsClient` directly for inbound:

```ts
const client = new ElymentsClient();
await client.loadSession();
await client.connectXmpp();
client.on("message", (msg) => {
  // map msg.from / msg.to into Clawdbot inbound format
});
```

## Phone-only sending

If Clawdbot passes phone numbers as targets, make sure Elyments has a mapping:
- Import contacts via `POST /contacts/import` or `elyments importContacts`.
- Or map a phone alias via `elyments mapPhone`.
