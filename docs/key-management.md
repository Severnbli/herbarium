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

Rotation is designed now and implemented in phase 10. Until then, the master key cannot be changed.

The procedure is resumable, so a crash at any point leaves a state the next start can finish:

1. The operator backs up the volume, then starts the app with the new key in `MASTER_KEY_FILE` and the old one in `MASTER_KEY_PREVIOUS_FILE`.
2. The app opens the database with the old `database` subkey. In one transaction it re-wraps every data key from the old `key-wrap` subkey to the new one, re-seals every `field` value, and records a fingerprint of the new master key (an HMAC of a fixed label, never the key itself) in a `key_info` row.
3. It re-keys the database with `PRAGMA rekey` to the new `database` subkey.
4. On every start the app first tries the new key. If that fails and a previous key is configured, it opens the database with the previous key, checks the `key_info` fingerprint to see whether step 2 already ran, and continues from there.
5. Once the app reports that rotation is complete (and an audit event is written), the operator removes `MASTER_KEY_PREVIOUS_FILE` and destroys the old key.

Media files are not touched by rotation, because their data keys do not change.
