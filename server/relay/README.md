# Branchmint relay

A small server that passes live edits between people sharing a Branchmint map. It never reads your maps: it only forwards and stores opaque Yjs updates, one room per shared map.

- **Auth:** one shared `SECRET` per group. A room name is `HMAC(secret, "room:" + mapId)`, and a client must send `HMAC(secret, "token:" + room)`. A wrong token is closed with code `4401`.
- **Limits:** 50 rooms, 20 clients per room, 10 MB per message (close code `4429` or `1009`).
- **Storage:** the state of each room is saved in `DATA_DIR/<room>.bin` (atomic writes).
- **Health:** `GET /healthz` answers `ok`.

## Run

```bash
cd server/relay && npm install
SECRET="$(openssl rand -hex 32)" PORT=8787 DATA_DIR=./data node src/index.js
```

Or with Docker (see the header of `Dockerfile`). Put a TLS reverse proxy in front, because the app connects with `wss://`. For Caddy:

```
relay.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Then in Branchmint: Settings → Live collaboration → server `wss://relay.example.com`, and paste the same secret.

Use a long random secret and keep it private: whoever has it and a map's id can join that map's room.
