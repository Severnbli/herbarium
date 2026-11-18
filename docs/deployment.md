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

## First-run setup

Until the first account exists, every page leads to `/setup`. To stop a stranger from claiming a fresh instance, setup asks for a one-time code that only the operator can read. The app writes it to `setup-code` in the data directory (mode `0600`, never logged):

```bash
docker compose exec herbarium cat /data/setup-code
```

Enter it on `/setup` together with the owner's username, name and password. The file is deleted as soon as the owner exists, and `/setup` returns 404 from then on. The owner invites everyone else from the **Members** page; there is no open registration.

The container runs as the `node` user (uid 1000). The secret file must be readable by that uid: either own it as uid 1000 with mode `0400`, or keep it world-readable (`0444`) inside a directory only you can enter (`0700`).

## The master key

The master key encrypts the database and every media file. It is read from the file named by `MASTER_KEY_FILE` (a Docker secret) or from `MASTER_KEY`. It is never written to the data volume and never logged.

> **If the master key is lost, all data is unrecoverable.** There is no reset and no back door. Keep a copy of the key somewhere safe and separate from the data volume, for example in a password manager. A backup of the volume is useless without the key.

The key is exactly 32 random bytes, encoded as base64 or hex. How keys are derived, how to read the database without the app and how rotation works (implemented in phase 10) is described in [key-management.md](key-management.md).

## Configuration

All settings are environment variables, validated at startup. The app refuses to start and lists every problem if the configuration is invalid. See [`.env.example`](../.env.example) for the full list.

| Variable                         | Required        | Notes                                                             |
| -------------------------------- | --------------- | ----------------------------------------------------------------- |
| `ORIGIN`                         | in production   | `https://` only; plain `http://` is accepted only for `localhost` |
| `DATA_DIR`                       | in production   | `/data` in the image                                              |
| `MASTER_KEY_FILE` / `MASTER_KEY` | always (one of) | 32 bytes, base64 or hex                                           |
| `MAX_FILE_BYTES`                 | no              | per-file upload limit, default 128 MiB, maximum 1 GiB             |
| `MAX_REQUEST_BYTES`              | no              | per-request upload limit, default 129 MiB, maximum 1025 MiB       |

`PORT`, `HOST` and the other settings of [`adapter-node`](https://svelte.dev/docs/kit/adapter-node) work as documented there.

The image sets `BODY_SIZE_LIMIT=1025M` so uploads can reach the application limits. A bare `node build` deployment should set `BODY_SIZE_LIMIT` at or above `MAX_REQUEST_BYTES`. Set the reverse proxy's request allowance to match `MAX_REQUEST_BYTES` and disable disk-backed request buffering for uploads to `/memories/new`. Other application forms retain a 512 KiB limit.

Media processing in the image requires Linux on amd64 or arm64 with Landlock ABI 3 or newer and seccomp enabled. A bare deployment also needs Python 3, ExifTool, FFmpeg 8 with `libx264`, ffprobe and libseccomp. Uploads use anonymous memory files during processing, one upload at a time. Size the container's available memory for up to three media buffers near the configured file limit plus decoder overhead. Use encrypted swap or disable host swap for sensitive deployments. Keep one application process on each data volume so startup cleanup can safely reclaim encrypted files left by a stopped upload.

**Behind a reverse proxy, set `ADDRESS_HEADER` and `XFF_DEPTH`.** Login rate limiting is per account and per client address; without these, every request appears to come from the proxy, so one attacker could lock everybody out by address. For a single proxy that appends to `X-Forwarded-For` (Caddy, nginx with `proxy_add_x_forwarded_for`, Traefik):

```yaml
environment:
  ADDRESS_HEADER: X-Forwarded-For
  XFF_DEPTH: 1
```

Never set them without a proxy in front: clients could then forge their address.

## Reminder email

Email delivery is off by default. To enable it, configure an authenticated SMTP relay that you operate or trust with event titles and dates. Herbarium sends each opted-in member a plain-text message with the event title, date and a link that requires sign-in. The connection to the configured relay uses TLS with certificate verification. Delivery from the relay to the recipient is governed by the relay.

Write a file under `secrets/` with a JSON object containing the strings `user` and `pass`. Restrict access as for the master key secret. Add the following Compose override, substituting the relay's certificate hostname and permitted sender address:

```yaml
services:
  herbarium:
    environment:
      SMTP_HOST: mail.example.org
      SMTP_FROM: herbarium@example.org
      SMTP_TLS: starttls
      SMTP_CREDENTIALS_FILE: /run/secrets/smtp_credentials
    secrets:
      - smtp_credentials

secrets:
  smtp_credentials:
    file: ./secrets/smtp_credentials
```

STARTTLS defaults to port 587. Set `SMTP_TLS: implicit` for implicit TLS on port 465. Use `SMTP_PORT` for a different port. For a relay using a private CA, mount the CA certificate read-only and configure Node's `NODE_EXTRA_CA_CERTS` to point at it. Once the server restarts with SMTP configured, members can opt in on **Account** and set reminder times on individual events.

The scheduler queues reminders up to 14 days ahead. Reminders that were configured before their due time can be delivered up to 24 hours late, including after a restart. A failed attempt is retried only when SMTP reports a temporary rejection or the connection failed before message submission. If the server stops during delivery or the relay disconnects without confirming acceptance, the delivery is treated as attempted and stays out of the retry queue.

## Sessions and sign-in

- Sessions last up to 60 days and end after 14 days without activity. Members can see their devices and sign them out on the **Account** page, or sign out everywhere.
- After 5 failed logins for one username (existing or not) or 20 from one address, further attempts wait with exponential backoff, up to 15 minutes per account and 1 hour per address. Counters reset after a quiet day.
- Members can turn on two-step verification with any TOTP authenticator app and get 10 single-use recovery codes.
- Deactivating a member on the **Members** page ends all their sessions at once. At least one active owner always remains.
- Security events (logins, failed logins, invites, member changes, session revocations, 2FA changes) are recorded in the `audit_log` table, without passwords, tokens or content.

## Hardening already in place

- Non-root user, read-only root filesystem (`read_only: true`), `/tmp` as tmpfs, all capabilities dropped, `no-new-privileges`
- npm and other package managers removed from the runtime image
- Health check at `/healthz`, which reveals nothing about the instance
- Database, WAL and setup code are created with mode `0600`, the data directory with `0700`
- Strict Content Security Policy with nonces, `frame-ancestors 'none'`, HSTS over HTTPS, `Referrer-Policy: same-origin`, a restrictive `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`, and `Cache-Control: no-store` on every page
