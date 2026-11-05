# Verification

Run from the repository root:

```sh
node --test tools/validation/data.test.cjs
```

The tests transpile the real miniprogram TypeScript services in isolated VM contexts with in-memory wx storage and RPC doubles. They make no network requests, load no environment credentials, and never change real account data. Node JSON loading verifies content/algorithms only; it cannot validate WeChat's module loader.

2026-09-07 post-fix baseline: 16 tests, 16 pass. D02–D05 are covered here, including recovery after eight failures and a mixed A/B account queue. D01 is not represented by this Node harness; it was separately verified in WeChat DevTools (Stable 2.02.2608060, base library 3.17.2): a clean rebuild reported 0 errors and S2 rendered 30 unique words. D06 remains a source-review finding awaiting end-to-end reproduction.

`read-only.sql` checks aggregate database invariants and metadata, with no user content or mutations. Run through the configured linked deployment project, as described in the local `docs/operations-and-tests.md`. It reports observations rather than enforcing expected values: expect base count 4553, missing meanings/owner mismatches/duplicate keys/invalid goals 0, RLS table count 4, index count 1. An empty activation table cannot validate activation behavior. RLS metadata does not establish that cross-user requests are rejected.

Detailed results, screenshot comparisons, remaining manual steps and evidence are in the local, gitignored `docs/operations-and-tests.md` and `docs/validation/2026-09-07/`.
