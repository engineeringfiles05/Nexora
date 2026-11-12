# Nexora project instructions

## Sync from GitHub before starting work

At the start of each session, before making changes:

1. Verify the remote is `origin` at `https://github.com/engineeringfiles05/Nexora`, and check the current branch and its upstream.
2. Run `git fetch origin --prune`.
3. Run `git status` and compare the branch with its upstream.
4. Run `git pull --ff-only` when the branch has an upstream and is behind it.
5. Report the branch and the result.

Stop and report the blocker, leaving the repository as it is, if:

- the branch has diverged from its upstream, or has no upstream
- uncommitted changes would conflict with the update
- the remote is not the one above, or the fetch fails

Always preserve local and uncommitted work and existing branches. Never discard work, force-reset, stash without being asked, or merge unrelated branches to get a sync through.

This rule covers GitHub-to-local sync only. It does not authorize pushes, merges, deployments, or scheduled background pulling. Pushing to any branch other than `main` also triggers `.github/workflows/auto-merge.yml`, which can merge into `main` once checks pass.
