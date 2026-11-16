# Deployment

Herbarium ships as one Docker image (`severnbli/herbarium`) plus one volume that holds everything the instance knows: the encrypted SQLite database and the encrypted media.

## Images

| Tag                | Built from                  |
| ------------------ | --------------------------- |
| `latest`           | the `main` branch           |
| `dev`              | the `dev` branch (unstable) |
| `1.2.3`, `1.2`     | release tags `v1.2.3`       |
| `sha-<short-hash>` | every published commit      |

Images are built for `linux/amd64` and `linux/arm64`.

## Quick start

```bash
mkdir -p secrets
(umask 077; openssl rand -base64 32 > secrets/master_key)
docker compose up -d
```

The example `docker-compose.yml` listens on `127.0.0.1:3000` only. Put a reverse proxy with HTTPS in front of it (Caddy, nginx, Traefik) and set `ORIGIN` to the public URL:

```bash
ORIGIN=https://herbarium.example.org docker compose up -d
```

The container runs as the `node` user (uid 1000). The secret file must be readable by that uid: either own it as uid 1000 with mode `0400`, or keep it world-readable (`0444`) inside a directory only you can enter (`0700`).

## The master key

The master key encrypts the database and every media file. It is read from the file named by `MASTER_KEY_FILE` (a Docker secret) or from `MASTER_KEY`. It is never written to the data volume and never logged.

> **If the master key is lost, all data is unrecoverable.** There is no reset and no back door. Keep a copy of the key somewhere safe and separate from the data volume, for example in a password manager. A backup of the volume is useless without the key.

The key is exactly 32 random bytes, encoded as base64 or hex. Key rotation arrives in phase 10 of the roadmap.

## Configuration

All settings are environment variables, validated at startup. The app refuses to start and lists every problem if the configuration is invalid. See [`.env.example`](../.env.example) for the full list.

| Variable                         | Required        | Notes                                                             |
| -------------------------------- | --------------- | ----------------------------------------------------------------- |
| `ORIGIN`                         | in production   | `https://` only; plain `http://` is accepted only for `localhost` |
| `DATA_DIR`                       | in production   | `/data` in the image                                              |
| `MASTER_KEY_FILE` / `MASTER_KEY` | always (one of) | 32 bytes, base64 or hex                                           |
| `MAX_FILE_BYTES`                 | no              | per-file upload limit, default 1 GiB                              |
| `MAX_REQUEST_BYTES`              | no              | per-request upload limit, default 2 GiB                           |

`PORT`, `HOST` and the other settings of [`adapter-node`](https://svelte.dev/docs/kit/adapter-node) work as documented there. Behind a reverse proxy, set `ADDRESS_HEADER` and `XFF_DEPTH` so rate limiting sees real client addresses.

## Hardening already in place

- Non-root user, read-only root filesystem (`read_only: true`), `/tmp` as tmpfs, all capabilities dropped, `no-new-privileges`
- npm and other package managers removed from the runtime image
- Health check at `/healthz`, which reveals nothing about the instance
