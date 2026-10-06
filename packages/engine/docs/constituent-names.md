# Constituent names

A station's harmonic constants are labeled with constituent names. The engine looks each name up in [`src/constituents/data.json`](../src/constituents/data.json) to find the definition behind it: a speed, an extended Doodson number (XDO), and an IHO nodal correction code. The XDO fixes both the astronomical argument and its phase constant. A name only means what its publisher meant by it, and two publishers can use the same name for different lines. This page covers how names from each source map to definitions, and how a disputed name is tested against raw records.

## Sources

- The IHO TWCWG constituent list is the base of `data.json`, with names, speeds, XDO numbers and nodal codes. The copy in this repo is [docs/TWCWG_Constituent_list.md](../../../docs/TWCWG_Constituent_list.md), converted from the [PDF](../../../docs/TWCWG_Constituent_list.pdf).
- NOAA CO-OPS publishes harmonic constants per station through its metadata API, for example `https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/9413450/harcon.json`. Its phases follow the Schureman sign convention, and so does the engine's argument (see [XDO to Doodson conversion](../README.md#xdo-to-doodson-conversion)).
- TICON-4 is a global set of constants fitted to GESLA-4 tide gauge records, published at <https://www.seanoe.org/data/00980/109129/>. The [user manual](https://www.seanoe.org/data/00980/109129/data/122852.pdf) lists every name with a Doodson number and speed in Table 1. Names are written without super- or subscripts.
- Kartverket's own variants of standard constituents carry a `_KV` suffix, such as `SA_KV`.

## Aliases

Each entry has a canonical name and a list of `aliases`, and every alias resolves to the same definition. Aliases cover Greek spellings (`ν2`), the upper-case forms NOAA and TICON use (`NU2`, `LAMBDA2`), and other spellings of the same line.

A station must never carry two names that resolve to one definition. The prediction sums both amplitudes into a single term on a single line, and nothing gets predicted on the line the second name actually meant. [`test/constituents/database.test.ts`](../test/constituents/database.test.ts) checks every station in `@slackwater/database` for this. Only add an alias when the source means the same line with the same phase constant.

## TICON's non-IHO names

TICON uses some names that aren't in the IHO list, or that mean a different line there. Each of these has its own entry in `data.json`:

| Name | TICON Doodson | Speed (°/h) | Engine definition              |
| ---- | ------------- | ----------- | ------------------------------ |
| 3N2  | 245.555       | 28.4350877  | Own entry, +90° phase constant |
| 3L2  | 265.555       | 29.5331208  | Own entry, no phase constant   |
| T3   | 381.555       | 44.9589333  | Own entry, no phase constant   |
| R3   | 383.555       | 45.0410706  | Alias of SK3                   |

3N2 and 3L2 come from the degree-3 part of the tide-generating potential. A lunar line's degree shows in its Doodson digits: subtract the offset of 5 from every digit after the first and add up the coefficients. The total is even for degree-2 terms and odd for degree-3 terms. That gives 1 for 245.555 and 3 for 265.555, against 2 for N2 at 245.655. Degree-3 terms of species 2 are sine terms, so their arguments carry a phase constant of plus or minus 90°. TICON's published phases need +90° for 3N2 and −90° for 3L2. The 3L2 entry has no phase constant yet; see [open phase gaps](#open-phase-gaps).

## The MKS2 and 3N2 rows in Table 1

Table 1 of the TICON-4 manual lists MKS2 at 245.555 (28.4350877°/h) and 3N2 at 257.555 (29.0662415°/h). TICON's published constants describe the opposite:

- MKS2 is the IHO MKS2, M2 + K2 − S2, at 257.555.
- 3N2 is the degree-3 line at 245.555, with a +90° phase constant.

Scoring both names against raw records with the method below gives:

| TICON name | Line tested   | Median score | Range          |
| ---------- | ------------- | ------------ | -------------- |
| MKS2       | 257.555       | 1.04         | 0.67 to 1.38   |
| MKS2       | 245.555       | −0.97        | −1.41 to 0.62  |
| 3N2        | 257.555       | −0.94        | −1.57 to 0.26  |
| 3N2        | 245.555       | −1.07        | −1.41 to −0.65 |
| 3N2        | 245.555 + 90° | 0.91         | 0.52 to 1.60   |
| 3N2        | 245.555 − 90° | −2.89        | −3.60 to −2.52 |

MKS2 was scored at twelve gauges where it exceeds 4 cm, including Avonmouth, Newport, Bordeaux and Derby. 3N2 was scored at sixteen gauges where it exceeds 1 cm, including Liverpool (Nova Scotia), Spencers Island, Cardwell and Saint John. A phase sweep for 3N2 on 245.555 peaks at +90° at most of them and lands within 15° at the rest. So the engine defines MKS2 as the IHO line and 3N2 as its own entry, and the two TICON names resolve to different definitions.

## Scoring a line against raw records

This test checks which line a published constituent describes. It predicts a gauge's raw record from the station's other constituents. Then it measures how much of the leftover variance the constituent removes when placed on a candidate line. The tool is [`packages/harmonic-analysis/score-line.ts`](https://github.com/openwatersio/slackwater-database/blob/main/packages/harmonic-analysis/score-line.ts) in slackwater-database:

```sh
npm run score-line -w packages/harmonic-analysis -- <ticon-id> <name> [245.555+90 ...] [--sweep] [--nodal=NAME] [--without=NAME ...]
```

### Records

Each TICON station is fitted to the GESLA-4 file named by its `tide_gauge_name`, which is also the station id in slackwater-database. `ensureGeslaData()` in slackwater-database (`packages/datums/download-gesla.ts`) downloads `GESLA4_ALL.zip` from the project's mirror and extracts it to `tmp/GESLA`.

You can fetch a single station without downloading the whole archive. The mirror honors HTTP `Range` requests, so you can read the zip's central directory and then that one entry. The archive is larger than 4 GB, so you need to find the central directory through the ZIP64 end records, then inflate the entry's raw deflate stream. Python's `zipfile` does all of this over any seekable file object whose `read` issues range requests. Send a `User-Agent` like curl's, because the mirror rejects Python's default one.

Parse the file as `parseGeslaSamples()` in `packages/datums/datum.ts` does:

- Keep rows whose fifth column (use in analysis) is `1`.
- Drop the header's `NULL VALUE`.
- Shift by the header's `TIME ZONE HOURS`.
- Keep only samples on the hour. Hourly data is enough, and it keeps minute-resolution records tractable.

### Score

1. For each sample time `t`, compute the astronomical arguments `astro(t)`.
2. Predict the base from the station's other constituents with the engine's definitions: `base = Σ A·f·cos(V + u − G)`. Here `V` is the constituent's argument and `f`, `u` its nodal correction at `t`.
3. Take the residual `r = level − base`.
4. Place the scored constituent on a candidate line using its published amplitude `A` and phase `G`: `m = A·f·cos(V_line + u − G)`. `V_line` is the line's Doodson argument plus any phase constant, and `f`, `u` come from the nodal correction chosen for the line.
5. Compute `score = (Var(r) − Var(r − m)) / Var(m)`. `Var(m)` is close to `A²/2`.

### Reading the score

- A score of +1 means the published amplitude and phase match real signal on that line. Removing the term removes exactly its own variance.
- A score of −1 means the term is unrelated to the signal on that line. Subtracting it adds its own variance and removes nothing. The same thing happens when the line is right but the phase is off by 90°.
- A score of −3 means the term is in anti-phase. Subtracting it doubles the signal it should cancel, so the line is right and the phase is off by 180°.

Values in between mean the match is partial, or the record is noisy or has problems. Use gauges with long, clean records: GESLA quality "No obvious issues" and at least eight years of data. Use constituents with a few centimeters of amplitude or more.

### Phase sweep

To find a phase constant, add 0°, 15°, and so on up to 345° to the candidate line's argument and keep the best score. With `--sweep`, the tool does this for every Doodson line given. A peak at +90° means TICON's argument is the engine's plus 90°. A TICON phase converts to the engine's convention by subtracting that offset.

### Pitfalls

- Leave out of the base any other name that resolves to the same definition as the scored one, with `--without`. Otherwise the base already holds a term on the scored line.
- Match the nodal correction to the line with `--nodal`; for 3N2 use N2's. A strongly modulated correction on the wrong line, such as MKS2's, blurs a long record's score toward 0.
- Skip the stations slackwater-database re-fits from re-zoned records, from the `wsv` and `rws` sources. Their constants are those re-fits, not TICON's.

## The 3N2 nodal correction

3N2 uses nodal code `x`. That decomposes the name to N2, so 3N2 takes N2's `f` and `u`, which are M2's. 3L2's `x` takes L2's the same way. TICON doesn't document its nodal treatment, and a degree-3 line's true nodal modulation differs from N2's. Scores with N2's correction and with none agree, so the choice doesn't change which line TICON's constants describe.

## Open phase gaps

TICON's phases for these constituents match the engine's line but not its argument. The offset is what TICON's argument adds to the engine's:

| Name         | Offset | Gauges scored                               |
| ------------ | ------ | ------------------------------------------- |
| M3           | 180°   | Thevenard                                   |
| sigma1 (SGM) | 180°   | Anchorage, Keling, Port Pirie               |
| T3           | 180°   | Ashland Avenue (NY), Thevenard              |
| R3           | −90°   | Ashland Avenue (NY), Anchorage, Thevenard   |
| 3L2          | −90°   | Spencers Island, West Dipper Harbour, Digby |
| 2MK5         | −90°   | Anchorage, Puerto Madryn                    |
| 2MO5         | +90°   | Puerto Madryn, Anchorage                    |

Each scores close to +1 at its offset and close to −3 or −1 without it. M3, sigma1, 2MK5 and 2MO5 keep their IHO definitions because other sources publish them too, such as NOAA's M3. For those four the fix is a per-name phase conversion when slackwater-database imports TICON, not a change to `data.json`. This is tracked in [openwatersio/slackwater-database#239](https://github.com/openwatersio/slackwater-database/issues/239). S1, P1, T2, R2, S3 and S4 gave inconsistent scores between gauges; they are radiational or noisy constituents and remain unsettled.
