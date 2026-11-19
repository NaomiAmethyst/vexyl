# Releasing

A release has one version for everything: the command, the Go module, the TypeScript library, the
Java library, the Ruby library, the Rust library and the images. That version is the one in
`ts/package.json`, and `java/pom.xml`, `ruby/lib/vexyl/version.rb` and `rust/Cargo.toml` have to say
the same.

## Making a release

1. Set the version in `ts/package.json`, and in `ts/package-lock.json` with it:
   `cd ts && npm version --no-git-tag-version 1.2.3`; in `java/pom.xml`:
   `mvn -f java/pom.xml versions:set -DnewVersion=1.2.3 -DgenerateBackupPoms=false`; in
   `ruby/lib/vexyl/version.rb`; and in `rust/Cargo.toml`, and `rust/Cargo.lock` with it:
   `cargo update --manifest-path rust/Cargo.toml --workspace`. Commit that.
2. Tag the commit `v1.2.3`, and push the commit and the tag:
   `git tag -s v1.2.3 -m 'Vexyl 1.2.3' && git push origin main v1.2.3`.
3. Once `release.yml` has finished, publish the Java library's deployment in the Central Portal,
   as [Maven Central](#maven-central) says.

Pushing the tag starts two workflows.

`release.yml` stops at once if the tag isn't `v` and the version in `ts/package.json`, or if
`java/pom.xml`, `ruby/lib/vexyl/version.rb` or `rust/Cargo.toml` says another. Then it:

- tags the same commit `go/v1.2.3` and pushes that, since the Go module is in `go/` and Go looks
  for its versions under that prefix. It then asks the Go module proxy for the version, which is
  what puts it on pkg.go.dev.
- builds the command for Linux, macOS and Windows on amd64 and arm64, packs each with `LICENSE`
  and `NOTICE`, writes `SHA256SUMS`, and makes the GitHub release with notes from the changes since
  the last one.
- tests and builds the library, and publishes it to npm with provenance.
- tests the Ruby library, builds the gem and pushes it to RubyGems.
- tests the Rust library and publishes the crate to crates.io.

npm, RubyGems and crates.io all trust the workflow by its OIDC token, so there's no token secret for
any of them. A version that's already on one is skipped, so the workflow can be run again.

`docker.yml` pushes both images tagged `1.2.3`, `1.2`, `1` and `latest`.

A version with a hyphen, such as `1.2.3-rc.1`, is a prerelease: the GitHub release says so, npm
gets it under the `next` tag instead of `latest`, RubyGems gets it as `1.2.3.pre.rc.1`, and the
images get only `1.2.3-rc.1`. Every registry but npm keeps a prerelease out of the way on its own.

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

`name.amethyst:vexyl` goes to Maven Central through the Central Portal, <https://central.sonatype.com>,
where the namespace `name.amethyst` is verified by a DNS TXT record on `amethyst.name`.

- **The upload.** `release.yml` calls `maven.yml`, which checks that `java/pom.xml` is the release's
  version and runs `mvn -P release deploy`. The `release` profile adds the sources and Javadoc jars,
  signs every file and uploads them with `central-publishing-maven-plugin`, with `autoPublish` off.
  The deployment then waits in the Portal, under Deployments: check that it validated, and publish it
  there. A version on Central can never be changed or removed, so nothing publishes it automatically.
- **Trying it.** Running `maven.yml` by hand, from the Actions tab, uploads the current commit as
  `0.0.0-check.N`. Check it in the Portal and drop it there; never publish one.
- **The secrets.** `CENTRAL_USERNAME` and `CENTRAL_PASSWORD` are a Portal user token (Account, Generate
  User Token). `GPG_PRIVATE_KEY` and `GPG_PASSPHRASE` are a key made only for signing releases, kept
  with its revocation certificate in `~/.config/vexyl-release/` and published on keyserver.ubuntu.com:
  `2A8872A8188BA3F3F7742ACA4A9293202EB8CE6F`. It expires on 2028-11-12; extend it with
  `GNUPGHOME=~/.config/vexyl-release/gnupg gpg --quick-set-expire FINGERPRINT 2y`, send it to the
  keyserver again and update `GPG_PRIVATE_KEY`.
- **By hand.** With the key's keyring and a `settings.xml` holding the server `central`:
  `GNUPGHOME=~/.config/vexyl-release/gnupg MAVEN_GPG_PASSPHRASE=... mvn -f java/pom.xml -P release -DskipTests deploy`.

### RubyGems

The gem is `vexyl`. Since November 2026, trusted publishing only makes a new gem when the workflow
names the account that will own it, and `rubygems/configure-rubygems-credentials` has no input for
that yet (<https://github.com/rubygems/configure-rubygems-credentials/issues/489>). So, like npm and
crates.io, the first version was pushed by hand, and the workflow publishes the ones after it.

1. Make an account at <https://rubygems.org/sign_up>, and turn on two-factor authentication: the
   gemspec sets `rubygems_mfa_required`.
2. Push the gem once, from a clean checkout of the tagged commit:

   ```sh
   cd ruby
   cp ../LICENSE ../NOTICE .
   gem build vexyl.gemspec
   gem signin
   gem push vexyl-1.2.3.gem
   rm LICENSE NOTICE vexyl-1.2.3.gem
   ```
3. On the gem's page, <https://rubygems.org/gems/vexyl/trusted_publishers>, add a trusted publisher:
   GitHub Actions, owner `NaomiAmethyst`, repository `vexyl`, workflow `release.yml`, and leave
   the environment and the reusable workflow's owner and name empty.

The gem leaves `LICENSE` and `NOTICE` out of git: the workflow copies them in from the root before
it builds, as it does for npm. To build by hand, do the same:
`cd ruby && cp ../LICENSE ../NOTICE . && gem build vexyl.gemspec`.

### crates.io

The crate is `vexyl`. Like npm, crates.io only takes a trusted publisher for a crate that's already
there, so the first version has to be published by hand. `rust/LICENSE` and `rust/NOTICE` are links
to the root's, and Cargo packs the files they point to.

1. Sign in at <https://crates.io> with GitHub, and verify the email address under Account
   Settings: crates.io refuses a publish until it's verified.
2. Make an API token under Account Settings → API Tokens, with the `publish-new` scope, and
   publish once, from a clean checkout of the tagged commit:

   ```sh
   cd rust
   cargo package --list    # Cargo.toml, Cargo.lock, README.md, LICENSE, NOTICE, src/
   cargo publish           # CARGO_REGISTRY_TOKEN="$(cat token-file)" cargo publish
   ```

   If `release.yml` ran first, its `crates` job failed for want of a trusted publisher; once the
   crate is published, there's nothing to run again.
3. On the crate's Settings page, <https://crates.io/crates/vexyl/settings>, add a trusted publisher
   for GitHub: owner `NaomiAmethyst`, repository `vexyl`, workflow `release.yml`, and no
   environment. Then revoke the API token.

### The images

GHCR makes a package private the first time it's pushed, even from a public repository. After
the first push to main, open each of <https://github.com/users/NaomiAmethyst/packages/container/vexyl/settings>
and <https://github.com/users/NaomiAmethyst/packages/container/vexyl-web/settings>, and under
"Danger Zone" change the visibility to public. The images' `org.opencontainers.image.source`
label already links them to this repository.
