# Slackwater brand

The name, mark, and colors shared by every part of the Slackwater family: the iPhone app, the engine for TypeScript and Swift, the CLI, the API, the React components, and the station database.

## Name

Write it **Slackwater**: one word, capital S. Not "SlackWater", "Slack Water", or "SLACKWATER".

Lowercase `slackwater` is only for identifiers: the npm package, the CLI command, the Homebrew formula, and repository names. The Swift library product is `SlackwaterKit`, because the app's own module is already called `Slackwater`.

In prose, "the Slackwater engine" means the whole prediction stack. In code, `@slackwater/engine` means the constituent-level package with no station data attached.

## Tagline

The master line is **Tide and current predictions**. Each surface adds its own noun:

| Surface                | Line                                                      |
| ---------------------- | --------------------------------------------------------- |
| Slackwater for iPhone  | Tide and current predictions on iPhone, offline           |
| `slackwater`           | Tide predictions, with a built-in global station database |
| `@slackwater/engine`   | Harmonic engine for tide predictions                      |
| SlackwaterKit          | Swift engine for tide and current predictions             |
| `@slackwater/cli`      | Command line interface for tide predictions               |
| `@slackwater/api`      | HTTP API for tide predictions                             |
| `@slackwater/react`    | React components for tide predictions                     |
| `@slackwater/database` | Station database for tide and current predictions         |

Say "tide and current" only where a surface predicts currents. The TypeScript packages predict tides today; their lines change when they gain currents.

## Mark

The mark is the iPhone app icon: one period of a current curve on a navy field, with flood shaded blue above the zero line, ebb shaded amber below, and a green dot at slack water, where the curve crosses zero. Use it as drawn. Do not redraw, recolor, rotate, crop into the curve, or add effects.

| File                                                         | Use it for                                                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [slackwater-icon.svg](slackwater-icon.svg)                   | Square, full-bleed artwork for places that apply their own mask: app stores, avatars, favicons |
| [slackwater-icon-rounded.svg](slackwater-icon-rounded.svg)   | The mark standing alone on a page, with rounded corners like the app icon                      |
| [slackwater-logo-on-light.svg](slackwater-logo-on-light.svg) | Mark and wordmark on light backgrounds                                                         |
| [slackwater-logo-on-dark.svg](slackwater-logo-on-dark.svg)   | Mark and wordmark on dark backgrounds                                                          |

The navy field reads on light and dark backgrounds alike, so the mark itself has one version. Only the wordmark color changes.

On GitHub, pick the logo by color scheme:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/slackwater-logo-on-dark.svg" />
  <img alt="Slackwater" src="brand/slackwater-logo-on-light.svg" height="64" />
</picture>
```

Leave clear space around the mark of at least a quarter of its width, and don't set it smaller than 16 px.

For a PNG, rasterize the SVG at the size you need, for example `rsvg-convert -w 512 slackwater-icon.svg -o slackwater-icon-512.png`.

### Wordmark

The wordmark is the word Slackwater set in the system sans-serif, semibold, with slightly tight tracking. It is live text in the SVGs, so it renders in the viewer's system font (San Francisco on Apple platforms) rather than an embedded typeface. Color it `paper` on dark backgrounds and `navy-deep` on light ones.

### Source

The shipped app icon is `Slackwater/Assets.xcassets/AppIcon.appiconset/icon-1024.png` in [slackwater-ios](https://github.com/openwatersio/slackwater-ios). It was drawn by code, `tools/gen-icon.swift` (candidate A) as of [`5dae50e`](https://github.com/openwatersio/slackwater-ios/commit/5dae50e), and these SVGs use that script's geometry. The script built its colors in Core Graphics' Generic RGB space, which renders them a little lighter than the token values. The SVGs use the colors as rendered, so they match the shipped icon, and the token values below stay the ones the app's UI uses.

| Mark element  | Token            | In the mark |
| ------------- | ---------------- | ----------- |
| Field         | `canvas`         | `#041838`   |
| Field glow    | `canvas-glow`    | `#082d51`   |
| Flood shading | `flood`          | `#59afe0`   |
| Ebb shading   | `ebb`            | `#eeb24d`   |
| Slack dot     | `go`             | `#98c27b`   |
| Curve         | (sky, `#c0d8e4`) | `#cbdfe9`   |
| Zero line     | `foam`           | `#e9f3e9`   |

## Colors

[colors.css](colors.css) and [colors.json](colors.json) hold the tokens. The app's `Palette.swift` is the source of truth for every token except `page` and the `chart-*` colors, which come from [slackwater.xyz](https://slackwater.xyz). The site uses the same names as Tailwind `--color-sw-*` variables.

The one rule: **color is state, form is kind.** Color something by what it is doing, not by what it is.

- `go` green means slack, and nothing else.
- Direction is one colorblind-safe axis: `flood` blue for rising or flooding, `ebb` amber for falling or ebbing.
- `amber` is for warnings. It leans red so it can't be mistaken for ebb.
- `steel` means the state is unknown.
- The current speed ramp (`ramp-0` to `ramp-3`) runs yellow to red and never enters green.

| Token         | Value                                   | Role                                          |
| ------------- | --------------------------------------- | --------------------------------------------- |
| `navy-deep`   | `#00183c`                               | Deepest ground; wordmark on light backgrounds |
| `canvas`      | `#05122a`                               | App background                                |
| `canvas-glow` | `#0a2140`                               | Radial glow at the top of a screen            |
| `page`        | `#00121f`                               | Website background                            |
| `night`       | `#00101f`                               | Night band                                    |
| `paper`       | `#fcfcfc`                               | The wordmark on dark backgrounds, and only it |
| `foam`        | `#e4f0e4`                               | Body and secondary text                       |
| `flood`       | `#4a9fd8`                               | Flood, rising                                 |
| `ebb`         | `#e8a33d`                               | Ebb, falling                                  |
| `go`          | `#88b868`                               | Slack                                         |
| `leaf`        | `#88b868`                               | Accents, eyebrows, section labels             |
| `steel`       | `#5888a8`                               | Unknown state                                 |
| `amber`       | `#ef6f4a`                               | Warning                                       |
| `sun`         | `#f0c860`                               | Sun                                           |
| `sunrise`     | `#f0d890`                               | Sunrise                                       |
| `sunset`      | `#c8a86a`                               | Sunset                                        |
| `ramp-0`–`3`  | `#f5c96b` `#f5c96b` `#e8763c` `#c93a32` | Current speed ramp                            |
| `chart-land`  | `#f5ecd7`                               | Paper chart land                              |
| `chart-water` | `#e9f7ff`                               | Paper chart water                             |
| `chart-ink`   | `#0b1a2b`                               | Paper chart ink                               |

The app is dark-only, so these tokens assume a dark ground. Light surfaces such as documentation and npm pages use their host's colors, with the logo on light and the state colors where they mean state.
