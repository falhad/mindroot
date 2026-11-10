# Live collaboration

Edit a map with other people at the same time. It uses a small **relay server** that you run. The relay only passes messages and stores them; it never reads your maps.

## What you get

- Edits appear for everyone within a second or two. Typing in different ideas never clashes. Two people adding to the same list both keep their ideas.
- Who is in the map is shown in the header ("Live · 1 other here"), and each person's selected idea gets a coloured outline with their name.
- **Undo only undoes your own edits**, never what somebody else did in between.
- Edits made **offline** are kept and merged when the connection returns.
- The map is still saved on each computer as usual (and Git sync keeps working).

## Set up

1. **Run the relay** (see `server/relay/README.md`): `SECRET=<16+ characters> node server/relay/src/index.js`, or the Docker image. Put a TLS reverse proxy in front: the app connects with `wss://`. Use a long random secret.
2. In Branchmint: **Settings → Live collaboration**. Enter the relay address (`wss://relay.example.com`), your name, and the secret (or press Generate if you are setting up the relay now). The secret stays in your system keychain.
3. Open the map and run **⌘K → "Share this map live…"**. An invite is copied.
4. Send the invite **privately** to your colleague. They paste it in **Settings → Live collaboration → Join a shared map**. The map is downloaded into their library and opens.

## Security model

| Item | What it is |
|---|---|
| **Secret** | One per relay. Whoever knows it can make rooms for any map. Keep it to yourself and your own computers. |
| **Room** | One per map: `HMAC(secret, "room:" + mapId)`. Not guessable. |
| **Token** | `HMAC(secret, "token:" + room)`. The relay accepts a connection to a room only with its token. A wrong token is closed with code 4401. |
| **Invite** | The relay address, **one room and that room's token**, the map id and title. It does **not** contain the secret, so the person you invite cannot open your other maps or create rooms. Anyone who has the invite can read and edit that one map, so send it privately. |

More safety rules in the app:

- Joining never changes how your other shared maps connect, and never touches your secret.
- If an invite would replace how a map you already share is connected, or merge into a map you already have, you are asked first.
- A map from an invite is remembered only after the first connection worked.
- Plain `ws://` is accepted only for a server on your own computer.
- **Stop sharing** removes the map's connection and token from this computer. To cut everyone off, change the relay's secret: every old invite stops working.
- The relay is limited to 50 rooms, 20 people per room and 10 MB per message. Content is saved in its `DATA_DIR` (not encrypted at rest). The traffic is encrypted by `wss://`, but the relay can read it: run it yourself, on a machine you trust.

## When something goes wrong

| What you see | Meaning |
|---|---|
| "Offline · edits kept" | No connection. Keep working; it shares when the connection returns. |
| "Not allowed" | The relay did not accept the token. The invite is old, or the relay's secret changed. |
| "Sharing problem" | The relay is full, or one change was too large (over 10 MB, for example a huge image). |

Two people moving ideas into each other at the same moment can create a loop. The result is always a valid map: the affected ideas are placed under the central idea, and nothing is lost.
