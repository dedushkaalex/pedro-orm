import { Console, Effect } from "effect";
import { fn } from "../src/index.ts";

// Песочница для разработки библиотеки.
// Запуск: `pnpm play` (watch) или `pnpm play:once` (один прогон).

const program = Effect.gen(function* () {
  yield* Console.log(fn());
  yield* Console.log("Effect runtime ready");
});

Effect.runPromise(program);
