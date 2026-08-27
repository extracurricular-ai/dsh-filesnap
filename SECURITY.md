# Security Policy

## Supported versions

The latest published release is the supported one. This project is pre-1.0 and
fixes land forward rather than being backported.

## Reporting a vulnerability

**Do not open a public issue.** Report it as a
[private security advisory](https://github.com/extracurricular-ai/dsh-filesnap/security/advisories/new),
which is visible only to the maintainers of this repository.

Please include the plugin version (`npm ls dsh-filesnap`), the engine version
(`filesnap --version`), and what an attacker would be able to do. A proof of
concept helps but is not required to file.

We will acknowledge the report and tell you whether we consider it in scope. If
it is, you will be credited in the release notes unless you would rather not be.

## What is in scope

This plugin reads and writes files in your workspace and spawns the `filesnap`
binary, so the interesting classes are:

- A restore that writes outside the workspace it was given, or that follows a
  symlink out of it.
- A path, session id or turn id that escapes the store boundary.
- A capture or restore that exposes the contents of a file the ignore rules
  said to leave alone.
- Anything that lets a model-controlled string reach the engine as an argument
  it was not meant to be.

The snapshot store itself is not an encryption boundary and does not claim to
be: it holds your files, unencrypted, under your platform data directory with
your own file permissions. That is documented, not a vulnerability.

## The engine

Snapshotting and restoring is [filesnap](https://github.com/extracurricular-ai/filesnap),
a separate repository. If the issue is in how files are stored, scanned or
written back rather than in how this plugin drives it, report it there — but if
you are not sure, report it here and we will route it.
