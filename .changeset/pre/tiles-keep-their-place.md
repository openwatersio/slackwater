---
"@slackwater/react": patch
---

The Range and Next max tiles read "—" where there is no turn on each side of the moment, or no maximum after it, instead of disappearing. This includes `<TideStation>` and `<CurrentStation>` at the ends of their window.
