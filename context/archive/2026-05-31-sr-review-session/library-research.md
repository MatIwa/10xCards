# Library Research (2026-06-01)

Research source: Exa MCP tools (`web_search_exa`, `web_fetch_exa`, `web_search_advanced_exa`) via `mcp-remote`.

## Shortlist Compatible With Current Stack

1. `ts-fsrs` (FSRS)
   - NPM: https://www.npmjs.com/package/ts-fsrs
   - Signals: MIT, 0 dependencies, active maintenance, high adoption.
   - Fit: Excellent technical fit for TypeScript + edge runtime; rich review APIs (`repeat`, `next`) and rating model.
   - Caveat: Current roadmap/data direction is SM-2 style (`interval`, `ease_factor`, `repetitions`), while FSRS is best modeled with different memory-state fields.

2. `supermemo` (SM-2)
   - NPM: https://www.npmjs.com/package/supermemo
   - Signals: MIT, 0 dependencies, small package, maintained.
   - Fit: Best schema fit with current roadmap assumptions. Uses `interval`, `repetition`, `efactor` and 0-5 recall grades.

3. `@open-spaced-repetition/sm-2` (SM-2)
   - NPM: https://www.npmjs.com/package/@open-spaced-repetition/sm-2
   - Signals: MIT, 0 dependencies, small package.
   - Fit: Good SM-2 fit and includes serializable `Card`/`ReviewLog` objects.
   - Caveat: Lower adoption and documented unstable versioning.

4. `femto-fsrs` (FSRS 5)
   - NPM: https://www.npmjs.com/package/femto-fsrs
   - Signals: MIT, 0 dependencies, minimalistic.
   - Fit: Works for edge environments and compact deployments.
   - Caveat: Intentionally minimal feature set compared to `ts-fsrs`.

5. `fsrs.js` (FSRS)
   - NPM: https://www.npmjs.com/package/fsrs.js
   - Signals: MIT, 0 dependencies.
   - Fit: Usable but superseded by `ts-fsrs`.
   - Caveat: Upstream recommends transitioning to `ts-fsrs`.

## Recommendation For S-02

- Default recommendation for current roadmap/schema: `supermemo`.
- Alternative recommendation if we choose better modern scheduling and can adjust schema: `ts-fsrs`.
- Do not start new implementation with `fsrs.js`; prefer `ts-fsrs` instead.
