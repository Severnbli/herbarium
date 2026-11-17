# Decisions

These decisions were established before the Codex adaptation. This log preserves their rationale and scope; acceptance does not mean every feature is implemented. Check [ROADMAP.md](ROADMAP.md) for delivery status.

## Accepted product and architecture decisions

- **Members**: one shared space per instance with any number of members (a couple, a family, friends). Roles: `owner` and `member`; equal rights on content, owners manage members and settings. No multiple spaces per instance.
- **Reminders**: delivered by email through the owners' own SMTP server. No Web Push (it routes through browser vendors' services) and no messenger bots.
- **Places**: plain-text name plus optional coordinates on events, and a map of memories. Tiles are self-hosted PMTiles rendered with MapLibre – no external tile, style or font requests. Place search uses a bundled GeoNames gazetteer. GPS from a photo's EXIF is offered as a suggestion for the event's coordinates at upload, then stripped from the files, including the originals – no stored, exported or downloaded file contains location data.
- **Notes**: limited Markdown, rendered and sanitized on the server.
- **ICS feed**: not planned. Data stays inside the app.
- **Imports**: only bulk photo/video upload (plus restoring Herbarium's own export). No Google Takeout or ICS import.
- **Encryption at rest**: kept for the database and all media. A lost master key means lost data; setup warns about this.
- **2FA**: optional TOTP per user with recovery codes.
- **PWA**: installable, no offline mode, no user data cached on devices.
- **Styling**: own CSS on design tokens, no CSS framework.
- **First-run setup**: guarded by a one-time code the app writes to `setup-code` on the data volume (never logged), deleted once the owner exists.
- **Referrer policy**: `same-origin` instead of `no-referrer`, because `no-referrer` makes browsers send `Origin: null` on form posts and breaks the CSRF origin check.

## Agent context

Status: accepted.

Use root `AGENTS.md` as the authoritative instructions for Codex and other coding agents. Keep `CLAUDE.md` as a secondary entry point that imports it. This preserves Claude compatibility while avoiding two copies of project policy that can drift. Update shared guidance only in `AGENTS.md`.

## Recording future decisions

For a significant change to architecture, security, dependencies, data formats or product scope, append a record with:

- A stable heading and status: proposed, accepted or superseded.
- Context: the concrete problem and constraints.
- Decision: the selected approach and why it was selected.
- Alternatives: relevant options and why they were set aside.
- Consequences: costs, limitations, migration needs and affected documentation.

Do not invent historical rationale or approval dates. Mark proposals clearly. Keep superseded decisions with a link to their replacement. Small implementation details belong in code or a commit message.

## Compiled translations and saved member locales

Status: accepted.

Replace the interim TypeScript dictionaries with Paraglide JSON catalogs and a typed adapter that preserves the existing component API. Paraglide and its message-format plugin are MIT-licensed development dependencies, justified by typed message generation and locale-specific plural variants. Load the format plugin from the installed package rather than a CDN to keep builds reproducible and runtime traffic local.

Pass the locale explicitly to every generated message call. A global locale would risk mixing languages across concurrent server requests. Preserve the small adapter rather than rewriting every auth component; adding a message now requires a catalog entry and an adapter entry.

Store a nullable locale on the encrypted user record. Null preserves browser-language detection for existing accounts; an explicit preference follows the member across devices. A server form action changes only the authenticated member's preference and redirects, preserving operation without client JavaScript. No public locale endpoint or extra cookie is needed. English uses the CLDR default Sunday week start; Belarusian and Russian use Monday.
