# Elyments SDK (Baileys-style)

This is a minimal TypeScript SDK for Elyments web: OTP login, chat list, group list, send text to users/groups, and XMPP receive.

## Setup

```bash
npm install
```

Create `.env` from `.env.example` and fill values.
`ELYMENTS_SENDER_NAME` is required to send messages.
Auth/session data is stored under `~/.elyments/auth/` by default.
If XMPP TLS verification fails, set `ELYMENTS_TLS_INSECURE=1`.

## CLI

Build once:
```bash
npm run build
```

Login (OTP prompt, saves auth in `~/.elyments/auth/`):
```bash
./dist/cli.js login --num +919686188814
```

Send text:
```bash
./dist/cli.js sendMessage --type Text --message "Hi" --to "+919620515656"
```

Import contacts for phone-only sending:
```bash
./dist/cli.js importContacts --file ./contacts.json
```

List chats and groups:
```bash
./dist/cli.js listChats
./dist/cli.js listGroups
```

Read history:
```bash
./dist/cli.js history --to "Swamiji Office Vds Aol" --limit 100 --timeout 8000
```

Listen for new messages:
```bash
./dist/cli.js listen --to "Test Group"
```

## Tests

```bash
npm test
```

## API

Start server:
```bash
npm run dev:api
```

Endpoints:
- `POST /login/otp` `{ countryCode, phoneNumber }`
- `POST /login/verify` `{ countryCode, phoneNumber, otp, sender? }`
- `GET /chats`
- `GET /groups`
- `POST /contacts/import` `{ contacts: [...] }`
- `POST /messages` `{ to, message, type?, sender? }`
- `GET /history?to=<jid|name|phone>&limit=100&timeout=8000`
- `GET /events?to=<jid|name|phone>` (SSE stream)

Docs:
- `docs/cli.md`
- `docs/api.md`
- `docs/openapi.yaml`
- `docs/clawdbot.md`

Notes:
- Contact auto-sync runs on startup if contacts exist; set `ELYMENTS_AUTO_SYNC_CONTACTS=0` to disable.
- Device identity persists in `~/.elyments/auth/device.json`. To keep refresh tokens stable across restarts, set `ELYMENTS_DEVICE_ID`, `ELYMENTS_DEVICE_TOKEN`, `ELYMENTS_DEVICE_PLATFORM`, and `ELYMENTS_RESOURCE` explicitly and avoid logging in on other devices.
- If refresh returns “multiple login attempts”, use `elyments logoutAllWeb` or `POST /logout/web` after re-login to clear other web sessions.

## Examples

List chats:
```bash
npm run dev:list
```

Send a direct message:
```bash
npm run dev:send
```

Send a group message (Test Group):
```bash
npm run dev:group
```

Receive messages (prints incoming stanzas):
```bash
npm run dev:receive
```

## Notes

- REST auth uses `https://identityapi.elyments.com/api/Identity/GenerateOtp/V2` and `VerifyOtp/V2`.
- Chat list uses `https://chatapi.elyments.com/api/inboxDetails/v2?limit=1000`.
- XMPP endpoint: `wss://chatim.elyments.com:5285/ws-xmpp` (domain `localhost`).
- Media send (image/voice) needs upload endpoints and is stubbed.
