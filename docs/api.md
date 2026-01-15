# API Reference

Base URL: `http://localhost:${ELYMENTS_PORT:-3000}`

All endpoints respond with JSON. On error: `{ ok: false, error: "<message>" }`.

## Auth

`POST /login/otp`

Body:
```json
{ "countryCode": "+91", "phoneNumber": "9999999999" }
```

`POST /login/verify`

Body:
```json
{ "countryCode": "+91", "phoneNumber": "9999999999", "otp": "123456", "sender": "Display Name" }
```

`POST /logout/web`

Logs out other web sessions to avoid refresh-token invalidation.

## Chats/Groups

`GET /chats`

`GET /groups`

## Recipients

`POST /recipients/alias`

Body:
```json
{ "to": "Contact Name or JID", "phone": "+919999999999", "group": false }
```

## Contacts (for phone-only sending)

`POST /contacts/import`

Body:
```json
{
  "contacts": [
    { "name": "Contact Name", "phone": "+919999999999" },
    { "name": "Multi", "numbers": ["+12025550123", "+12025550124"] }
  ]
}
```

Notes:
- The resolver matches by contact name from Elyments sync, so names must align with what you synced.
- Set `ELYMENTS_CONTACTS_PATH` to point to a contacts JSON file if you prefer not to import.
- Auto-sync runs on startup when contacts exist; set `ELYMENTS_AUTO_SYNC_CONTACTS=0` to disable.
- For long-lived refresh tokens, keep a stable device identity via `ELYMENTS_DEVICE_ID`, `ELYMENTS_DEVICE_TOKEN`, `ELYMENTS_DEVICE_PLATFORM`, and `ELYMENTS_RESOURCE`, and avoid logging in on other devices.

## Send messages

`POST /messages`

Body (text):
```json
{ "to": "+919999999999", "message": "Hi", "type": "Text", "sender": "Display Name" }
```

Body (media):
```json
{ "to": "Contact Name", "type": "Image", "file": "/path/to/image.jpg", "message": "caption" }
```

## History

`GET /history?to=<jid|name|phone>&limit=100&timeout=8000&group=false`

## Events (SSE)

`GET /events?to=<jid|name|phone>&group=false`

Response is an `text/event-stream` feed of sanitized messages.
