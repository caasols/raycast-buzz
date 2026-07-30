# Buzz for Raycast

Drive your [Buzz](https://github.com/block/buzz) workspace from Raycast: browse channels, read
and search messages, post a reply, react, and set your status without leaving the keyboard.

Buzz is Block's self-hostable workspace where humans and agents collaborate. It is architecturally
a Nostr relay, so every action is a cryptographically signed event. This extension talks to your
relay directly over its authenticated HTTP bridge. It does not require the `buzz` CLI or any other
binary to be installed.

## Commands

| Command         | What it does                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Search Channels | Lists every channel on your relay. Open one to read its recent messages, react with a like, or copy a message or channel id. |
| Search Messages | Full-text search across the channels you can access.                                                                         |
| Send Message    | Posts a message to a channel you pick from a dropdown.                                                                       |
| Set Status      | Sets your user status, with an optional emoji.                                                                               |

## Setup

You need a Buzz relay you can reach and a Nostr private key that is authorized on it. Both are
configured once, in the extension's preferences.

1. **Relay URL.** Your relay's base URL, for example `https://relay.example.com`. Nostr relays are
   usually written as `wss://`, so that form is accepted too and converted automatically.
2. **Private Key.** Your Nostr secret key, either an `nsec1...` bech32 string or a 64-character
   hex string. This is the same value the Buzz CLI reads from `BUZZ_PRIVATE_KEY`.

If either value is missing or malformed, every command shows the problem and offers a shortcut
straight to the preferences screen.

## About your private key

Your key is stored by Raycast as a password preference and is never transmitted anywhere except
as a signature. Specifically:

- The extension signs each request locally (NIP-98) and sends only the resulting signature to your
  relay. The key itself never leaves your machine.
- No error message produced by the extension ever includes your key or the body of a request, so a
  toast or a copied error cannot leak it.
- There is no telemetry and no third-party service. The only host contacted is the relay URL you
  configure.

## Requirements and limits

This version speaks to the relay over HTTP only, which covers everything the commands above need.
The following are not available yet because they require an authenticated WebSocket connection
(NIP-42) to the relay:

- Direct messages, which additionally need NIP-17 gift-wrap encryption.
- Presence, which the relay accepts only over WebSocket.
- A live or menu bar feed, and unread tracking.

## Development

```bash
npm install
npm run dev            # run the extension in Raycast
npm test               # unit and component tests
npm run test:coverage  # the same, with a coverage report
npm run lint
npm run build
```

There is also an end-to-end smoke test that runs against a real relay. It lists channels, posts a
marker message, reads it back, and reacts to it, so point it at a workspace where that is
acceptable:

```bash
BUZZ_RELAY_URL=https://relay.example.com BUZZ_PRIVATE_KEY=nsec1... npm run smoke
```

## License

MIT
