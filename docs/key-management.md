# Key management

Everything Herbarium stores is encrypted at rest. This page describes which keys exist, how they relate, what happens if one is lost and how the master key is rotated.

## Key hierarchy

```
master key (32 bytes, Docker secret or env var – never on the data volume)
 │  HKDF-SHA256, salt "herbarium/hkdf-salt/v1"
 ├─ database  (info "herbarium/v1/database")  raw SQLCipher key of herbarium.db
 ├─ key-wrap  (info "herbarium/v1/key-wrap")  wraps the per-file data keys of media (phase 5)
 └─ field     (info "herbarium/v1/field")     seals secret columns, e.g. TOTP secrets
      │
      └─ data keys (random 32 bytes per media file, stored wrapped in the database)
```

- The master key is never used to encrypt anything directly. Each purpose gets its own subkey, so a weakness in one use cannot be turned against another.
- **Database**: SQLCipher 4 format via `better-sqlite3-multiple-ciphers`, keyed with the raw 256-bit `database` subkey (no passphrase KDF). The WAL file is encrypted too.
- **Sealed values** (wrapped data keys, TOTP secrets): AES-256-GCM, a fresh random 96-bit nonce per value, layout `version (1 byte) | nonce (12) | ciphertext | tag (16)`. The version byte and a context string naming the record (for example `totp-secret:<user id>`) are authenticated as additional data, so a sealed value cannot be moved to another record. Tags are always verified before any plaintext is used.
- **Media files**: originals and derivatives each have a fresh random data key. The database stores the key wrapped with context `media:<file id>`. Each ciphertext starts with the eight bytes `HMEDIA\x01\x00`, a random eight-byte nonce prefix, and the plaintext size as an unsigned 64-bit big-endian value. A 16-byte AES-256-GCM tag authenticates this header using counter zero and empty plaintext. Each subsequent record holds up to 256 KiB of ciphertext followed by a 16-byte GCM tag. Its 12-byte nonce concatenates the prefix and its unsigned 32-bit big-endian counter, starting at one. Each record authenticates the header as additional data. Decryption verifies every requested record before returning any of its bytes. Key rotation re-wraps the data keys in SQLite.

Implementation: `src/lib/server/crypto/keys.ts`.

## If the master key is lost

The data is unrecoverable. There is no reset, no back door and no way to brute-force a 256-bit key. A backup of the volume is useless without the key. First-run setup asks the owner to confirm that a copy of the key is stored safely, away from the server and its backups (a password manager works well).

## Reading the database without the app

The data must outlive the app. With the master key, the stock `sqlcipher` tool opens the database:

```bash
# Derive the database key from the master key (base64 or hex, as configured).
DBKEY=$(node -e '
  const c = require("node:crypto");
  const raw = process.argv[1];
  const master = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  const key = c.hkdfSync("sha256", master, "herbarium/hkdf-salt/v1", "herbarium/v1/database", 32);
  console.log(Buffer.from(key).toString("hex"));
' "$(cat secrets/master_key)")

sqlcipher herbarium.db "PRAGMA key = \"x'$DBKEY'\";" ".tables"
```

Work on a copy of the file, never on the live database.

## Rotating the master key

Before rotating, stop all Herbarium processes using the data directory and take an [encrypted volume backup](deployment.md#encrypted-volume-backup). Retain the old key separately to open that backup. Then configure the new 32-byte key through `MASTER_KEY_FILE` (or `MASTER_KEY`) and set `MASTER_KEY_PREVIOUS_FILE` to the old key file. Start one Herbarium process.

The server tries the new database key first. If only the previous key works, it re-wraps the media data keys, re-seals active and pending TOTP secrets and writes an HMAC fingerprint of the intended new key in one transaction. It then changes the SQLCipher key with `PRAGMA rekey` using a rollback journal. After reopening with the new key, the server clears the marker and records rotation in the audit log in a single transaction. Media ciphertext is unchanged.

Keep both keys configured if startup is interrupted. The next start resumes a prepared rotation or finalizes a database already keyed with the new key. A server started with the previous key as its only key refuses to serve a partially rotated database. After the server reports `Herbarium completed master key rotation.`, remove `MASTER_KEY_PREVIOUS_FILE` and restart. Take a new encrypted backup with the new key. When all backups made with the previous key have been retired, discard that key.

For the example Compose deployment, place the previous key in `./secrets/master_key.previous` with the same ownership and permissions as the current key. Replace the contents of `./secrets/master_key` with the newly generated key. Use this temporary `docker-compose.rotate.yml` alongside `docker-compose.yml`:

```yaml
services:
  herbarium:
    environment:
      MASTER_KEY_PREVIOUS_FILE: /run/secrets/master_key_previous
    secrets:
      - master_key_previous

secrets:
  master_key_previous:
    file: ./secrets/master_key.previous
```

Start with `docker compose -f docker-compose.yml -f docker-compose.rotate.yml up -d` and check the service logs. Once confirmed, recreate the service with the original Compose file alone.
