# CLI Reference

The CLI stores auth/session data under `~/.elyments/auth/` by default.

## Login

```bash
elyments login --num +919999999999 --country +91
```

## List chats/groups

```bash
elyments listChats
elyments listGroups
```

## Logout other web sessions

Use this if refresh tokens are being invalidated due to multiple logins.

```bash
elyments logoutAllWeb
```

## Map phone to a known recipient

Use this when you already have a chat title or JID.

```bash
elyments mapPhone --phone +919999999999 --to "Contact Name"
```

## Import contacts (for phone-only sending)

Import a local contacts JSON file so phone numbers can be resolved without manual mapping.

```bash
elyments importContacts --file ./contacts.json
```

Contacts file format (example):

```json
[
  { "name": "Contact Name", "phone": "+919999999999" },
  { "name": "Alternate Name", "phoneNumber": "919888888888" },
  { "name": "Multi", "numbers": ["+12025550123", "+12025550124"] }
]
```

Notes:
- The resolver matches by contact name from Elyments sync, so names must align with what you synced.
- Set `ELYMENTS_CONTACTS_PATH` to point to a contacts JSON file if you prefer not to import.
- Auto-sync runs on startup when contacts exist; set `ELYMENTS_AUTO_SYNC_CONTACTS=0` to disable.
- For long-lived refresh tokens, keep a stable device identity via `ELYMENTS_DEVICE_ID`, `ELYMENTS_DEVICE_TOKEN`, `ELYMENTS_DEVICE_PLATFORM`, and `ELYMENTS_RESOURCE`, and avoid logging in on other devices.

## Send message

```bash
elyments sendMessage --type Text --message "Hi" --to "+919999999999"
```

Media:

```bash
elyments sendMessage --type Image --file ./image.jpg --message "caption" --to "Contact Name"
```

## History

```bash
elyments history --to "+919999999999" --limit 100 --timeout 8000
```

## Listen (XMPP)

```bash
elyments listen --to "Test Group" --group
```
