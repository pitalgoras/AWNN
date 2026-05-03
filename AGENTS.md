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

## Git Operations Rules

### CRITICAL: Never Overwrite Local Modified Files Without Consent

- **NEVER overwrite local modified files** with older versions from git without explicit user consent
- This includes commands like: `git checkout -- <file>`, `git restore <file>`, `git reset --hard`, `git pull` when they would discard local changes
- Always check `git status` first - if a file shows as modified (not staged), warn the user and ask before overwriting
- Exception: Only proceed without asking if user explicitly says "overwrite" or "discard changes"

## General Guidelines

- Stick strictly to approved plans - do not add extra actions
- When in doubt about a file's purpose, ask the user before deleting
- Report untracked files found during analysis, but do not delete them
