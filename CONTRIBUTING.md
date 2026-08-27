# Contributing

English | [中文](CONTRIBUTING.zh.md)

**Issues and pull requests are welcome, and neither has to be polished.** A bug
report that is one sentence and a stack trace is worth more than the thorough one
that never got written. If you are not sure whether something is a bug, a gap or
a misunderstanding, open the issue anyway and we will work it out there.

Write in English or Chinese, whichever is easier — 中文提 issue 完全没问题。

Three places, and picking the wrong one costs nothing:

| | |
|---|---|
| [Discussions](https://github.com/extracurricular-ai/dsh-filesnap/discussions) | questions, ideas, "is this supposed to work like this", showing what you built |
| [Issues](https://github.com/extracurricular-ai/dsh-filesnap/issues) | something is broken, or something specific should change |
| [Pull requests](https://github.com/extracurricular-ai/dsh-filesnap/pulls) | you already fixed it |

## Reporting a bug

**If files were lost or came back wrong, say that first.** Everything else can
wait; that one we want to see immediately.

Three things make a rewind bug reproducible, and all three are one command each:

```console
$ npm ls dsh-filesnap                 # the plugin version
$ filesnap --version                  # the engine version
$ dsh --profile <name> --dump-config | grep -A 1 filesnap
```

Then what the engine itself recorded, which is usually the answer:

```console
$ filesnap log --session <session-id>     # the points it holds for that session
$ filesnap status                         # what it does not protect here, and why
```

`filesnap status` re-scans, so it describes the project as it stands now rather
than as it stood at the turn that went wrong. Both are useful; say which is which.

Worth knowing before you file: a turn whose capture failed offers no rewind point
at all, and the failure went to stderr at the time. If a point you expected is
simply absent, the harness log from that session is the place it will have been
recorded.

## Proposing a change

**Small and obvious — a typo, a wrong error message, a missing guard, a test for
something already broken — open a pull request directly.** No issue needed.

**Anything that changes behaviour, open an issue first.** Not as a gate, but
because the answer is often "that belongs in the other repository", and it is
better to find that out before you write it. In particular:

| what you want to change | where it belongs |
|---|---|
| when a snapshot is taken, what a rewind point means, how a rewind is sequenced, the commands, the browser half | **here** |
| what a snapshot covers, how files are stored or restored, the scan bounds, the store format, the CLI | [filesnap](https://github.com/extracurricular-ai/filesnap) |

The split is deliberate: this package is about 1,100 lines of harness-side
policy, and [`src/cli.ts`](src/cli.ts) — 116 non-comment lines — is the entire
interface to the engine. If your change would make `src/cli.ts` know something
about snapshots, it probably belongs on the other side of it.

## Working on it

The harness packages are `peerDependencies`, so a local checkout needs them
linked from a built sibling:

```console
$ git clone https://github.com/deepseek-ai/deepseek-harness ../deepseek-harness
$ ( cd ../deepseek-harness && pnpm install && pnpm run build )
$ npm install
$ npm run harness:link
$ npm run typecheck && npm test
```

`harness:link` has to be re-run after any `npm install` — npm prunes what
`package.json` does not name, and those links are deliberately not named there.
The [README's Development section](README.md#development) explains why.

The suite has four tiers, and the cheapest one needs nothing at all:

```console
$ npm run test:standalone   # no harness, no binary
$ npm test                  # everything, driving the real filesnap binary
```

`FILESNAP_BIN` points the engine-facing suites at a different build.

**A change to behaviour wants a test that fails without it.** The wiring suite
exists because the service-tier tests cannot see a whole class of failure: a
plugin that is silently absent still passes every test that calls its methods
directly. If your change touches how the plugin attaches to the harness,
`tests/wiring.spec.ts` is where it gets proven.

## Commits

Sign your commits off — `git commit -s`. It is the [Developer Certificate of
Origin](https://developercertificate.org/): you are stating that you wrote the
patch or otherwise have the right to submit it under this project's licence.

For the message, look at `git log`. The convention here is a sentence that says
what the commit does and, where it is not obvious, why — no `feat:` prefixes, no
emoji. A message that explains the reasoning is worth more than a tidy subject
line, and the body is the right place for it.

## Code of conduct

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). It is
short and it is the ordinary one: be decent, assume good faith, and do not make
this a place people have to steel themselves to post in.

## Licence

Contributions are accepted under [Apache-2.0](LICENSE), the licence this project
and its engine are released under. There is no CLA.
