# wa-session-episode-recorder

[中文](README.zh.md)

The `episodeRecorder` projection unit: folds the session log's tool call→result
pairs, approval decisions, and `classify_tender` manifests into
per-requirement episode trajectories (`wa.episode.v1` shape) served through
the session-projection seam.

One episode = one requirement of one RFP. The manifest sniffed from a
`classify_tender` result (`wa.tender_requirements.v1`) mints the episode
headers; later steps attribute to a requirement when the tool name,
arguments, or result text mention its id; steps that mention nothing stay in
the `unscoped` bucket. Human outcome labels (the board checklist) are a
separate concern — the model never marks done for the user.

Host-only: the projection carries no client view. Consumers are the episode
exporter (`scripts/export-episodes.ts` at the repo root) and, later, the
board-label sync.

See `docs/episode-capture.md` for the product rationale and the schema.
