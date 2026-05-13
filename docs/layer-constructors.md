# Layer constructors: `succeed` vs `sync` vs `effect` vs `scoped`

Quick rule: pick the constructor based on **how the service is built**, not on what its methods do.

## The four constructors

| Constructor                   | When to use                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Layer.succeed(Tag, impl)`    | Implementation is a ready value. No I/O, no errors, no dependencies.                                                                                               |
| `Layer.sync(Tag, () => impl)` | Same as `succeed`, but lazy — the factory runs at layer build time, not at definition time. Useful when you don't want to touch `process.env` / globals at import. |
| `Layer.effect(Tag, effect)`   | Construction needs an `Effect`: reads `Config`, does I/O, can fail, depends on other services. **But nothing needs to be closed.**                                 |
| `Layer.scoped(Tag, effect)`   | Same as `effect`, **plus acquire/release**: DB pool, file handle, socket, subscription, timer. Finalizers run when the program shuts down.                         |

## Decision tree

Ask about how the service is **constructed** (ignore method bodies):

1. Plain literal/object? → `Layer.succeed`
2. Lazy but no effects? → `Layer.sync`
3. Needs an `Effect` (non-empty `E` or `R`) and **nothing to release**? → `Layer.effect`
4. Needs an `Effect` **and there is something to release**? → `Layer.scoped`

The most common mistake is choice #4: people use `Layer.effect` for a DB, open a pool, and never close it. If you see `acquireRelease`, `addFinalizer`, an opened connection / file / subscription — it is **`Layer.scoped`**.

## Examples

### `Layer.succeed` — pure object

```ts
const LoggerLive = Layer.succeed(Logger, {
  log: (s) => Effect.sync(() => console.log(s)),
});
```

### `Layer.sync` — lazy sync construction

```ts
const ClockLive = Layer.sync(Clock, () => ({
  now: () => Date.now(),
}));
```

### `Layer.effect` — needs Config, can fail, holds nothing

```ts
const ApiClientLive = Layer.effect(
  ApiClient,
  Effect.gen(function* () {
    const cfg = yield* Config;
    return ApiClient.of({ baseUrl: cfg.baseUrl, fetch });
  }),
);
```

### `Layer.scoped` — opened a pool, must close it

```ts
const DbLive = Layer.scoped(
  Db,
  Effect.gen(function* () {
    const cfg = yield* Config;
    const pool = yield* Effect.acquireRelease(
      Effect.promise(() => createPool(cfg.url)),
      (p) => Effect.promise(() => p.end()),
    );
    return Db.of({ query: (sql) => Effect.promise(() => pool.query(sql)) });
  }),
);
```

## Layer channels

`Layer` mirrors `Effect`'s three-channel shape:

```ts
Layer<RIn, E, ROut>;
//    ↑    ↑  ↑
//    |    |  └── services the layer PROVIDES (output)
//    |    └───── how building the layer can fail
//    └────────── services the layer NEEDS to be built (input)
```

- `Layer.succeed` → `Layer<never, never, Tag>`
- `Layer.effect` / `Layer.scoped` can have non-empty `RIn` (depend on other layers) and `E` (fail during init).

So the precise version of the rule is: **use `succeed` when `RIn = never`, `E = never`, and there is nothing to release.** Otherwise use `effect`, or — if there is a finalizer — `scoped`.
