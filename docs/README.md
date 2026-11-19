# Documentation

Start with [AGENTS.md](../AGENTS.md) for project rules, commands, security requirements and design direction. It is the primary context for Codex; [CLAUDE.md](../CLAUDE.md) is a secondary compatibility entry point.

| Document                            | Purpose                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------- |
| [Roadmap](ROADMAP.md)               | Delivery phases, completion status and open questions                       |
| [Decisions](decisions.md)           | Accepted product and architecture choices, plus a format for future records |
| [Architecture](architecture.md)     | Implemented structure, request flow and planned boundaries                  |
| [Development](development.md)       | Local setup, verification and contributor workflow                          |
| [Deployment](deployment.md)         | Docker setup, HTTPS, configuration and operational hardening                |
| [Key management](key-management.md) | Encryption design, key recovery constraints and key rotation                |

## Keeping context useful

Update the relevant document in the same change as the behavior it describes. Keep commands and agent rules in `AGENTS.md`, delivery checkboxes in the roadmap, and decision rationale in the decision log. Link between documents instead of copying large sections. Distinguish implemented behavior from planned work, and never include real credentials or user data.
