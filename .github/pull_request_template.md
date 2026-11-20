## What failed

<!-- Issue(s) this fixes: "Fixes #N". Which challenge, what the model/adapter got wrong, and why. -->

## Change

<!-- Adapter, prompt, engine or driver change, and why it is the root cause. -->

## Proof

- [ ] The failing round(s) are labeled fixtures under `fixtures/<provider>/<name>/` (expected + notes)
- [ ] `bun run eval --filter <provider>/` passes (paste the summary line)
- [ ] `bun run check` passes (typecheck, unit, e2e)
