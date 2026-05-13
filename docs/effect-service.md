# `Effect.Service` — the higher-level service API

`Effect.Service` is a **shorthand class helper** that bundles three things — the Tag, its Layer, and any direct dependencies — into a single declaration. It replaces the older pattern of `class extends Context.Tag(...)` + a separate `static readonly Live = Layer.effect(...)`.

## TL;DR

| Aspect                 | Old: `Context.Tag` + `Layer`                      | New: `Effect.Service`                                                 |
| ---------------------- | ------------------------------------------------- | --------------------------------------------------------------------- |
| Identity (Tag)         | `class X extends Context.Tag("X")<X, Shape>() {}` | inside the helper call                                                |
| Implementation (Layer) | `static readonly Live = Layer.effect/...`         | inside the helper call (`succeed` / `effect` / `sync` / `scoped` key) |
| Dependencies           | wired manually via `.pipe(Layer.provide(...))`    | declarative `dependencies: [...]` array                               |
| Default Layer name     | `.Live` (convention)                              | `.Default` (auto-generated, deps already merged)                      |
| Service shape          | anything (incl. primitives like `string`)         | a **record of methods/values**                                        |

`Effect.Service` is just sugar on top of the same primitives — it produces a Tag and a Layer under the hood. The benefit is less boilerplate and a single source of truth right where the service is defined.

## Anatomy

```ts
export class ServiceName extends Effect.Service<ServiceName>()(
  "ServiceName", // ← Tag key (string)
  {
    // exactly ONE of: succeed | sync | effect | scoped
    effect: Effect.gen(function* () {
      /* build impl */ return {
        /* methods */
      };
    }),

    // optional: direct Layer dependencies, pre-wired into .Default
    dependencies: [Dep1.Default, Dep2.Live],

    // optional: accessors-related flags (rarely needed at the start)
  },
) {}
```

The class extends a curried call:

- `Effect.Service<ServiceName>()` — first call passes the class type so the Tag/Layer types are inferred correctly.
- `(...)("ServiceName", { ... })` — second call accepts the Tag key + config.

What you get back:

- `ServiceName` — usable as a Tag (`yield* ServiceName`) **and** the type of the service.
- `ServiceName.Default` — a `Layer` ready to be provided, with `dependencies` already mixed in.

## The four build modes

The config object accepts exactly one of these keys — analogous to the `Layer.*` constructors:

| Key                                    | Equivalent      | When to use                                                        |
| -------------------------------------- | --------------- | ------------------------------------------------------------------ |
| `succeed: value`                       | `Layer.succeed` | Plain ready value. No I/O, no deps.                                |
| `sync: () => value`                    | `Layer.sync`    | Lazy sync construction.                                            |
| `effect: Effect<Shape, E, R>`          | `Layer.effect`  | Build requires an `Effect` (config, other services, can fail).     |
| `scoped: Effect<Shape, E, R \| Scope>` | `Layer.scoped`  | Build holds a resource that must be released (pool, file, socket). |

The same decision tree as for raw layers applies — see [`layer-constructors.md`](./layer-constructors.md).

## Usage patterns from this project

### 1. Static value — `succeed`

```ts
// PokemonCollection.ts
export class PokemonCollection extends Effect.Service<PokemonCollection>()("PokemonCollection", {
  succeed: ["staryu", "perrserker", "flaaffy"],
}) {}
```

No I/O, no dependencies — equivalent to `Layer.succeed(Tag, [...])`.

### 2. Service with a dependency — `effect` + `dependencies`

```ts
// BuildPokeApiUrl.ts
export class BuildPokeApiUrl extends Effect.Service<BuildPokeApiUrl>()("BuildPokeApiUrl", {
  effect: Effect.gen(function* () {
    const pokeApiUrl = yield* PokeApiUrl;
    return ({ name }: { name: string }) => `${pokeApiUrl}/${name}`;
  }),
  dependencies: [PokeApiUrl.Live],
}) {}
```

What `dependencies` does: when you later do `Effect.provide(BuildPokeApiUrl.Default)`, the `PokeApiUrl.Live` layer is **already provided inside** — the consumer does not need to mention `PokeApiUrl` again.

Equivalent in the old style:

```ts
static readonly Live = Layer
  .effect(BuildPokeApiUrl, /* gen */)
  .pipe(Layer.provide(PokeApiUrl.Live))   // dependencies wired manually
```

### 3. Service that depends on other `Effect.Service`s — pass `.Default`

```ts
// PokeApi.ts
export class PokeApi extends Effect.Service<PokeApi>()("PokeApi", {
  effect: Effect.gen(function* () {
    const pokemonCollection = yield* PokemonCollection;
    const buildPokeApiUrl = yield* BuildPokeApiUrl;
    return {
      getPokemon: Effect.gen(function* () {
        /* ... */
      }),
    };
  }),
  dependencies: [
    PokemonCollection.Default, // 👈 use .Default for Effect.Service deps
    BuildPokeApiUrl.Default,
  ],
}) {}
```

Rule of thumb:

- Dependency built with `Context.Tag` + `Layer.effect/...` → pass `.Live`.
- Dependency built with `Effect.Service` → pass `.Default`.

(`.Default` is the convention auto-generated by `Effect.Service`; `.Live` is the convention humans pick when writing layers by hand.)

### 4. Primitive-value service — keep `Context.Tag`

```ts
// PokeApiUrl.ts
export class PokeApiUrl extends Context.Tag("PokeApiUrl")<PokeApiUrl, string>() {
  static readonly Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const baseUrl = yield* Config.string("BASE_URL");
      return `${baseUrl}/api/v2/pokemon`;
    }),
  );
}
```

`Effect.Service` expects a record-shaped implementation (a "service" with methods/fields). For primitive values like a single `string`, stay with `Context.Tag` + a hand-written Layer.

## Consumer side stays the same

The wiring at the program edge does not change conceptually:

```ts
// index.ts
const program = Effect.gen(function* () {
  const pokeApi = yield* PokeApi;
  return yield* pokeApi.getPokemon;
});

const runnable = program.pipe(Effect.provide(PokeApi.Default));
```

Because `PokeApi.Default` already contains the whole transitive graph (`PokemonCollection.Default`, `BuildPokeApiUrl.Default`, and inside the latter — `PokeApiUrl.Live`), the program needs **one** provide call.

Compare to the pre-refactor `index.ts`, which had to compose four layers manually:

```ts
const MainLayer = Layer.mergeAll(
  PokeApi.Live,
  PokemonCollection.Live,
  BuildPokeApiUrl.Live,
  PokeApiUrl.Live,
);
program.pipe(Effect.provide(MainLayer));
```

That whole `mergeAll` block disappears once dependencies are declared at definition time.

## When to use which

Use **`Effect.Service`** when:

- The service is an **object with one or more methods**.
- You want a single declaration site that owns both the contract and the impl.
- You want dependencies declared inline.

Stay with **`Context.Tag` + manual Layer** when:

- The service is a **primitive value** (`string`, `number`, function, etc.) — `Effect.Service` won't take that shape.
- You need **multiple alternative Layers** for the same Tag (e.g. `Live`, `Mock`, `Test`) and want to manage them explicitly.
- You want **fine control** over how dependencies are composed (`Layer.provide` vs `Layer.provideMerge` vs `Layer.mergeAll`).

## Reminder: `Layer.provide` vs `Effect.provide`

`Effect.Service` does not change this distinction — it just removes some `Layer.provide` calls by inlining them into the `dependencies` field.

- **`Layer.provide`** — composes layers (still used implicitly by `dependencies`).
- **`Effect.provide`** — plugs the final layer into an `Effect` to make it runnable.

See [`effect-provide.md`](./effect-provide.md) for the full picture.
