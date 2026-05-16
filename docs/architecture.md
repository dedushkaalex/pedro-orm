# Архитектурный обзор pedro-orm

> Живой документ. Обновляется по мере реализации модулей. Каждый раздел
> «Что готово» отвечает на два вопроса: **что сделано** и **зачем это нужно**.

## 1. Назначение проекта

`pedro-orm` — учебный типизированный ORM для TypeScript, построенный на
[Effect](https://effect.website). Цель — показать в коде, **из каких слоёв
состоит настоящий ORM**, и одновременно получить рабочий тонкий слой над
SQL c поддержкой двух движков:

- **PostgreSQL** через `@electric-sql/pglite` (in-process Postgres на WASM);
- **SQLite** через `better-sqlite3` (синхронный нативный binding).

Идеологически ORM ближе к Drizzle/Kysely (тонкий типизированный билдер),
чем к Prisma/TypeORM (тяжёлый рантайм + кодогенерация). Никакой Identity
Map, никакого lazy-loading, никакой магии — каждый слой можно прочитать
и понять за один присест.

## 2. Путь запроса: от пользовательского кода до БД

Это та самая «лестница трансформаций», ради которой ORM вообще
существует. Сейчас целиком пройдена только её нижняя половина (driver +
dialect + codec), верхняя (query builder + AST + result mapper) — задел
на будущие итерации.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Пользовательский код на TypeScript                                  │
│     db.users.where({ active: true }).select()      ← ещё нет         │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Query Builder (планируется)                                         │
│     fluent API → AST { table, columns, where, params }               │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Compiler / Dialect          ← src/dialect.ts (готово частично)      │
│     AST + Dialect → { sql, params }                                  │
│     знает про $1/$? плейсхолдеры и про "quoted" идентификаторы       │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Codec слой                  ← src/codec.ts (готово)                 │
│     TS-значение  → SQL-значение  (encode перед отправкой)            │
│     SQL-значение → TS-значение   (decode при чтении)                 │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Driver (Effect Context)     ← src/driver.ts + src/drivers/*         │
│     executeRaw(sql, params): Effect<RawResult, DriverError>          │
│     инкапсулирует пул соединений и маппинг ошибок                    │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Подложка: PGlite / better-sqlite3                                   │
│     wire-протокол → СУБД → план → execution → строки                 │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Result Mapper (планируется)                                         │
│     RawResult.rows + Schema → типизированный массив                  │
│     применение Codec.decode по каждой колонке                        │
└──────────────────────────────────────────────────────────────────────┘
```

## 3. Карта модулей

```
src/
├── driver.ts            — контракт драйвера (Effect Tag + интерфейс)
├── driver-tracing.ts    — Layer, оборачивающий драйвер OTEL-спанами
├── drivers/
│   ├── pglite.ts        — реализация драйвера поверх PGlite
│   └── sqlite.ts        — реализация драйвера поверх better-sqlite3
├── dialect.ts           — PgDialect / SqliteDialect (плейсхолдеры, типы)
├── codec.ts             — encode/decode для boolean / date / json / bigint
├── errors.ts            — tagged-ошибки уровня домена БД
├── schema/
│   ├── columns.ts       — DSL колонок: integer/text/.../nullable/primaryKey
│   ├── table.ts         — описание таблицы как объекта { _name, _columns }
│   └── infer.ts         — type-level вывод InferRow / InferInsert
└── index.ts             — публичный barrel (пока заглушка)
```

## 4. Что готово

### 4.1 Driver: контракт и DI через Effect

#### Какую роль играет драйвер

Драйвер — это **самая нижняя граница** ORM перед реальной СУБД. Всё,
что выше (query builder, codec, result mapper), работает с типами и
объектами; всё, что ниже (PGlite, better-sqlite3, в будущем `pg`/`mysql2`),
работает с байтами по wire-протоколу. Драйвер — единственное место, где
эти два мира встречаются.

Его задачи строго ограничены:

1. **Владеть соединением.** Открыть его при создании, закрыть при
   завершении `Scope`. Бизнес-код не должен знать, есть ли пул, один ли
   это коннект или WASM-инстанс.
2. **Принять готовый SQL и параметры.** Драйвер ничего не строит и не
   парсит — он получает `string` и массив значений, которые ему дал
   компилятор выше.
3. **Выполнить запрос на конкретной подложке.** Здесь живёт вся
   «нативная» специфика: вызов `pg.query()` у PGlite, `stmt.all()` или
   `stmt.run()` у better-sqlite3.
4. **Перевести ошибки СУБД в общий язык домена.** Низкоуровневый
   `error.code === "23505"` превращается в `UniqueViolationError` —
   таким, какой ловит бизнес-код.
5. **Сообщить, в каком диалекте он работает.** Через поле `dialect`
   слой выше узнаёт, какие плейсхолдеры использовать и как
   квотировать идентификаторы.

#### Контракт `DriverImpl`

```ts
interface DriverImpl {
  readonly dialect: Dialect;
  readonly executeRaw: (
    sql: string,
    params: ReadonlyArray<unknown>,
  ) => Effect.Effect<RawResult, DriverError>;
}
```

**Поле `dialect: Dialect`.** Это **read-only метаданные** про
подключение, а не функция. Хранится прямо в драйвере, потому что
именно драйвер знает, к какой СУБД он подключён. Используется выше
по стеку:

- query builder спрашивает `dialect.placeholder(n)`, чтобы
  превратить `eq(users.id, 42)` в `"id" = $1` или `"id" = ?`;
- compiler спрашивает `dialect.quoteIdentifier("user")`, чтобы не
  сломаться на ключевых словах;
- DDL-генератор спрашивает `dialect.mapColumnType("boolean", …)`,
  чтобы в SQLite получилось `INTEGER`, а в PG — `BOOLEAN`;
- codec'ы спрашивают `dialect.id`, чтобы выбрать
  passthrough или конвертацию.

**Метод `executeRaw(sql, params)`.** Единственная исполняемая операция
драйвера. Намеренно «глупый»: принимает уже готовую строку и значения,
не пытается их интерпретировать. Что с ним происходит:

| Шаг                          | Что делает                                                             |
| ---------------------------- | ---------------------------------------------------------------------- |
| 1. Получает `sql` + `params` | от compiler'а (или прямо от пользователя в `executeRaw` для миграций)  |
| 2. Готовит statement         | у SQLite это `db.prepare(sql)`, у PG — внутреннее prepared-кэширование |
| 3. Выполняет                 | `stmt.all()` / `stmt.run()` для SQLite; `pg.query()` для PGlite        |
| 4. Маппит результат          | приводит к единой форме `RawResult`                                    |
| 5. Маппит ошибку             | переводит `error.code` подложки в `DriverError`                        |
| 6. Заворачивает в `Effect`   | вместо `throw` — `Effect.fail` с tagged-ошибкой                        |

Сигнатура `Effect<RawResult, DriverError>` означает: успех — `RawResult`,
ошибка — одна из tagged-ошибок (`DbError`, `UniqueViolationError`, …).
Это видно в типе вызывающего, и компилятор не даст пропустить обработку.

#### Форма ответа: `RawResult`

```ts
interface RawResult {
  readonly rows: ReadonlyArray<Record<string, unknown>>;
  readonly affectedRows: number;
  readonly lastInsertRowId?: number | bigint;
}
```

Эту форму драйвер возвращает **независимо от подложки**:

- `rows` — массив «сырых» записей `{ column: value, … }`. Здесь ещё
  нет ни типов из схемы, ни `Codec.decode` — это работа result mapper'а
  выше. Для `INSERT/UPDATE/DELETE` без `RETURNING` массив пустой.
- `affectedRows` — сколько строк затронуто. У SQLite берётся из
  `info.changes`, у PGlite — из ответа протокола.
- `lastInsertRowId` — опциональное поле, осмысленно только для SQLite
  с `INTEGER PRIMARY KEY`. В PG не используется (вместо него
  `RETURNING id`).

Бизнес-код почти никогда не работает с `RawResult` напрямую — он
получит уже типизированные `InferRow[]`. `RawResult` — это
«сырьё» для уровня выше.

#### DI через Effect Context

```
┌─────────────────────────┐       ┌───────────────────────────┐
│ DriverDependency (Tag)  │◄──────│ Любой бизнес-код          │
│  -> DriverImpl          │       │ yield* DriverDependency   │
└──────────┬──────────────┘       └───────────────────────────┘
           │ provide(Layer)
   ┌───────┴───────┐
   ▼               ▼
[ PGlite Layer ] [ SQLite Layer ]
```

`DriverDependency` — это `Context.Tag` из Effect: «именованный слот»,
который компилятор требует заполнить через `Layer.provide`. Бизнес-код
пишет `yield* DriverDependency` и получает `DriverImpl`, не зная,
какая именно реализация подставлена.

**Зачем именно так:**

- _Тест_: подставляем in-memory SQLite — `SqliteDriver.layer({ path: ":memory:" })`.
- _Прод_: подставляем PG — `PGliteDriver.layer({ … })`.
- _Декораторы_: оборачиваем существующий driver слоем `TracingLayer`
  (см. §4.6) — бизнес-код не меняется.
- _Безопасность по типам_: если забыть `provide`, программа не
  скомпилируется. Канал `R` в `Effect<R, E, A>` явно показывает
  «требует `DriverDependency`».

### 4.2 Драйверы: PGlite и SQLite

**Что**: две реализации `DriverImpl`, каждая в отдельном файле в
`src/drivers/`. Обе используют `Effect.acquireRelease`, чтобы соединение
гарантированно закрылось при выходе из `Scope`.

| Драйвер | Подложка               | Особенности                                            |
| ------- | ---------------------- | ------------------------------------------------------ |
| PGlite  | `@electric-sql/pglite` | WASM-Postgres, реальный wire-протокол PG               |
| SQLite  | `better-sqlite3`       | синхронный, нативный, `foreign_keys = ON` по умолчанию |

**Зачем**: PGlite позволяет писать и тестировать «честный» PG без
docker-compose, SQLite — самый быстрый способ держать примеры
self-contained. Оба драйвера покрывают разные диалекты, что задаёт
правильную нагрузку на абстракцию `Dialect`.

Маппинг ошибок: каждый драйвер ловит «свои» коды (`23505`, `23503` у PG;
`SQLITE_CONSTRAINT_UNIQUE`, `SQLITE_CONSTRAINT_FOREIGNKEY` у SQLite) и
переводит их в общие `UniqueViolationError` / `ForeignKeyViolationError`.
Это делает бизнес-логику переносимой: `Effect.catchTag("UniqueViolationError", …)`
работает одинаково на обоих движках.

### 4.3 Dialect: различия СУБД в одном месте

**Что**: интерфейс `Dialect` с четырьмя точками вариативности:

- `placeholder(n)` — `"$1"` для PG, `"?"` для SQLite;
- `quoteIdentifier(name)` — экранирование двойных кавычек;
- `mapColumnType(sqlType, opts)` — `integer` → `INTEGER` / `BIGSERIAL`,
  `boolean` → `BOOLEAN` / `INTEGER` (SQLite не имеет нативного boolean);
- `supportsReturning` — фича-флаг для `RETURNING *`.

**Зачем**: всё, что отличается между PG и SQLite на уровне SQL, собрано
в одну плоскую структуру. Когда понадобится MySQL, появится третий
объект `MysqlDialect`, а query builder останется неизменным.

### 4.4 Codec: значения на границе TS ↔ SQL

**Что**: пара `encode/decode` для типов, которые ведут себя по-разному
в разных СУБД:

| Codec          | PG                            | SQLite                  |
| -------------- | ----------------------------- | ----------------------- |
| `booleanCodec` | passthrough                   | `true ↔ 1`, `false ↔ 0` |
| `dateCodec`    | passthrough (нативный `Date`) | `Date ↔ ISO-string`     |
| `jsonCodec<T>` | passthrough (`jsonb`)         | `T ↔ JSON.stringify`    |
| `bigintCodec`  | `bigint ↔ string`             | то же                   |

**Зачем**: пользователь работает с одним и тем же TS-типом
(`boolean`, `Date`, объектом), а codec прячет физическое представление.
Без этого слоя пришлось бы либо протекать «SQLite-измом» в бизнес-код,
либо терять переносимость кода между движками.

### 4.5 Errors: tagged union вместо `throw`

**Что**: `Data.TaggedError` из Effect для всех ошибок уровня БД:

```
DriverError =
  | DbError                     — generic, всё что не распознано
  | UniqueViolationError        — нарушение UNIQUE / PK
  | ForeignKeyViolationError    — нарушение FK
  | StatementTimeoutError       — таймаут
  | CodecError                  — ошибка encode/decode

NotFoundError / TooManyError    — для будущего query-API
```

**Зачем**: ошибки видны в типе `Effect<R, E, A>`. Невозможно «забыть»
обработать unique violation — компилятор скажет, что `E` ещё содержит
`UniqueViolationError`. Это альтернатива `try/catch` с явной семантикой.

### 4.6 Tracing Layer: пример композиции драйверов

**Что**: `TracingLayer` — Layer, который **берёт существующий
`DriverDependency` и возвращает новый**, добавляющий
`Effect.withSpan("db.query", …)` вокруг каждого `executeRaw`.

```
[ TracingLayer ]
       ├── требует: DriverDependency (внутренний)
       └── даёт:    DriverDependency (с трассировкой)

provide: TracingLayer.pipe(Layer.provide(PGliteDriver.layer({})))
```

**Зачем**: иллюстрирует ключевую идею Effect Layers — **декораторы
зависимостей**. Тот же приём масштабируется до retry/circuit-breaker/
read-replicas/кэширования: каждый кросс-каттинг concern становится
отдельным Layer'ом, который ничего не знает о соседях.

### 4.7 Schema: type-level описание таблиц

**Что**: декларативный DSL.

```ts
const users = table("users", {
  id: primaryKey(integer()),
  name: text(),
  email: text(),
  age: nullable(integer()),
});

type User = InferRow<typeof users>;
//           ^ { id: number; name: string; email: string; age: number | null }

type NewUser = InferInsert<typeof users>;
//           ^ { name: string; email: string; age: number | null; id?: number }
```

Каждая колонка несёт три фантомных параметра типа:
`ColumnDef<SqlType, Nullable, PK>`. Модификаторы (`nullable`,
`primaryKey`) **сужают** этот тип, и `InferRow` / `InferInsert`
вычисляют итоговую форму строки на этапе компиляции.

**Зачем**: схема — это **единственный источник правды** для будущего
query-builder'а. Тот же объект `users` нужен и compiler'у (чтобы знать
имена колонок и их SQL-типы), и type-level inference'у (чтобы дать
автодополнение в IDE и поймать опечатки).

## 5. Что ещё впереди (roadmap)

```
[готово]   driver / dialect / codec / errors / schema / tracing
   │
   ▼
[следующее]  Migrations: TableDef → CREATE TABLE через Dialect.mapColumnType
   │
   ▼
[потом]      Query builder: select / where / insert / update / delete
   │           возвращает thenable Effect-объект с AST внутри
   ▼
[потом]      Compiler: AST + Dialect → { sql, params }
   │
   ▼
[потом]      Result mapper: rows + schema → InferRow[],
   │           прогон Codec.decode по каждой колонке
   ▼
[потом]      Transactions: Effect.acquireRelease + savepoints
   │
   ▼
[потом]      Relations / joins, prepared statements, real PG driver (pg)
```

## 6. Принципы, которые держим

1. **Тонкие слои.** Каждый файл < 100 строк, делает одно. Если слой
   разрастается — выделяем подмодуль.
2. **Никакой магии рантайма.** Никаких `Proxy`, никаких глобальных
   реестров. Всё, что видит пользователь, прямо отслеживается до
   функции в исходниках.
3. **Типы — это документация.** Если можно поймать ошибку компилятором,
   мы её ловим компилятором. Tagged errors + фантомные типы колонок —
   ровно для этого.
4. **Diff между диалектами локализуем.** Любое «PG умеет, SQLite нет»
   живёт в `dialect.ts` или `codec.ts`, а не растекается по бизнес-коду.
5. **DI через Effect Layers.** Driver, tracing, будущий cache — всё это
   слои, которые можно собирать в любом порядке.

## 7. Как поддерживать этот документ

- Каждый новый модуль → новый подраздел в §4 «Что готово».
- Если меняется граница между слоями → обновляем диаграмму в §2.
- Пункт в §5 переехал в §4 → удаляем его из roadmap.
- Принципы (§6) — append-only: если правило перестало работать,
  фиксируем это в ADR (`docs/adr/`), а не вычёркиваем молча.
