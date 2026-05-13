# Tag vs Layer — why `Layer.provide` takes `.Live`, not the class

## A Tag-class plays two roles

In Effect, a single `class extends Context.Tag(...)` definition wears two hats — and they are easy to confuse:

```ts
export class PokeApiUrl extends Context.Tag("PokeApiUrl")<PokeApiUrl, string>() {
  static readonly Live = Layer.succeed(this, "https://pokeapi.co/...");
}
```

| Symbol                          | Role                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `PokeApiUrl` (the class itself) | **Tag** — identifier / key for the service. Analogous to a `Symbol` or an abstract interface. Carries **no implementation**. |
| `PokeApiUrl.Live`               | **Layer** — a concrete implementation that knows how to construct the value for this key.                                    |

Two different things at two different levels:

- **Tag** = "there will be a socket of shape X" (the contract).
- **Layer** = "here is the wire that pushes current into that socket" (the implementation).

## Why `Layer.provide` requires a Layer

```ts
Layer.effect(BuildPokeApiUrl /* ... requires PokeApiUrl ... */).pipe(
  Layer.provide(PokeApiUrl.Live),
); // ← implementation, not the Tag
```

`Layer.provide` means **"feed this layer with dependencies"**. To feed something you need food, not the name of a dish. The class `PokeApiUrl` is just a label — it does not contain the logic that builds a `string` with the base URL. That logic lives in `PokeApiUrl.Live`.

If passing the class were allowed, Effect would need to find the implementation at runtime — exactly the kind of "magical DI container with runtime resolution" Effect deliberately avoids. Here every wire is explicit: you connect Tag → Layer yourself.

## Where you DO use the bare Tag

Two places:

### 1. Inside an Effect — to request the value by key

```ts
const pokeApiUrl = yield * PokeApiUrl; // Tag used as a "lookup"
```

This is the right place for the Tag: you say "give me whatever is bound under this key" without committing to a specific implementation. Which implementation actually shows up is decided by the Layer at wiring time.

### 2. When constructing a Layer — to say which key you are filling

```ts
Layer.succeed(PokeApiUrl, "https://...");
//            ↑ Tag (the key)    ↑ value (what to bind)
```

## Analogy with plain TS / classic DI

```ts
// Tag ≈ interface
interface PokeApiUrl { url: string }

// Layer ≈ concrete class / factory
class PokeApiUrlLive implements PokeApiUrl { url = "..." }

// "yield* Tag" ≈ depending by type
function build(api: PokeApiUrl) { ... }

// "Layer.provide(Live)" ≈ passing a concrete instance
build(new PokeApiUrlLive())
```

Nobody writes `build(PokeApiUrl)` passing the interface — that would be nonsense. Same here: `Layer.provide` needs `.Live`, not the class.

## What if you pass the class

The TypeScript compiler stops you:

```ts
Layer.provide(PokeApiUrl);
//             ^^^^^^^^^^
// Argument of type 'typeof PokeApiUrl' is not assignable to parameter
// of type 'Layer<...>'
```

A Tag is `Tag<Id, Service>`, not `Layer<...>`. Their types differ, so the compiler won't let you mis-wire.

---

## Short formula

> **Tag is a name. Layer is the supply. `provide` accepts the supply.**

Putting `.Live` as a static on the Tag class is a convention — it keeps the supply right next to the name. The Layer can also live in a separate file; semantically nothing changes.
