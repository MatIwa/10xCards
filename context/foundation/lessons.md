# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Do not add Lodash without a clear reason

- **Context**: Implementation of functions in a TypeScript application on the frontend and backend.
- **Problem**: The developer used `_.filter()` even though Lodash is not part of the project. This would add an unnecessary dependency and violate the local convention of using native APIs.
- **Rule**: Do not add Lodash without a clear indication. The project prefers native JS/TS functions in the 2026+ standard.
- **Applies to**: plan, implement, impl-review
