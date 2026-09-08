# EvoPilot — Project Audit

## Audit baseline

- Project: `/Users/mac/Desktop/JASON OS`
- Frontend: React 19, TypeScript 6, Vite 8
- Desktop: Tauri 2, Rust
- Local database: SQLite through `rusqlite`
- Search: SQLite FTS5
- AI provider: HackStart OpenAI-compatible Chat Completions; API key in macOS Keychain

## Reused without replacement

- Local-first Tauri architecture
- Existing `records` JSON data store
- SQLite FTS index
- Existing data, export and HackStart integration
- Browser fallback used for UI verification

## V1/V2 gaps identified

- Navigation exposed database entities instead of daily workflows
- Search and AI were isolated pages
- Project was a generic CRUD list rather than a workspace
- No Focus/Today layer
- Relations existed only as raw IDs in JSON
- Delete was permanent
- Backup used a raw file copy while WAL mode was enabled
- No restore workflow
- AI lacked current-page context and conversation history

## V3 implementation decisions

- Keep the stable `records` table; do not split into one table per entity.
- Add indexed `relations` table and materialize relation fields automatically.
- Add `archived_at` and `deleted_at` incrementally for existing databases.
- Replace permanent delete with archive and restore.
- Use SQLite `VACUUM INTO` for reliable snapshots.
- Keep Timeline as a computed view.
- Move Search and AI into the fixed global header.
- Add context-aware AI using current record/project IDs and linked records.

## Completed V3 modules

1. Global App Shell and fixed Header
2. Global Search and entity filters
3. Context-aware AI drawer
4. Command Palette (`⌘ K`)
5. Quick Capture (`⌘ Shift Space`)
6. High-density Command Center
7. Focus Today, Tasks and Time views
8. Task list, Kanban and calendar views
9. Project Workspace with nine tabs
10. Goal direction detail through Command Center/Search
11. Hypothesis → Experiment → Result workflow
12. Review conversions to learning/decision/task records
13. Memory modules and Mental Model effectiveness
14. Decision Journal
15. Events, People and computed Timeline
16. Relations UI and database backfill
17. Archive/restore
18. JSON/Markdown/CSV export
19. SQLite snapshot backup and restore
20. Migration, frontend, Rust, lint, build and visual verification

## Remaining conscious limits

- Semantic vector search/RAG remains a later-stage enhancement; V3 uses FTS5 plus HackStart reasoning.
- Attachment binary import UI is not expanded; existing local attachment metadata remains supported.
- Permanent purge is intentionally not exposed in the primary UI.
