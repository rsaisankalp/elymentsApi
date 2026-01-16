# Elyments SDK

A TypeScript SDK for Elyments messaging: OTP login, send text/media to users & groups via phone numbers or names.

## Quick Start

```bash
# 1. Install
npm install && npm run build

# 2. Set your sender name
export ELYMENTS_SENDER_NAME="Your Name"

# 3. Login with OTP
./dist/cli.js login --num +919686188814

# 4. Import Google Contacts (optional but recommended)
gog auth add  # Setup gogcli first: https://github.com/steipete/gogcli
./dist/cli.js importGoogleContacts --account your@gmail.com

# 5. Send messages using phone numbers!
./dist/cli.js sendMessage --type Text --message "Hello!" --to "+919620515656"
./dist/cli.js sendMessage --type Image --file ./photo.jpg --to "+919620515656"
./dist/cli.js sendMessage --type Video --file ./video.mp4 --to "Test Group" --group
```

## Features

- **Phone number support**: Send to phone numbers directly (requires Google Contacts import)
- **Media support**: Image, Video, Audio, Voice, Document, PDF
- **Auto token refresh**: Tokens refresh automatically, no manual intervention needed
- **Group messaging**: Send to groups using `--group` flag

## CLI Commands

| Command | Description |
|---------|-------------|
| `login --num <phone>` | Login with OTP |
| `sendMessage --type <type> --to <recipient>` | Send text or media |
| `importGoogleContacts` | Import contacts from Google |
| `listChats` | List all chats |
| `listGroups` | List all groups |
| `mapPhone --phone <phone> --to <name>` | Manually map phone to contact |
| `history --to <recipient>` | Fetch message history |
| `listen --to <recipient>` | Listen for incoming messages |
| `logoutAllWeb` | Logout all web sessions |

## Send Messages

```bash
# Text
./dist/cli.js sendMessage --type Text --message "Hello" --to "+919620515656"

# Image with caption
./dist/cli.js sendMessage --type Image --file ./photo.jpg --message "Check this!" --to "+919620515656"

# Video
./dist/cli.js sendMessage --type Video --file ./video.mp4 --to "+919620515656"

# Audio
./dist/cli.js sendMessage --type Audio --file ./audio.mp3 --to "+919620515656"

# Document
./dist/cli.js sendMessage --type Document --file ./file.pdf --to "+919620515656"

# Group message
./dist/cli.js sendMessage --type Text --message "Hello group!" --to "Test Group" --group
```

## Phone Number Resolution

The SDK resolves phone numbers by:
1. Looking up the phone in your Google Contacts
2. Matching the contact name with Elyments chat names (word-based matching)
3. Sending to the matched chat

**Requirements:**
- Phone must exist in Google Contacts (run `importGoogleContacts`)
- Contact must have an existing chat in Elyments
- Names must share at least 2 significant words (e.g., "Office Of Swamijis" ↔ "Swamijis Office")

## REST API Server

```bash
npm run dev:api  # Starts on port 3000
```

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/login/otp` | POST | Request OTP |
| `/login/verify` | POST | Verify OTP |
| `/chats` | GET | List chats |
| `/groups` | GET | List groups |
| `/messages` | POST | Send message |
| `/contacts/import` | POST | Import contacts |
| `/history` | GET | Fetch history |
| `/events` | GET | SSE stream |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ELYMENTS_SENDER_NAME` | **Required** - Your display name | - |
| `ELYMENTS_STORE_DIR` | Auth storage directory | `~/.elyments` |
| `ELYMENTS_TLS_INSECURE` | Disable TLS verification | `0` |
| `ELYMENTS_COUNTRY_CODE` | Default country code | `+91` |
| `ELYMENTS_XMPP_DEBUG` | Enable XMPP debug logs | `0` |
| `ELYMENTS_FFMPEG` | ffmpeg binary path | `ffmpeg` |
| `ELYMENTS_FFPROBE` | ffprobe binary path | `ffprobe` |

## Troubleshooting

**"Multiple login attempts" error:**
```bash
./dist/cli.js logoutAllWeb  # Then login again
```

**TLS verification fails:**
```bash
export ELYMENTS_TLS_INSECURE=1
```

**Token expired errors:**
Tokens refresh automatically. If issues persist, re-login.

## Technical Details

- Auth: `https://identityapi.elyments.com/api/Identity/`
- Chat API: `https://chatapi.elyments.com/api/`
- XMPP: `wss://chatim.elyments.com:5285/ws-xmpp`
- Media: Azure blob storage

## Docs

- [CLI Reference](docs/cli.md)
- [API Reference](docs/api.md)
- [OpenAPI Spec](docs/openapi.yaml)
