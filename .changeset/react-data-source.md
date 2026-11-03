---
"@slackwater/react": minor
---

Use local or precomputed tide and current predictions through the provider's `dataSource` prop. Hooks, maps, and server prefetch share the source and isolate cached results by dataset and access policy. HTTP consumers can keep using `baseUrl`; applications that seed query caches manually must pass the source's `cacheKey` to the query-key builders. Server rendering with different internal and public API URLs needs adapters with an explicit shared cache identity.

`useSlackwaterConfig()` exposes the active `dataSource`; `baseUrl` is optional when a source is injected. Code that constructs `SlackwaterConfig` values must supply a source, and code reading `baseUrl` must account for its absence.

Changing source identity, including changing `baseUrl`, remounts provider children to clear old selections and prediction placeholders. Older hydrated or persisted caches use unscoped keys and refetch; deploy matching server and client versions for server rendering. `SlackwaterProviderProps` is a union type, so custom props should compose it with a type intersection rather than an interface extension.
