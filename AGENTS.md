# Agent instructions for Paseo Workboard

These instructions apply to AI coding assistants working anywhere in this
repository. `CLAUDE.md` is a relative symlink to `AGENTS.md`; keep one shared
source of instructions. Both belong in Git, but neither belongs in the npm package.

## Start here

- Read [README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md) before making
  changes. The contribution guide owns the issue/PR workflow and required checks.
- Use the current source, `package.json`, `paseo-plugin.json`, and `.github/workflows/ci.yml`
  for behavior, commands, compatibility requirements, and runtime versions.
- Read [architecture](docs/architecture.md) for changes to state or host
  operations, and [releasing](docs/releasing.md) for package or release work.
- The repository describes the present and the principles behind it. There is no
  changelog, verification log, or troubleshooting history to read or update; see
  [Repository content rules](#repository-content-rules).

## Contribution workflow

- Open or reuse an issue before a PR. Follow the contribution guide's issue
  requirements: bug reproduction and expected/actual behavior, feature use cases
  and intended outcomes, or the documentation correction. Discuss substantial
  behavior or architecture changes before implementation.
- Keep each PR focused on its issue. Include a summary, the related issue,
  actual validation results and omissions, and relevant compatibility or risks.
  Never invent test results, screenshots, or maintainer approval.
- Inspect Git status, the current branch, and remotes before editing. Preserve
  existing changes. Use a separate worktree and branch for a feature or fix;
  documentation-only work may reuse the current checkout. Start from an updated
  `main` when safe; do not reset, automatically stash, or overwrite another task.
- Make commits only within the authorized task. Do not rewrite published history
  without explicit approval. Pushes, issue/PR publication, comments, tags, npm
  publishing, and releases require authorization for that action and destination.
  Show final public text, screenshots, GIFs, and icons for user confirmation
  before publishing unless that exact content has already been approved.
  Preparing a local draft or package is not publication.

## Repository map

| Path                                              | Responsibility                                               |
| ------------------------------------------------- | ------------------------------------------------------------ |
| `index.client.tsx`, `client/`                     | React Native UI, theme, translations, and client preferences |
| `index.server.ts`, `server/workboard.ts`          | Plugin lifecycle, reconciliation, and task mutations         |
| `server/paseo-compat.ts`, `server/host.ts`        | Host integration and its compatibility boundary              |
| `server/conversations.ts`, `server/git-safety.ts` | Conversation evidence and archive safety                     |
| `shared/`                                         | Data schemas, migrations, and RPC contracts                  |
| `index.tui.ts`, `tui/`                            | paseo-tui terminal board entry, built to ignored `dist/`     |
| `tests/`, `tests/integration/`, `tests/ui/`       | Deterministic unit tests, isolated host fixtures, UI smoke   |
| `docs/`, `docs/zh-CN/`                            | Architecture, release guide, and user guide (EN/ZH mirror)   |
| `images/`, `OVERVIEW*.md`, `README*.md`           | Distributed listing assets and public documentation          |

Keep new work inside this layout. Add a new document only when it states a
current fact, rule, or instruction that no existing file owns, and add it to the
README documentation table and to both language trees. Do not create parallel
files with names such as `NOTES`, `TODO`, `MIGRATION`, `TROUBLESHOOTING`,
`CHANGELOG`, or `verification`.

## Repository content rules

Committed content states what the code does now and the principles that keep it
correct. Everything that only shows how the project got there belongs elsewhere:

| Content                                                   | Where it goes                          |
| --------------------------------------------------------- | -------------------------------------- |
| Release notes, upgrade steps, version-to-version changes  | GitHub Release for the version tag     |
| Verification output, test logs, screenshots of test runs  | The PR description and its CI run      |
| Troubleshooting narratives, incident post-mortems         | The issue, or a PR comment             |
| Issue/PR summaries, review findings, plans, decision logs | The issue or PR discussion             |
| Real task, session, workspace, or daemon data             | Nowhere in Git; use fictional examples |

The same rule removes stale process text from code and docs: do not keep dated
"verified on" lines, "previously named", "was fixed in", or unreleased
"Unreleased" sections. Describe the current contract, and when the contract
needs justification, state the rule and the reason, not the change that
introduced it. Historical detail that a reader still needs must be re-expressed
as a current rule, for example a migration requirement in
[architecture](docs/architecture.md), not as a past defect.

`docs/releasing.md` and its Chinese translation own the release procedure. The
version history is not kept in the repository, so never add a changelog back.

## Implementation boundaries

- An active workspace maps to one task. Drafts have no workspace until bound.
  Preserve the distinction between managed-label task status and Agent activity;
  a completed Agent turn does not complete a task.
- The server owns durable state and native mutations. Preserve revision checks,
  expected-value checks, serialized operations, and uncertain outcomes. Avoid
  duplicating that authority in client components.
- Archive can stop Agents and terminals and remove a managed worktree. Preserve
  conversation evidence, activity, label, and Git safety checks. Missing evidence
  must defer or reject archival; never replace it with a task timestamp, a runtime
  status, or an assumed success. Do not retry an uncertain destructive operation.
- Keep host internals behind the compatibility boundary. Reuse the host's
  authenticated session; do not add a separate login or alter host credentials.
  Keep the three Paseo SDK development dependencies aligned with each other and
  verify supported hosts. TypeScript success alone does not prove compatibility.
- Reuse React Native primitives, theme colors, existing bilingual strings, and
  the compact controls' minimum 36px interactive targets. Avoid dependencies for
  small UI behaviors. Preserve keyboard access and host-scoped preferences.

## Documentation for user-visible changes

Every change a user can notice needs its documentation updated in the same
change. Documentation is part of the feature, not a follow-up.

A change is user-visible when it affects anything a user sees, reads, does, or
installs: a screen, control, label, key binding, filter, or default; saved data
or migration behavior; automatic archive, pinning, or other automation;
compatibility, install steps, permissions, or limitations of the plugin.

- Update the affected English and Chinese files together: `README.md` and
  `README.zh-CN.md`, `OVERVIEW.md` and `OVERVIEW.zh-CN.md`, `docs/*` and
  `docs/zh-CN/*`, and the matching strings. Keep headings, table rows, and
  screenshots in step across languages.
- Refresh screenshots and GIFs when the depicted UI or workflow changes, and
  remove obsolete examples or media. Capture the actual plugin with fictional
  data in the isolated demo environment, following the applicable browser
  authorization rules. Unaffected media can stay unchanged.
- Before delivery, check that descriptions, screenshots, and GIFs match the
  current behavior in both languages. Keep manifest media references, package
  files, and package checks aligned when assets change.
- If a change is genuinely not user-visible, say so explicitly in the delivery
  summary instead of silently skipping documentation.
- If capture or a documentation update is blocked, report the stale assets and
  missing documentation as unresolved. Never claim they are current.

## Validation

Use Node.js, npm, and Git as described in CONTRIBUTING.md; Node 22.22.2 matches
the primary CI baseline. Do not require a particular runtime manager.
Follow the change-specific check table in [CONTRIBUTING.md](CONTRIBUTING.md).
For code changes, run focused tests first, then `npm run check` and
`npm run format:check`. Documentation-only work needs formatting,
link, and semantic checks. Package-related work also needs
`npm run check:package`.

Unit tests must not depend on a daemon, browser, network service, model, or
personal Paseo home. Changes to the host bridge require supported-host tests
using the [marked, disposable integration home](tests/integration/README.md).
Never load development builds into a personal daemon as a substitute. Report
visual checks only when the rendered behavior was actually exercised.

Report validation in the PR and in the delivery summary, not as committed
records. Keep the English README's `## Installation` and `## Limitations`
headings: package checks and Paseo Cafe depend on them. `package.json` defines the
package file allowlist; `scripts/check-package.mjs` checks the exact packed file
list.

## Releases

Every user-facing change is released the same way, and release notes never go in
the repository:

1. **Tag.** Aggregate the reviewed changes into a new semantic version, bump
   `package.json` and `package-lock.json`, and create the annotated tag `vX.Y.Z`
   on the merged release commit.
2. **GitHub Release.** Create a GitHub Release for that tag with the upgrade
   notes. The Release is the only upgrade record: what changed for users of the
   previous version, compatibility changes, migration behavior, and known
   limitations. Use fictional examples and never attach logs or local paths.

- The repository does not distribute through npm. Do not add `npm publish`, npm
  registry steps, npm credentials, or npm install instructions to the release
  procedure or docs. `npm pack` and `npm run check:package` remain the local way
  to build and check the artifact; neither publishes. Do not run `npm publish`
  without an explicit, separate instruction from the maintainer for that exact
  version.
- Users install from the default branch, so a Release does not change what the
  install command resolves to. Never imply a Release updates a package registry
  or a directory listing.
- Do not reuse a version or move a published tag. If the notes were wrong, edit
  the Release; if the tagged source is wrong, fix it and cut a new version.
- Follow [the release guide](docs/releasing.md) for the exact commands,
  validation order, approval boundary, and directory-listing scope. Pushing,
  tagging, and creating Releases each require authorization for that action and
  destination.

## Public content and delivery

- Before committing, inspect `git status --short --ignored` and the complete
  staged diff. Classify new files as shared source/docs, ignored build output,
  local-only scratch, or pre-existing user files. Do not force-add ignored files.
- Keep credentials, internal domains or service addresses, private repository
  links, personal paths, real task/session data, logs, and daemon configuration
  out of Git, public reports, and packages. Use fictional examples. Review content
  in context; a keyword scan alone is not enough.
- Review the actual tarball for packaging changes. Keep tests, local data, and
  Agent instruction files outside the published package.
- Before delivery, review the final diff for correctness, scope, and unnecessary
  changes, including any file that only records process. Report what changed, the
  commands and results, untested behavior and remaining risks, and the Git state.
  Distinguish local validation, CI, push, tag, Release, installation, and
  publication, and state which release steps are still outstanding.
