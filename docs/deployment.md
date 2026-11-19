# Deployment

Herbarium ships as one Docker image (`severnbli/herbarium`) plus one volume that holds everything the instance knows: the encrypted SQLite database, the encrypted media and the optional public basemap archive.

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

The key is exactly 32 random bytes, encoded as base64 or hex. How keys are derived, how to read the database without the app and how to rotate keys is described in [key-management.md](key-management.md).

## Configuration

All settings are environment variables, validated at startup. The app refuses to start and lists every problem if the configuration is invalid. See [`.env.example`](../.env.example) for the full list.

| Variable                         | Required        | Notes                                                             |
| -------------------------------- | --------------- | ----------------------------------------------------------------- |
| `ORIGIN`                         | in production   | `https://` only; plain `http://` is accepted only for `localhost` |
| `DATA_DIR`                       | in production   | `/data` in the image                                              |
| `MASTER_KEY_FILE` / `MASTER_KEY` | always (one of) | 32 bytes, base64 or hex                                           |
| `MASTER_KEY_PREVIOUS_FILE`       | during rotation | Path to the previous key secret                                   |
| `MAX_FILE_BYTES`                 | no              | per-file upload limit, default 128 MiB, maximum 1 GiB             |
| `MAX_REQUEST_BYTES`              | no              | per-request upload limit, default 129 MiB, maximum 1025 MiB       |

`PORT`, `HOST` and the other settings of [`adapter-node`](https://svelte.dev/docs/kit/adapter-node) work as documented there.

The image sets `BODY_SIZE_LIMIT=1025M` so uploads can reach the application limits. A bare `node build` deployment should set `BODY_SIZE_LIMIT` at or above `MAX_REQUEST_BYTES`. Set the reverse proxy's request allowance to match `MAX_REQUEST_BYTES` and disable disk-backed request buffering for uploads to `/memories/new` and `/memories/import/*/upload`. Other application forms retain a 512 KiB limit.

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

## Offline maps

Install one Protomaps v4 vector basemap archive as `basemap.pmtiles` at the root of the data volume. The archive must contain MVT tiles in PMTiles v3 format. Place search and event pins work before installation. The app opens the archive locally; the browser gets byte ranges from Herbarium after sign-in.

On a computer with Internet access, install the [PMTiles CLI](https://docs.protomaps.com/pmtiles/cli) and choose a v4 archive URL from the [Protomaps build list](https://maps.protomaps.com/builds). Replace the example URL and adjust the bounding box and zoom for your coverage. This example covers Belarus and nearby countries at up to zoom 11. Higher maximum zooms increase the download and storage requirements.

```sh
pmtiles extract https://build.protomaps.com/YYYYMMDD.pmtiles basemap.pmtiles \
  --bbox=20,49,33,57 --maxzoom=11
pmtiles verify basemap.pmtiles
```

Copy the verified file to the host. From the Compose project directory, install or update it with an atomic rename on the mounted volume:

```sh
docker compose exec -T herbarium sh -c \
  'umask 077; cat > /data/basemap.pmtiles.next && mv /data/basemap.pmtiles.next /data/basemap.pmtiles' \
  < basemap.pmtiles
```

For a bare Node installation, put the file in `DATA_DIR` with read access for the process. Reload the map after replacing the archive. Keep HTTP range headers intact through the reverse proxy and disable shared caching for authenticated responses. The map shows [OpenStreetMap](https://www.openstreetmap.org/copyright) attribution. Glyphs, marker sprites and the GeoNames place database ship with Herbarium.

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

## Restore a portable ZIP

Any member can download a portable ZIP from **Account → Export shared data** after confirming their password. It contains an unencrypted JSON manifest, event coordinates and original media with location metadata removed. Store the ZIP privately.

Set up an empty destination instance with one owner and stop it before restoring. Keep the archive on a protected filesystem. For Compose, substitute a host file that the container's `node` user can read:

```bash
docker compose stop herbarium
docker compose run --rm --no-deps   -v /secure/path/herbarium-export.zip:/restore.zip:ro   herbarium node build/operations/restore.js /restore.zip
docker compose up -d
```

For a bare install, run `node build/operations/restore.js /secure/path/herbarium-export.zip` from the built application's root with its normal configuration. Set `MAX_FILE_BYTES` high enough for the largest original in the ZIP. The archive format allows a manifest up to 64 MiB and 100,000 rows per collection. The destination keeps its new owner and encryption key. Historical attribution is preserved, derivatives are regenerated and the new owner can send invitations.

## Encrypted volume backup

A cold backup preserves the entire instance, including accounts, 2FA, reminders and audit history. Back up the master key separately. Use the same application version for the first start after restore. Stop the server before copying any data files so the database, its sidecars and the encrypted media represent the same point in time.

From the Compose project directory, with a private backup destination that has enough space:

```bash
docker compose stop herbarium
(umask 077; docker compose run --rm --no-deps -T --entrypoint tar herbarium -cpf - -C /data . > herbarium-volume.tar)
docker compose up -d
```

For a bare install, stop the Node service and run `tar -cpf herbarium-volume.tar -C "$DATA_DIR" .` with a private umask. Copy the archive and the matching master key to separate protected locations.

Restore into an empty volume. Configure the original master key and the chosen origin first. This example uses a separate Compose project, which gives the destination its own named volume. Keep the old service stopped if both projects bind the same port.

```bash
docker compose -p herbarium-restore run --rm --no-deps -T --entrypoint sh herbarium \
  -c 'test -z "$(ls -A /data)" && tar -xpf - -C /data' < herbarium-volume.tar
docker compose -p herbarium-restore up -d
```

For a bare install, extract the archive into an empty, private `DATA_DIR` owned by the application user while the service is stopped. Sign in with an existing account and verify that events and original media open. CI exercises this cold copy and restore procedure, including login, coordinate recovery, media authentication and rejection of a wrong key.
