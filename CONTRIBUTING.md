# Contributing

Issues and pull requests are welcome. Keep changes focused, avoid committing secrets or build
output, and include tests for changes to contract behaviour or risk scoring.

Before opening a pull request, run:

```bash
cd web && npm run lint && npm test && npm run build
cd ../contracts && forge test -vv
```

For security-sensitive findings, follow [SECURITY.md](SECURITY.md) instead of opening a public
issue.
