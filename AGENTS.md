# Operational Rules for AI Agents

## File Deletion Rules

### CRITICAL: Never Delete Untracked Files Without Approval

- **NEVER delete untracked files** (files shown with `??` in `git status`) without explicit user approval
- Untracked files may be intentional work products, session logs, or important notes
- Always ask before deleting any untracked file
- Exception: Files explicitly identified by the user as "ok to delete"

### Approved Deletion Practices

- **Tracked files**: Can be deleted when part of an approved cleanup plan
- **Backup files** (e.g., `*.bak`): Only if user approved "delete backup files" in the plan
- **Empty directories**: Only after removing tracked contents as part of approved plan

## Plan Mode Rules

- When in Plan Mode (read-only): NO file edits, NO git commits, NO file deletions
- Only research, analysis, and presenting findings to user
- Wait for explicit "exit Plan Mode" or "proceed" before making changes

## General Guidelines

- Stick strictly to approved plans - do not add extra actions
- When in doubt about a file's purpose, ask the user before deleting
- Report untracked files found during analysis, but do not delete them
