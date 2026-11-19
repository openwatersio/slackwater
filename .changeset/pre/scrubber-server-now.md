---
"@slackwater/react": minor
---

Without `now`, a server render of `<TideScrubber>` or `<CurrentScrubber>` no longer shows the build machine's time as now. It draws no now dot, no dimmed past, no Today or Tomorrow, and no Now pill, and the browser adds them once it reads the reader's clock, so the page hydrates without a mismatch when the server and browser share a `locale`. With neither `now` nor `selected`, the server render draws the middle of the supplied data with no reading, and the browser opens on now as before.
