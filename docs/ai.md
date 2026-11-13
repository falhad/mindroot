# AI assistant

A built-in plugin that works with the model you choose. It is on by default and does nothing until you add an API key.

## Make a new map from a topic or a text

On the dashboard, press **Generate with AI** (or ⌘K → "AI: New map from a topic or text" in the editor). Type a topic ("Plan a product launch for a mobile app"), or paste notes, an article or a transcript. Press **Make the map** (or ⌘ Enter).

- A short topic gives a map from what the model knows. A longer text gives a map of what the text says.
- The map has a title, 4 to 7 main branches and a few ideas under each one. It opens in the editor, and it is a normal map: change it as you like.
- If the model gives an answer that is not usable, or the network fails, the dialog stays open with a message and your text is kept. No map is made.
- While the model works, the dialog shows a spinner, the step ("Asking gpt-4o-mini for the map…", "Reading the answer…", "Building the map (42 ideas)…") and the seconds since the start.
- If you press Cancel while the model is working, its answer is dropped.

Only the text you typed or pasted is sent (at most 12,000 characters). No map and no other data goes with it. The answer is limited to 150 ideas of 200 characters, 5 levels deep.

## Commands for the open map (⌘K → "AI: …")

| Command | What it does |
|---|---|
| **Expand this idea** | Adds 3 to 7 child ideas. |
| **Find what is missing under this idea** | Adds 3 to 6 child ideas, tagged `#ai-gap`, for topics that are not covered. |
| **Summarize this branch into notes** | Writes a short Markdown summary into the idea's notes. |
| **Rewrite this idea's text** | Replaces the text with a clearer, shorter version. |

While a command works, a chip in the top bar shows a spinner, the step ("AI: asking gpt-4o-mini") and the seconds since the start. Point at the chip to see the task ("Expanding “Launch”"). You can continue to work on the map in the meantime.

Each command is **one undo step**. If the model answers with something that is not usable (not JSON, empty, a network error), nothing in the map changes and you get a message. If you close the map or delete the idea while the model is thinking, the answer is dropped.

## Set up (Settings → AI assistant)

1. Pick a service: OpenRouter, OpenAI, Anthropic, or **Custom address** (for example a 9router or a local server).
2. Check the **format** (OpenAI-compatible or Anthropic-compatible), the **model name** and the **API address**.
3. Paste your **API key** and press Save key. It goes to the secret store of the app (see below), never into the vault or the plugin settings, and never into Git. (In the browser build it lives for the tab only.)
4. Press **Test connection**.

| Format | Request |
|---|---|
| OpenAI-compatible | `POST {address}/chat/completions` with `Authorization: Bearer <key>` |
| Anthropic-compatible | `POST {address}/v1/messages` with `x-api-key` and `anthropic-version: 2023-06-01` (an address that already ends in `/v1` is not doubled) |

The requests are sent by the app's Rust side (the web view never talks to the network), https only, with a time limit you can set.

## Where the key is kept

Settings → General → **Secret keys** has two choices:

| Choice | What it is | Password dialog |
|---|---|---|
| **App file** (default on macOS) | `secrets.json` in the app data folder. Only your user account can read it. It is not encrypted. | Never |
| **System keychain** (default on Windows and Linux) | The keychain of the operating system. This is the stronger choice. | On macOS, after each update of Mindroot, because the app is not signed by Apple yet |

A change of the choice moves the saved keys. A key that an older version saved in the keychain moves to the file the first time the app reads it; macOS asks for your password that one last time.

## What is sent

For the four commands on the open map: only the **selected idea and what is under it** (up to 200 ideas, longer texts cut) plus the titles of the ideas above it as the path. Not the rest of the map, not your other maps, not your notes outside that branch. The model is asked to answer in the same language as the map (Persian works).

The model's answer is only ever read as JSON `{ "items": [...] }` or `{ "text": "..." }`, limited to 12 ideas of 200 characters, or 8,000 characters of text. For a new map it is `{ "title": "...", "children": [...] }` with the limits above.
