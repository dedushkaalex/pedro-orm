# `Effect.provide` — wiring a Layer into a program

> ## ⚠️ `Layer.provide` and `Effect.provide` are two different APIs
>
> They share the word "provide" but they live at different levels — do **not** treat them as the same thing.
>
> - **`Layer.provide`** is used **when composing layers**. It takes one layer and feeds another into it.
>   Signature shape: `Layer.provide(self: Layer, that: Layer) → Layer`.
> - **`Effect.provide`** is used **when providing the final layer to run an Effect**.
>   It plugs a layer into a program to close its `R` channel.
>   Signature shape: `Effect.provide(self: Effect, layer: Layer) → Effect`.
>
> Rule of thumb: if both operands are layers, you want `Layer.provide`. If one operand is an `Effect` (a program), you want `Effect.provide`.

---

Think of `Effect.provide` as **plugging an extension cord into the wall**:

- An `Effect` has **holes** (its `R` channel) — services it depends on.
- A `Layer` has **ready implementations** (its `ROut`).
- `Effect.provide` takes those implementations and **fills the holes** in the Effect.

## Type-level behavior

```
Effect<A, E,  R>           ←  program needs services R
                Layer<RIn, E', ROut>   ←  layer provides ROut, but needs RIn
────────────────────────────────────
Effect<A, E | E', (R \ ROut) | RIn>
```

In words:

- `ROut` is **subtracted** from the program's `R` (those needs are now satisfied).
- `RIn` is **added** to the program's `R` (the layer itself has dependencies).
- The layer's error channel is **unioned** with the program's.

Once `R` becomes `never`, the program is runnable via `runPromise` / `runSync` / `runFork`.

## Worked example

```ts
// 1. program — has several "holes"
const program = Effect.gen(function* () {
  const pokeApi = yield* PokeApi; // hole: PokeApi
  return yield* pokeApi.getPokemon; // inside: PokemonCollection | BuildPokeApiUrl
});
// approximate type:
// Effect<Pokemon, FetchError | JsonError | ParseError,
//        PokeApi | PokemonCollection | BuildPokeApiUrl>
```

```ts
// 2. MainLayer — a big "power strip" with all the outlets
const MainLayer = Layer.mergeAll(
  PokeApi.Live,
  PokemonCollection.Live,
  BuildPokeApiUrl.Live,
  PokeApiUrl.Live,
);
// Layer<never, never, PokeApi | PokemonCollection | BuildPokeApiUrl | PokeApiUrl>
```

```ts
// 3. provide — plug the strip into the program
const runnable = program.pipe(Effect.provide(MainLayer));
// Effect<Pokemon, FetchError | JsonError | ParseError, never>
//                                                       ↑
//                                              all holes filled — ready to run

Effect.runPromise(runnable);
```

After `Effect.provide`:

- `PokeApi`, `PokemonCollection`, `BuildPokeApiUrl` are removed from `R` (provided by the layer).
- `PokeApiUrl` was never in the program's `R` directly — it was an internal need of `BuildPokeApiUrl.Live`, and the layer wires it up inside.

## How it fits with the other composition operations

| Operation               | Operands           | What it does                                           |
| ----------------------- | ------------------ | ------------------------------------------------------ |
| `Layer.mergeAll(a, b)`  | `Layer` ↔ `Layer`  | Glues two layers into one (horizontal union).          |
| `Layer.provide(a, b)`   | `Layer` ↔ `Layer`  | `b` feeds `a`; `b` is hidden inside the result.        |
| `Effect.provide(layer)` | `Effect` ↔ `Layer` | Feeds the **program** with a layer — closes its holes. |

Mental model: the `Layer.*` operators **build a dependency graph**, and `Effect.provide` is the **final step** that connects that graph to the program.

## Analogy with a classic DI container

Classic DI:

```ts
const container = new Container();
container.bind(PokeApi).toSelf();
container.bind(PokemonCollection).toSelf();
// ...
const api = container.get(PokeApi);
api.getPokemon();
```

Effect version, but **type-checked**:

```ts
const MainLayer = Layer.mergeAll(...)         // the bindings
program.pipe(Effect.provide(MainLayer))       // construction + wiring
```

Forget to bind a service and the compiler refuses: "`R` is not yet `never`, you can't run this." That is the main payoff — **DI with no runtime surprises**.
