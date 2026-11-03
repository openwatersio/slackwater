---
"@slackwater/react": minor
---

`TideStation` and `CurrentStation` show the Slackwater app's summary tiles between the timeline and the schedule, following the selected moment. A tide station's **Range** tile gives the height from the turn behind to the turn ahead, "low to high" or "high to low", and says "beyond normal here" or "the fortnight's biggest" when the swing stands out against the fifteen days either side. A current station's **Next max** tile gives the next maximum's speed and time, "Flood at 10:42 PM", with "Strong" or "Hardest" for a maximum that stands out against its own direction's. Both pages add a **Moon** tile with the phase, its glyph, and the tide it drives: spring or neap, perigean or apogean, or how much is lit. Both pages fetch the fifteen days either side of the day they opened for ranking; tide pages also fetch the complete outlook week. `prefetchTideStation` fills both.

The water tile spans the width above paired Moon and Sun tiles; all three share a row in wide panes. Sun names the next rise/set and daylight duration. Range shows seven daily swing bars and fetches a complete week when the outlook shifts.
