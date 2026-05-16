import { Duration, Effect, Layer, Metric, MetricBoundaries, Ref } from "effect";
import { Driver } from "./driver.ts";

export const queryCount = Metric.counter("db.queries.total").pipe(Metric.withConstantInput(1));

export const queryDuration = Metric.histogram(
  "db.query.duration_ms",
  MetricBoundaries.fromIterable([1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000]),
);

// Gauge в Effect — абсолютное значение, поэтому держим текущий in-flight в Ref
// и на каждой границе пишем актуальное число в метрику.
export const connectionsActive = Metric.gauge("db.connections.active");

export const MetricsLayer = Layer.effect(
  Driver,
  Effect.gen(function* () {
    const inner = yield* Driver;
    const inFlightRef = yield* Ref.make(0);

    const increment = Ref.updateAndGet(inFlightRef, (n) => n + 1).pipe(
      Effect.flatMap((n) => connectionsActive(Effect.succeed(n))),
    );
    const decrement = Ref.updateAndGet(inFlightRef, (n) => n - 1).pipe(
      Effect.flatMap((n) => connectionsActive(Effect.succeed(n))),
    );

    return Driver.of({
      dialect: inner.dialect,
      executeRaw: (sql, params) => {
        const op = sql.trim().split(/\s+/)[0]?.toUpperCase() ?? "UNKNOWN";
        const tagged = queryCount.pipe(
          Metric.tagged("op", op),
          Metric.tagged("dialect", inner.dialect.id),
        );

        return Effect.acquireUseRelease(
          increment,
          () =>
            inner.executeRaw(sql, params).pipe(
              Effect.timed,
              Effect.tap(([d]) => queryDuration(Effect.succeed(Duration.toMillis(d)))),
              Effect.map(([, r]) => r),
              tagged,
            ),
          () => decrement,
        );
      },
    });
  }),
);
