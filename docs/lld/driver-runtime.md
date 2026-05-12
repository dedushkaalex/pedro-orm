# Driver Runtime — Low-Level Design

## Назначение

Документ описывает рантайм-слой работы с БД: контракт `Driver`, его
концретные реализации для PGlite и SQLite, и middleware-слой
трассировки. Это «как именно» для архитектурного блока, описанного в
`docs/hld/01-architecture-overview.md#driver`.

## Источники

- Точка входа: `src/driver.ts:1`
- Ключевые файлы:
  - `src/driver.ts` — Tag и интерфейс `DriverImpl`
  - `src/driver-tracing.ts` — Layer для добавления span'ов
  - `src/drivers/pglite.ts` — реализация поверх `@electric-sql/pglite`
  - `src/drivers/sqlite.ts` — реализация поверх `better-sqlite3`

## Публичный API

### Из `driver.ts`

| Символ             | Тип           | Назначение                                             |
| ------------------ | ------------- | ------------------------------------------------------ |
| `RawResult`        | `interface`   | Унифицированный результат запроса                      |
| `DriverImpl`       | `interface`   | Контракт драйвера (`dialect`, `executeRaw`)            |
| `DriverDependency` | `Context.Tag` | Тег для DI: бизнес-код пишет `yield* DriverDependency` |

### Из `driver-tracing.ts`

| Символ         | Назначение                                                                          |
| -------------- | ----------------------------------------------------------------------------------- |
| `TracingLayer` | Layer, требующий и отдающий `DriverDependency`, добавляет `withSpan("db.query", …)` |

### Из `drivers/pglite.ts`

| Символ            | Сигнатура                                              | Назначение                   |
| ----------------- | ------------------------------------------------------ | ---------------------------- |
| `layer(options?)` | `(options?: PGliteOptions) => Layer<DriverDependency>` | Конструктор Layer для PGlite |

### Из `drivers/sqlite.ts`

| Символ           | Сигнатура                                             | Назначение                                |
| ---------------- | ----------------------------------------------------- | ----------------------------------------- |
| `SqliteOptions`  | `interface`                                           | `{ path, readonly?, enableForeignKeys? }` |
| `layer(options)` | `(options: SqliteOptions) => Layer<DriverDependency>` | Конструктор Layer для SQLite              |

## Структуры данных

### `RawResult` (`src/driver.ts:8`)

```ts
interface RawResult {
  readonly rows: ReadonlyArray<Record<string, unknown>>;
  readonly affectedRows: number;
  readonly lastInsertRowId?: number | bigint;
}
```

- `rows` — для `SELECT … RETURNING` и подобных. Для не-читающих
  запросов — пустой массив.
- `affectedRows` — число изменённых/удалённых/вставленных строк.
- `lastInsertRowId` — только для SQLite, для запросов через `.run(…)`
  без `RETURNING`. В PG отсутствует.

### `DriverImpl` (`src/driver.ts:14`)

```ts
interface DriverImpl {
  readonly dialect: Dialect;
  readonly executeRaw: (
    sql: string,
    params: ReadonlyArray<unknown>,
  ) => Effect.Effect<RawResult, DriverError>;
}
```

`executeRaw` не зависит ни от какой контекстной зависимости в типе
(`R = never`). Это значит: всё, что нужно драйверу — соединение, dialect
— он замкнул на себя при создании слоя.

## Внутренний поток

### Открытие соединения (PGlite)

`src/drivers/pglite.ts:14`:

1. `Effect.acquireRelease(open, close)` регистрирует пару
   «открыть/закрыть» в текущем `Scope`.
2. `open` — `Effect.tryPromise({ try: () => PGlite.create(options) })`,
   преобразуя возможный reject в `DbError({ sql: "<connect>" })`.
3. `close` — `Effect.promise(() => instance.close())`. Промис близкого
   соединения не должен фейлиться, поэтому именно `promise`, не
   `tryPromise`.
4. Полученный `pg` замыкается в возвращаемом `DriverImpl.executeRaw`.

### Открытие соединения (SQLite)

`src/drivers/sqlite.ts:25`:

1. `Effect.acquireRelease(open, close)`, аналогично PGlite, но через
   `Effect.try` / `Effect.sync` — `better-sqlite3` синхронный.
2. После создания инстанса вызывается
   `instance.pragma("foreign_keys = ON")`, если `enableForeignKeys`
   не выставлен в `false` явно.

> Pragma включается каждый раз при открытии: в SQLite FK по умолчанию
> выключены, и забыть про это — типовая ошибка, ломающая каскады.

### Выполнение запроса (PGlite)

`src/drivers/pglite.ts:25`:

1. `Effect.tryPromise({ try: () => pg.query(sql, params), catch: mapPgError })`.
2. `Effect.map`: формируем `RawResult` из `r.rows` и `r.affectedRows`.

### Выполнение запроса (SQLite)

`src/drivers/sqlite.ts:40`:

1. `Effect.try({ try, catch: mapSqliteError })`.
2. Внутри `try`:
   - готовится `stmt = db.prepare(sql)`;
   - если `stmt.reader === true` (SELECT-подобный) — вызывается
     `stmt.all(...params)`, возвращается `{ rows, affectedRows: 0 }`;
   - иначе — `stmt.run(...params)`, возвращается `{ rows: [],
affectedRows: info.changes, lastInsertRowId: info.lastInsertRowid }`.

Различение «читающий/пишущий» по `stmt.reader` — потому что
`better-sqlite3` падает, если вызвать `.all()` на UPDATE/INSERT без
`RETURNING`.

### Трассировка

`src/driver-tracing.ts:5`:

1. `Layer.effect(DriverDependency, …)` — слой собирается через
   эффект.
2. Внутри эффекта `inner = yield* DriverDependency` — получаем
   «нижний» драйвер из контекста. Контекстом его обеспечит
   `Layer.provide(...)` снаружи.
3. Возвращаем новый `DriverImpl`, у которого `executeRaw` оборачивает
   вызов `inner.executeRaw`:
   - `Effect.withSpan("db.query", { attributes })` — открывает span с
     атрибутами `db.system`, `db.statement`, `db.params.count`;
   - `Effect.tap(r => Effect.annotateCurrentSpan(...))` — добавляет
     `db.rows.returned`, `db.rows.affected` на выходе.

`dialect` пробрасывается из `inner` без изменений.

## Нетривиальные технические решения

### Почему `executeRaw` не принимает Span-контекст вручную

Трассировка пристёгивается **слоем**. Бизнес-код не знает, что
запросы трассируются; concrete-драйверы не знают, что их обернули.
Это даёт право включать и выключать трассировку в одной точке сборки.

### Почему слои возвращают, а не получают, соединение

В Effect-TS «время жизни ресурса = время жизни Scope». Поэтому
драйвер не принимает уже-открытый клиент: он сам открывает его внутри
`Layer.scoped`. Иначе пришлось бы вручную следить, кто и когда
закрывает соединение.

### `Effect.try` vs `Effect.tryPromise`

- PGlite асинхронный — `tryPromise`.
- better-sqlite3 синхронный — `try`.

Использовать «промисную» обёртку поверх синхронного кода технически
можно, но это лишняя микрозадача в event-loop. Симметричный выбор
сохраняет читаемость.

### Маппинг ошибок — в файле concrete-драйвера

Маппинг (`mapPgError`, `mapSqliteError`) живёт рядом с реализацией,
потому что коды и форматы сообщений — деталь конкретной библиотеки.
Общий тип результата маппинга — `DriverError`, см.
`docs/lld/errors.md`.

## Граничные случаи

- **Запрос упал во время `acquireRelease`-open**: ресурс не считается
  взятым, finalizer не вызовется, ошибка попадает в каналу ошибки.
- **Программа прервана между запросами**: Scope раскрутится, соединение
  закроется. Это и есть смысл `Layer.scoped`.
- **SQLite RETURNING**: `stmt.reader` определит, что это «читающий»
  запрос, и пойдёт через `.all(...)`. `affectedRows` останется `0`, что
  на сегодня соответствует контракту (`affectedRows` точен только для
  пишущих запросов без RETURNING).
- **PG отсутствие `affectedRows`** (например, для DDL): подставляем
  `0` через `r.affectedRows ?? 0`.

## Режимы отказа

| Исключение                                                         | Куда мапится                    | Где живёт логика               |
| ------------------------------------------------------------------ | ------------------------------- | ------------------------------ |
| Любое при connect                                                  | `DbError({ sql: "<connect>" })` | `acquire`-блок обоих драйверов |
| PG `code === "23505"`                                              | `UniqueViolationError`          | `mapPgError`                   |
| PG `code === "23503"`                                              | `ForeignKeyViolationError`      | `mapPgError`                   |
| Иное PG                                                            | `DbError`                       | `mapPgError`                   |
| SQLite `SQLITE_CONSTRAINT_UNIQUE` / `SQLITE_CONSTRAINT_PRIMARYKEY` | `UniqueViolationError`          | `mapSqliteError`               |
| SQLite `SQLITE_CONSTRAINT_FOREIGNKEY`                              | `ForeignKeyViolationError`      | `mapSqliteError`               |
| Иное SQLite                                                        | `DbError`                       | `mapSqliteError`               |

`constraint` в обоих случаях извлекается из текста сообщения, потому
что ни одна из используемых библиотек не отдаёт его как структурное
поле.

## Ограничения слоя

- Нет ретраев. Сетевая ошибка PGlite (которой на in-process PGlite,
  строго говоря, не бывает) превратится в `DbError` без повтора.
- Нет таймаутов. `StatementTimeoutError` объявлен в `errors.ts`, но
  пока никем не выбрасывается — резерв под будущую поддержку statement
  timeout-а на стороне PG.
- Нет батчинга. Каждый запрос — отдельный вызов в библиотеку.

## См. также

- HLD: `docs/hld/01-architecture-overview.md#driver`
- LLD: `docs/lld/dialect.md`, `docs/lld/codec.md`, `docs/lld/errors.md`
- Пример: `playground/lesson-1.ts`
