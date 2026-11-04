---
"@slackwater/react": minor
---

Choose compass points or three-digit degrees for current directions with the provider’s `setFormat` preference. Compass is the default; saved reader choices override the provider’s initial value. Cards, scrubber readings and schedule bearings share the preference, without a T suffix. Spoken compass readings use full direction names.

`SetFormat` is exported, and standalone `CurrentScrubber` takes a `setFormat` prop. The exported `useSetFormat` hook resolves a component override, the provider preference, then the compass default. Existing `SlackwaterConfig` objects without the optional field remain valid.
