# Git hooks

Opt in per-clone:

```bash
git config core.hooksPath .githooks
```

- **pre-commit** — runs `deno task gate:precommit` (`deno fmt --check`, `deno lint`,
  `deno check`). Blocks the commit on failure. Bypass once with
  `git commit --no-verify`.
