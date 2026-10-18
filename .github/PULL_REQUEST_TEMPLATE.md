## What & why

<!-- One or two sentences: what does this change and what problem does it solve? -->

## Area

- [ ] Backend (`dashboard/server`)
- [ ] Frontend (`dashboard/web`)
- [ ] Firmware (`firmware/esp32-risk-mini`)
- [ ] Docs / assets

## How it was verified

<!-- Paste the commands you ran and their result, e.g. `pytest -q` → 41 passed -->

- [ ] `pytest -q` (from `dashboard/`)
- [ ] `npm run build && npm test` (from `dashboard/web/`)
- [ ] `pio run -e esp32c3-supermini` (from `firmware/esp32-risk-mini/`, if firmware changed)

## Notes for reviewers

<!-- Anything risky, a follow-up, or a screenshot/log -->