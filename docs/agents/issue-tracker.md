# Issue tracker: Linear

Issues and PRDs for this repo live in Linear, team **Marginly**
(`faa4e98d-46b8-47b1-ae63-119a41f09236`). No project has been created yet under
this team, so issues are tracked directly against the team. Use the
`linear-server` MCP tools for all operations.

## Conventions

- **Create an issue**: `save_issue` (no `id`) with `team: "Marginly"`.
- **Read an issue**: `get_issue`.
- **List issues**: `list_issues`, filtered by `team: "Marginly"` and state.
- **Comment on an issue**: `save_comment`.
- **Apply / remove labels**: look up label ids with `list_issue_labels`
  (or create one with `create_issue_label`), then update the issue's
  `labels` via `save_issue`.
- **Close**: look up the target state with `list_issue_statuses`
  (e.g. "Done" / "Canceled") and set it via `save_issue`.

## When a skill says "publish to the issue tracker"

Create a Linear issue under team Marginly.

## When a skill says "fetch the relevant ticket"

Use `get_issue` with the issue's id or identifier (e.g. `MAR-12`).
