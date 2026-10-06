# Engine design notes

These notes explain why the tide engine behaves the way it does: the conventions it follows, the sources behind each constant and rule, the alternatives that were weighed, and how each behaviour was checked. They cover the TypeScript engine in `packages/engine/src` and the Swift port in `swift/Sources/SlackwaterKit`. [docs/CONTRACT.md](../../../docs/CONTRACT.md) is the binding agreement between the two ports; these notes are the reasoning behind it.

- [Astronomy and nodal corrections](nodal-corrections.md): astronomical arguments, equilibrium arguments, the IHO and Schureman correction sets, and compound constituents.
- [Constituent names](constituent-names.md): how station constituent names map to engine definitions, including TICON's naming.
- [Extremes](extremes.md): how high and low waters are found and which ones are kept.
- [Subordinate stations](subordinate-stations.md): how time and height offsets turn a reference station's tide into a subordinate's.

## Writing a note

Add a note when a change depends on research or a judgment call that the code and its tests can't show on their own. A note should:

- describe the engine as it is, not how it got there (history belongs in commit messages and pull requests)
- cite each source with enough detail to find it, and link it where possible
- describe each validation well enough that someone can rerun it, including where its data came from
- link the open issue for each known gap instead of restating the gap's details

Delete a note when the code it explains is removed. `git log --diff-filter=D --stat -- packages/engine/docs` lists deleted notes.
