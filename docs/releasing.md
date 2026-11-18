# Releasing

[中文](zh-CN/releasing.md) · [README](../README.md)

A release is a tagged snapshot of the source with published upgrade notes:

| Record         | Where                                   | Purpose                         |
| -------------- | --------------------------------------- | ------------------------------- |
| Source tag     | Git tag `vX.Y.Z` on the released commit | Immutable pointer to the source |
| Upgrade record | GitHub Release for that tag             | What changes for the upgrade    |

Users install from the default branch, as the README describes. A Release does
not change what that install command resolves to; it marks a reviewed snapshot
and carries the notes for it. The repository keeps no changelog, so [GitHub
Releases](https://github.com/fxbing/paseo-workboard/releases) is the only upgrade
record.

Publishing this project's package to npm is not part of the current release
path. `npm pack` builds the local artifact used for validation, and
`npm run check:package` checks its contents; neither publishes anything. The
`publishConfig` and `prepublishOnly` entries in `package.json` remain as package
configuration and do not make publication part of the release procedure.

## Package contract

Paseo loads the TypeScript client/server entries and their relative modules. All external runtime imports are supplied by Paseo or Node. Development dependencies stay in `devDependencies`; no manifest build command or compiled distribution is needed. See [Paseo's publishing guide](https://paseo.sh/docs/plugins/publishing).

The packed package includes the manifest, entries, `client/`, `server/`, `shared/`, both READMEs, both `OVERVIEW` files, `images/` (icon, screenshots and GIFs) and the MIT license. Tests, development scripts, daemon data, logs, credentials and `node_modules` are excluded. The paseo-tui entry (`index.tui.ts`, `tui/`) is excluded too: Paseo does not load it, and terminal users build `dist/tui.js` from a checkout with `npm run build:tui`.

`npm run check:package` checks the package identity/version, manifest minimum, README sections used by Cafe, the complete file list, relative README link targets, referenced media signatures and icon dimensions. The CI workflow runs these checks and creates a downloadable tarball for inspection. Nothing in CI publishes.

## Prepare and validate a candidate

1. Update `package.json` and `package-lock.json` together. Use a new stable semantic version for every released change. Keep English and Chinese documentation aligned.
2. Keep `requirements.paseo` at the intended minimum version. Run host integration tests on the current target before widening the range; the internal bridge checks response shapes but cannot guarantee later Paseo versions.
3. From a clean checkout, run:

   ```sh
   npm ci
   npm run check
   npm run format:check
   npm run check:package
   WORKBOARD_VERSION="$(node -p "require('./package.json').version")"
   WORKBOARD_RELEASE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/workboard-release.XXXXXX")"
   npm pack --pack-destination "$WORKBOARD_RELEASE_DIR"
   ```

4. Follow the [isolated integration guide](../tests/integration/README.md) to start a marked, temporary Paseo home. Unpack the generated tarball into a separate temporary directory and install that directory into the isolated daemon. Do not install development dependencies in the unpacked package:

   ```sh
   WORKBOARD_PACKAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/workboard-package.XXXXXX")"
   tar -xzf "$WORKBOARD_RELEASE_DIR/paseo-workboard-$WORKBOARD_VERSION.tgz" -C "$WORKBOARD_PACKAGE_DIR"
   paseo plugin install "$WORKBOARD_PACKAGE_DIR/package" --home "$WORKBOARD_INTEGRATION_HOME"
   paseo plugin ls --home "$WORKBOARD_INTEGRATION_HOME" --json
   npm run test:integration
   ```

   Require plugin `running`, a connected board and passing integration tests. Check changed visual behavior only with disposable tasks. Stop the isolated daemon before deleting its home or the unpacked plugin.

5. Review the tarball and Git diff for accidental local data. A local check does not establish a successful GitHub Actions run, tag or Release; confirm each one at its destination as it happens.

## Approval boundary

Prepare and validate locally, then present the version, complete release notes, compatibility changes, tarball checksum and intended destinations for approval. Do not push source, create tags or GitHub Releases, or submit directory changes before approval. Material changes to approved public content require another review. A new Release does not replace the checks above; validate that exact revision before tagging it.

Write the release notes before asking for approval, so the approval covers the
exact text that will be published. Keep them in a temporary file outside the
repository, fill in the complete body, and leave the checksum and intended
destinations in the same request:

```sh
WORKBOARD_NOTES="$(mktemp "${TMPDIR:-/tmp}/workboard-notes.XXXXXX")"
"${EDITOR:-vi}" "$WORKBOARD_NOTES"
test -s "$WORKBOARD_NOTES" || echo "notes are empty"
```

The notes are the content for step 2 below. Do not create the tag or Release
until the notes and the rest of the request have been approved.

## Publish the tag and GitHub Release

Publishing requires push access to the target GitHub repository. This repository contains no publishing credentials. Publish only after the notes written and approved above are in place.

1. Review the README installation instructions, then put the validated source on the public
   repository's default branch. A release is only cut from a reviewed, merged revision.
   Before tagging, validate that revision and check that the tarball to upload
   contains its package files. If merging changed those files, repeat candidate
   validation and packing from the merged revision. If the final package contents
   or checksum differ from what was approved, present the final artifact and
   obtain approval before tagging or uploading it.
2. Create the annotated tag and the GitHub Release on that merge commit. The tag
   `vX.Y.Z` must match `package.json`. The Release body is the approved upgrade
   record; keep it to what users of the previous version need to know:

   ```sh
   test -s "$WORKBOARD_NOTES" || { echo "approved notes are empty or missing"; exit 1; }
   git tag -a "v$WORKBOARD_VERSION" -m "paseo-workboard $WORKBOARD_VERSION"
   git push origin "v$WORKBOARD_VERSION"
   gh release create "v$WORKBOARD_VERSION" \
     "$WORKBOARD_RELEASE_DIR/paseo-workboard-$WORKBOARD_VERSION.tgz" \
     --title "paseo-workboard $WORKBOARD_VERSION" \
     --notes-file "$WORKBOARD_NOTES"
   ```

   These commands only consume the existing variables; they must not create the
   notes. The body covers user-visible changes first, then behavior changes,
   compatibility changes such as a new `requirements.paseo` minimum, and known
   limitations, following the same fictional-example rules as the rest of the
   documentation. Never add a notes file to the repository. Do not attach logs,
   local paths or unreviewed binaries; the packed tarball is the only asset to
   attach. Remove the temporary notes file after the Release is created.

3. Confirm the tag resolves to the reviewed commit and the Release shows
   `X.Y.Z`, the correct title and the intended notes. Never move or delete a
   published tag. If the notes were wrong, edit the Release; if the tagged source
   is wrong, fix it and cut a new version.
4. Do not add release notes, changelogs or verification logs to the repository.

## Directory listings

Listing updates are independent of this repository's release procedure. The
procedure does not include them, and a GitHub Release does not automatically
update an existing npm-sourced directory listing.

[_paseo-cafe.json_](paseo-cafe.json) keeps prepared listing metadata:
categories, platforms and caveats. Treat it as reference only; publishing it here
does not register anything, and it is not part of a GitHub Release.

Keep `OVERVIEW.md`, `OVERVIEW.zh-CN.md`, the manifest icon/media paths and their
assets accurate in the package.

Cafe reads installation and limitation excerpts from the English README. The `## Installation` and `## Limitations` headings are intentional. Screenshots under `images/` and a demo video are optional; use only genuine product captures with public or fictional data.
