# Contributing

[简体中文](CONTRIBUTING.zh-CN.md)

Contributions are welcome, including bug fixes, features, documentation, and
translations. Start with an issue so the problem and proposed scope are clear
before a pull request is reviewed.

## Open an issue first

Search [existing issues](https://github.com/fxbing/paseo-workboard/issues) and
[pull requests](https://github.com/fxbing/paseo-workboard/pulls) before starting.
**Every PR must link an existing issue.** Open one if the change is not already
covered; otherwise, join the existing discussion rather than creating a duplicate.
Discuss substantial behavior or architecture changes in the issue before
implementing them.

Keep issue titles specific and include the details relevant to the request:

- **Bug report:** the problem and its impact, steps to reproduce, expected and
  actual behavior, and the Workboard/Paseo versions, operating system, and client
  involved. Add a minimal example or sanitized logs/screenshots when useful.
- **Feature or improvement:** the use case, what is missing today, the proposed
  behavior, alternatives considered, and how to tell that the change works.
- **Documentation or translation:** the affected page or section, what is
  incorrect or unclear, and the proposed correction.

Use fictional tasks and examples. Remove credentials, private conversations,
internal URLs, personal paths, and real workspace data from public reports.

## Prepare a pull request

Branch from an up-to-date `main` and target `main`. Keep a PR focused on the
linked issue; leave unrelated cleanup and dependency upgrades for separate changes.

Use a title that describes the resulting behavior. The description should include:

- **Summary:** the problem, the resulting behavior, and any design choice a
  reviewer needs to understand. A short before/after example is useful for a bug.
- **Related issue:** `Fixes #123` when the PR resolves it, or `Refs #123` when it
  addresses only part of it.
- **Validation:** commands actually run and their results. State what was not
  tested and why; include the host version and platform for integration or UI checks.
- **Compatibility and risks, when relevant:** changes to stored data, host
  compatibility, labels, pinning, or archiving. For UI changes, include screenshots
  or a short recording using fictional data, or explain why visual checks are pending.

Update affected English and Chinese documentation together. Do not describe
local tests as proof of CI, installation, or publication. Review all generated
changes before submitting, including changes produced with AI assistance.

## Setup and checks

Install Node.js, npm, and Git, with `node`, `npm`, and `git` available on `PATH`.
Node 22.22.2 is the recommended development version and the primary CI baseline.
The package runtime requirement is declared in `package.json`; development tools
have additional requirements (Vite requires at least 22.12 on Node 22).
Any installation method is fine; no runtime manager is required.
Paseo is needed only to run the plugin or the isolated host integration suite.

Install the locked development dependencies and run the checks:

```sh
npm ci
npm run check
npm run format:check
```

`npm run check` runs TypeScript and the unit suite. Run the smallest relevant
test while iterating, then choose the checks required by the change:

| Change                                                      | Required checks                                                                                    |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Code                                                        | Relevant tests, `npm run check`, and `npm run format:check`                                        |
| Documentation only                                          | Formatting, links, and consistency with the source; no unit suite required                         |
| Package, dependencies, manifest, or README package contract | Also run `npm run check:package`                                                                   |
| Host compatibility bridge                                   | Also run the supported-host tests in the [isolated integration guide](tests/integration/README.md) |
| paseo-tui entry (`index.tui.ts`, `tui/`)                    | Also run `npm run build:tui` and exercise the view in paseo-tui against an isolated home           |

The package check validates the publishable file list and required README
headings without publishing anything. Keep the English `## Installation` and
`## Limitations` headings; Paseo Cafe uses them for excerpts. Report only checks
that were actually performed, in the pull request or on the pull request's CI
run. Verification logs, dated test records, and incident write-ups stay in the
issue or PR discussion, not in the repository.

Pull requests trigger CI automatically. GitHub may still require maintainer approval
for first-time contributors with new GitHub accounts.

CI runs TypeScript and unit tests on Ubuntu, Windows, and macOS with Node 22.22.2,
plus formatting and package checks on Ubuntu. Separate Ubuntu 24.04 jobs install the
actual npm tarball into disposable Paseo **0.11.0**, **0.12.0**, **0.13.0**, and **0.14.0** hosts and run
integration tests and Chromium UI smoke tests. Browser failures retain traces
and screenshots alongside isolated daemon logs. The stable `check` job requires
every matrix job to succeed, including when a dependency fails or is skipped.
Repository maintainers should require `check` for `main`; the workflow alone
cannot enforce branch protection. See the [integration guide](tests/integration/README.md)
for the same local runner and the boundary of UI coverage.
For a bug fix, include a regression that fails on the affected revision and
passes with the fix. Archive and activity changes need cases with missing or
replayed history, Agent removal, and restart when relevant; a green unit suite
only covers the scenarios it exercises. Check the actual run for the PR head:
pending approval, skipped jobs, or no run are not passing results.

## Change boundaries

- Keep ordinary unit tests deterministic. They must not require a daemon,
  browser, network service, model, or personal Paseo home.
- Run host integration tests only against a disposable, marked temporary Paseo
  home. See [the integration guide](tests/integration/README.md).
- Do not point integration variables at a normal Paseo home. The suite changes
  its fixture provider and creates test workspaces.
- Use the existing React Native primitives and `theme` colors. Preserve the
  36px minimum interactive target used by compact controls.
- Do not add dependencies for a small UI behavior when the public SDK and
  React Native API already cover it.
- Describe the current design and its constraints, not the history that led to
  them. Do not add changelogs, dated verification records, troubleshooting
  logs, or issue/PR summaries; those belong in GitHub Releases, issues, and pull
  requests.
- A user-visible change needs its documentation updated in the same pull
  request, in English and Chinese.

## Architecture and compatibility

Start with [the architecture guide](docs/architecture.md). The
server owns the durable board projection and native mutations; the client is a
theme-aware React Native surface. Version-sensitive integration lives in
`server/paseo-compat.ts` for host operations and `client/paseo-language.ts` for
the Web/Electron language setting.

Changes to that compatibility boundary must include tests for the supported
Paseo versions, and must update the manifest minimum, README, and release notes
when the supported range changes. Do not infer compatibility from TypeScript
types alone.

`paseo-plugin.json` owns the minimum Paseo version. Keep all three Paseo SDK
development dependencies on the same version and verify them against the
supported host; a host integration result alone is not a complete SDK migration.

## AI-assisted contributions

AI coding assistants must read [AGENTS.md](AGENTS.md) before changing the
repository. `CLAUDE.md` is a relative symlink to that file; edit the shared
instructions rather than maintaining a second copy. Contributors remain
responsible for understanding the change, reviewing it, and verifying its behavior.

## Releases

Every user-facing version is released as an annotated Git tag plus a GitHub
Release whose notes are the upgrade record. The repository keeps no changelog.
Users install from the default branch, and the package is not distributed
through npm. For packaging and release work, follow [the release
guide](docs/releasing.md).
