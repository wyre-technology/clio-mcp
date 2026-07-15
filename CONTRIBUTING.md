# Contributing

Thank you for your interest in contributing! This project is maintained by [WYRE Technology](https://github.com/wyre-technology).

## Getting Started

1. Fork the repository
2. Clone your fork
3. Install dependencies: `npm ci`
4. Create a feature branch: `git checkout -b feature/your-feature`

## Development

```bash
npm run build       # Build the project (tsup)
npm run test        # Run tests
npm run lint        # Type-check without emitting
npm run dev         # Watch mode build
npm run start       # Run stdio transport
npm run start:http  # Run HTTP streaming transport
```

## Pull Request Process

1. Ensure all tests pass and linting is clean
2. Update documentation if you're changing public APIs or tool behavior
3. Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages -- this repo
   releases via semantic-release, so the commit type drives versioning:
   - `feat:` for new features (minor bump)
   - `fix:` for bug fixes (patch bump)
   - `feat!:` / `fix!:` / a `BREAKING CHANGE:` footer for breaking changes (major bump)
   - `docs:`, `chore:`, `refactor:`, `test:` for everything else (no release)
4. Open a pull request against the `main` branch

## Reporting Issues

- Use GitHub Issues
- Include steps to reproduce, expected behavior, and actual behavior
- Include your Node.js version and OS
- **Do not** include real Clio access/refresh tokens or any matter/contact/communication content in an
  issue -- this server proxies attorney-client privileged data; redact request/response bodies before sharing them.

## Code Style

- TypeScript with strict mode
- ESM modules (`import`/`export`)
- All logging to stderr, structured, and limited to level/timestamp/tool-name -- never argument or result
  bodies (see the README's compliance note)
- One file per Clio SDK resource under `src/domains/`, following the existing `DomainHandler` pattern
- New tools follow the `clio_{entity}_{operation}` naming convention

## License

By contributing, you agree that your contributions will be licensed under the same license as this project (Apache-2.0).
