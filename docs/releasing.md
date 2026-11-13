# Releasing

A release has one version for everything: the command, the Go module, the TypeScript library, the
Java library and the images. That version is the one in `ts/package.json`, and `java/pom.xml` has
to say the same.

## Making a release

1. Set the version in `ts/package.json`, and in `ts/package-lock.json` with it:
   `cd ts && npm version --no-git-tag-version 1.2.3`, and in `java/pom.xml`:
   `mvn -f java/pom.xml versions:set -DnewVersion=1.2.3 -DgenerateBackupPoms=false`. Commit that.
2. Tag the commit `v1.2.3`, and push the commit and the tag:
   `git tag -s v1.2.3 -m 'Vexyl 1.2.3' && git push origin main v1.2.3`.

Pushing the tag starts two workflows.

`release.yml` stops at once if the tag isn't `v` and the version in `ts/package.json`. Then it:

- tags the same commit `go/v1.2.3` and pushes that, since the Go module is in `go/` and Go looks
  for its versions under that prefix. It then asks the Go module proxy for the version, which is
  what puts it on pkg.go.dev.
- builds the command for Linux, macOS and Windows on amd64 and arm64, packs each with `LICENSE`
  and `NOTICE`, writes `SHA256SUMS`, and makes the GitHub release with notes from the changes since
  the last one.
- tests and builds the library, and publishes it to npm with provenance. A version that's already
  there is skipped, so the workflow can be run again.

`docker.yml` pushes both images tagged `1.2.3`, `1.2`, `1` and `latest`.

A version with a hyphen, such as `1.2.3-rc.1`, is a prerelease: the GitHub release says so, npm
gets it under the `next` tag instead of `latest`, and the images get only `1.2.3-rc.1`.

The Go module's path has no major version in it, so it can only have versions below 2. A 2.0.0
would need the path to end in `/v2`.

## Once, before the first release

These need Naomi's accounts, so no workflow can do them.

### The editor's domain

Pages already builds from GitHub Actions. The domain, `vexyl.amethyst.name`, is set under
Settings → Pages → Custom domain. With Actions deploys, that setting is all it takes: the build
needs no `CNAME` file. Once the DNS record is in place, tick "Enforce HTTPS" there.
`naomiamethyst.github.io/vexyl/` then redirects to the domain. The editor works at either,
because everything it refers to is relative.

### npm

The library is `@naomiamethyst/vexyl`, in Naomi's own scope: npm refuses the plain name `vexyl` as
too close to the existing `vinyl`, and refuses `vexyl` as an organization too.

npm can only trust a workflow for a package that already exists, so the first version has to be
published by hand. npm's docs for `npm trust` say "The package you're configuring must already
exist on the npm registry" (<https://docs.npmjs.com/cli/v11/commands/npm-trust>), and there's no
way to set up a publisher for a name that hasn't been published yet.

1. Make an account at <https://www.npmjs.com/signup>, and turn on two-factor authentication.
2. Publish the library once, from a clean checkout of the commit to publish:

   ```sh
   cd ts
   npm ci && rm -rf dist && npm run build
   cp ../LICENSE ../NOTICE .
   npm pack --dry-run      # dist/*.js, dist/*.d.ts, README.md, LICENSE, NOTICE, package.json
   npm login
   npm publish --access public
   rm LICENSE NOTICE
   ```

   With a passkey as the only second factor, `npm publish` prints a link to approve the publish in
   a browser, but only when it's run in a terminal; run anywhere else, it just fails asking for a
   one-time password.

   This can be the current 0.1.0, so that 1.0.0 is the first to come from the workflow, with
   provenance. Or it can be the first release's own version, which the workflow will then skip.
3. On <https://www.npmjs.com/package/@naomiamethyst/vexyl/access>, under "Trusted Publisher", choose GitHub
   Actions, and enter:
   - Organization or user: `NaomiAmethyst`
   - Repository: `vexyl`
   - Workflow filename: `release.yml`
   - Environment name: leave it empty.

   npm doesn't check this when it's saved, only at the next publish. Its docs
   (<https://docs.npmjs.com/trusted-publishers>) say the `repository.url` in `package.json` has to
   match the repository exactly, which it does.
4. On the same page, it's worth choosing "Require two-factor authentication and disallow tokens",
   so that only the workflow and someone with the second factor can publish.

### Maven Central

The Java library isn't published yet, and nothing is set up for it. Publishing `name.amethyst:vexyl`
will need these, through the Central Portal at <https://central.sonatype.com>:

1. **The namespace.** Sign in to the Portal and add the namespace `name.amethyst`. It's proved by a
   DNS TXT record on `amethyst.name` holding the verification key the Portal shows, which can be
   removed once it's verified. `io.github.naomiamethyst` would need no DNS, but isn't what the pom
   says.
2. **A token.** Generate a user token in the Portal (Account, Generate User Token), and keep its
   name and password as repository secrets, such as `CENTRAL_USERNAME` and `CENTRAL_PASSWORD`.
   Maven reads them from a `<server>` in `settings.xml`, which `actions/setup-java` can write with
   `server-id: central`.
3. **Signing.** Central needs every file signed with PGP. Make a key for releases, publish its public
   half to a keyserver Central checks, such as `keyserver.ubuntu.com` or `keys.openpgp.org`, and keep
   the private key and its passphrase as secrets (`setup-java` can import it with `gpg-private-key`).
   The pom then needs `maven-gpg-plugin` in a release profile, so that ordinary builds don't sign.
4. **Sources and Javadoc.** Central refuses a jar without them, so the release profile also needs
   `maven-source-plugin` and `maven-javadoc-plugin` attaching their jars. The pom already has the
   name, description, URL, licence, developer and SCM that Central requires.
5. **The plugin.** `org.sonatype.central:central-publishing-maven-plugin`, with `<extensions>true`,
   `<publishingServerId>central</publishingServerId>` and, at first, no `autoPublish`, so that each
   upload waits in the Portal to be checked and published by hand. Once that's worked, `release.yml`
   can run `mvn -f java/pom.xml -P release deploy` after the npm step, with `autoPublish` set.

A version on Central can never be changed or removed, so it's worth uploading one by hand first and
dropping it in the Portal, before letting a workflow publish.

### The images

GHCR makes a package private the first time it's pushed, even from a public repository. After
the first push to main, open each of <https://github.com/users/NaomiAmethyst/packages/container/vexyl/settings>
and <https://github.com/users/NaomiAmethyst/packages/container/vexyl-web/settings>, and under
"Danger Zone" change the visibility to public. The images' `org.opencontainers.image.source`
label already links them to this repository.
