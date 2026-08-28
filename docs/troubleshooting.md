# Troubleshooting

[README](../README.md) · [中文](troubleshooting.zh.md)

Start with the composed profile and the engine status. Most installation issues
are either a package that was installed but not mounted, or a profile that has
not been restarted.

## The installer says “declares no dsh.bundle”

Expected:

```text
dsh: warning: dsh-filesnap declares no dsh.bundle — installed as a plain
dependency, not a profile layer
```

dsh-filesnap is currently mounted through a Cordis patch row. Add it to the same
profile used by the install command:

```yaml
- insert:
    - id: filesnap
      name: dsh-filesnap
```

For `--profile web`, edit `~/.dsh/profiles/web/cordis.patch.yml`; for
`--profile headless`, edit the headless file.

## The plugin does not appear to load

Inspect the configuration that actually boots:

```console
$ dsh --profile web --dump-config | grep -A 2 filesnap
```

You should see the `id` and package `name`. If not:

1. confirm that the package was installed into the same profile;
2. check that `insert` contains a list of rows, including both indentation
   levels shown above;
3. restart the profile after editing its patch;
4. inspect startup stderr for configuration validation failures.

Unknown config keys and invalid values fail at load. Remove the invalid field or
compare it with the [configuration table](../README.md#configuration).

## The filesnap command is unavailable

The platform binary arrives as an optional dependency of the `filesnap` npm
package. Check the copy inside the active profile:

```console
$ ~/.dsh/profiles/web/node_modules/.bin/filesnap --version
```

Prebuilt packages exist for Linux, macOS and Windows on x64 and arm64. If the
launcher is absent:

1. check whether the package manager was run with optional dependencies
   disabled;
2. reinstall `dsh-filesnap` in the profile;
3. verify the active Node version satisfies `^22.19` or `>=24`;
4. for another platform, build/install `filesnap-cli` with Cargo and set the
   plugin's `command` config to that executable.

For a subprocess provider whose execution environment is another machine, set
`command` to a bare name that the provider can resolve through its own `PATH`.

## `/rewind` lists no points

A point exists only after a turn entered and its capture completed successfully.

- Run at least one complete agent turn before listing.
- A deployment decision that rejects a step deliberately produces no capture.
- A failed capture is omitted rather than displayed as a point that cannot be
  honored; inspect stderr for the filesnap error.
- Confirm the session has a real working directory. A workspace-less agent
  cannot bind a filesnap session to a directory.

Use the engine log when you know the session id:

```console
$ ~/.dsh/profiles/web/node_modules/.bin/filesnap log --session <session-id>
```

## The browser action is missing

The same profile row mounts the host and exposes the `./client` bundle. Check:

1. the plugin appears in `--dump-config`;
2. the installed package contains `lib/client.js`;
3. the `package.json` contains `exports["./client"]` and `dsh.client`;
4. the web profile was restarted after installation;
5. startup logs contain no `client-modules: client bundle not found` message.

When developing from a checkout, build both surfaces:

```console
$ npm run build
$ npm run build:client
```

`build:client` requires a built DeepSeek Harness checkout. Follow
[CONTRIBUTING.md](../CONTRIBUTING.md) for the link step.

## `/rewind` in the web composer does not navigate

This is a current host-command limitation. The command reports the new child
session id; open that session manually. The per-turn browser action uses the
deployment's fork API and navigates automatically.

## A session stopped opening after uninstall

Reinstall and mount dsh-filesnap in the profile that opens the session. The
session log contains plugin event types that dsh's reader must know; uninstalling
does not delete the log or snapshot data.

This limitation remains until dsh provides runtime event registration or an
ignorable non-surface event path. See
[the architecture note](architecture.md#the-upstream-event-registration-gap).

## Some files are not protected

Ask the current workspace rather than guessing:

```text
/rewind status
```

The report names unprotected paths and reasons such as size, readability or file
type. Also check `.filesnapignore`; its exclusions apply symmetrically to
capture, restore and deletion.

Shell writes outside the workspace or outside the bounded recent-change scan
are covered only if the same path is observed through `ctx.fs`.

## Storage use is higher than expected

`/rewind status` separates workspace records from shared blobs. Unchanged blobs
are shared across points and sessions, so the total is not a sum of full copies.

The plugin does not yet wrap the engine's lifecycle commands. They are available
inside the profile:

```console
$ ~/.dsh/profiles/web/node_modules/.bin/filesnap doctor --workdir .
$ ~/.dsh/profiles/web/node_modules/.bin/filesnap delete --session <session-id>
$ ~/.dsh/profiles/web/node_modules/.bin/filesnap gc
```

`doctor` clears interrupted-operation debris. `delete` permanently removes the
selected session's snapshot records from the filesnap store; run it only when
those rewind points are no longer needed. `gc` reclaims blobs that are already
unreachable. None of these commands changes the project or Git repository.

## Collecting a useful bug report

Include:

- dsh-filesnap and dsh versions;
- operating system and architecture;
- active profile name;
- the `--dump-config` row, with secrets removed;
- startup stderr and the failed command's output;
- `/rewind status` output when the issue is about coverage or storage;
- whether the problem occurs in web, headless or both.

Do not attach private source files or session logs without checking their
contents. Report security problems through [SECURITY.md](../SECURITY.md).
