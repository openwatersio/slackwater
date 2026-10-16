---
"@slackwater/react": minor
---

`TideStation` and `CurrentStation` show the Slackwater app's summary tiles between the timeline and the schedule, following the selected moment. A tide station's **Range** tile gives the height from the turn behind to the turn ahead, "low to high" or "high to low", and says "beyond normal here" or "the fortnight's biggest" when the swing stands out against the fifteen days either side. A current station's **Next max** tile gives the next maximum's speed and time, "Flood at 10:42 PM", with "Strong" or "Hardest" for a maximum that stands out against its own direction's. Both pages add a **Moon** tile with the phase, its glyph, and the tide it drives: spring or neap, perigean or apogean, or how much is lit. Each page makes one more request, for the fifteen days either side of the day it opened, and `prefetchTideStation` fills it.
