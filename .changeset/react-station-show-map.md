---
"@slackwater/react": minor
---

`<TideStation>` and `<CurrentStation>` take `showMap={false}` to list the nearest stations without the map below them, for apps that draw their own map. MapLibre is then never loaded.
