---
"@slackwater/engine": minor
---

Use the constituent definitions and nodal corrections supplied on tide and current station records. The NOAA and Kartverket defaults take effect with a database that carries the metadata from openwatersio/slackwater-database#447. Records without this metadata still use IHO, and callers can override the correction set.

Prediction throws if a supplied reference does not match the subordinate station's reference ID.
