<!--
Thanks for sending this. Nothing below is mandatory — a good change with an
empty description still beats no change. Delete whatever does not apply.
-->

**What this does, and why.** The why is the part that is hard to recover later.

**How it was checked.** `npm run typecheck && npm test`, or which tier you could
run — `npm run test:standalone` needs neither the harness nor the binary, and
saying you could not run the rest is fine.

**Behaviour change?** If it changes when a snapshot is taken, what a rewind point
means, or how a rewind is sequenced, a test that fails without this change is
worth more than a description of one.

---

- [ ] Commits are signed off (`git commit -s`) — the [DCO](https://developercertificate.org/)
