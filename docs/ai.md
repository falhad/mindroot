# AI assistant

A built-in plugin that works with the model you choose. It is on by default and does nothing until you add an API key.

## Commands (⌘K → "AI: …")

| Command | What it does |
|---|---|
| **Expand this idea** | Adds 3 to 7 child ideas. |
| **Find what is missing under this idea** | Adds 3 to 6 child ideas, tagged `#ai-gap`, for topics that are not covered. |
| **Summarize this branch into notes** | Writes a short Markdown summary into the idea's notes. |
| **Rewrite this idea's text** | Replaces the text with a clearer, shorter version. |

Each command is **one undo step**. If the model answers with something that is not usable (not JSON, empty, a network error), nothing in the map changes and you get a message. If you close the map or delete the idea while the model is thinking, the answer is dropped.

## Set up (Settings → AI assistant)

1. Pick a service: OpenRouter, OpenAI, Anthropic, or **Custom address** (for example a 9router or a local server).
2. Check the **format** (OpenAI-compatible or Anthropic-compatible), the **model name** and the **API address**.
3. Paste your **API key** and press Save key. It goes to your system keychain, never into the vault or the plugin settings, and never into Git. (In the browser build it lives for the tab only.)
4. Press **Test connection**.

| Format | Request |
|---|---|
| OpenAI-compatible | `POST {address}/chat/completions` with `Authorization: Bearer <key>` |
| Anthropic-compatible | `POST {address}/v1/messages` with `x-api-key` and `anthropic-version: 2023-06-01` (an address that already ends in `/v1` is not doubled) |

The requests are sent by the app's Rust side (the web view never talks to the network), https only, with a time limit you can set.

## What is sent

Only the **selected idea and what is under it** (up to 200 ideas, longer texts cut) plus the titles of the ideas above it as the path. Not the rest of the map, not your other maps, not your notes outside that branch. The model is asked to answer in the same language as the map (Persian works).

The model's answer is only ever read as JSON `{ "items": [...] }` or `{ "text": "..." }`, limited to 12 ideas of 200 characters, or 8,000 characters of text.
