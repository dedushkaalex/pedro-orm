# Errors — Low-Level Design

## Назначение

Описывает иерархию доменных ошибок драйверного слоя. Все ошибки
объявлены как Effect `TaggedError` — это значения, которые попадают в
канал ошибок `Effect<A, E, R>` и могут быть точечно обработаны через
`Effect.catchTag`.

См. также общую картину в
`docs/hld/01-architecture-overview.md#errors`.

## Источник

- Файл: `src/errors.ts:1`

## Публичный API

| Класс                      | Поля                       | Когда выбрасывается                          |
| -------------------------- | -------------------------- | -------------------------------------------- |
| `DbError`                  | `cause`, `sql`, `params`   | Любое непредвиденное исключение драйвера     |
| `NotFoundError`            | `sql`                      | (Резерв) запрос ожидал ≥ 1 строки, вернул 0  |
| `TooManyError`             | `sql`, `count`             | (Резерв) запрос ожидал 1 строку, вернул > 1  |
| `UniqueViolationError`     | `constraint`, `sql`        | PG `23505` / SQLite UNIQUE/PK                |
| `ForeignKeyViolationError` | `constraint`, `sql`        | PG `23503` / SQLite FK                       |
| `StatementTimeoutError`    | `sql`, `timeoutMs`         | (Резерв) превышен лимит времени запроса      |
| `CodecError`               | `column`, `value`, `cause` | (Резерв) сбой `encode`/`decode` в codec-слое |

| Тип           | Состав                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `DriverError` | `DbError \| UniqueViolationError \| ForeignKeyViolationError \| StatementTimeoutError \| CodecError` |

«Резерв» означает, что класс объявлен, но в текущем коде не
выбрасывается — ждёт реализации более высоких слоёв (single-row
helpers, statement timeouts, codec wiring).

## Анатомия `TaggedError`

```ts
export class DbError extends Data.TaggedError("DbError")<{
  readonly cause: unknown;
  readonly sql: string;
  readonly params: ReadonlyArray<unknown>;
}> {}
```

`Data.TaggedError(name)` возвращает базовый класс, в который
встроены:

- свойство `_tag` с литеральным значением (`"DbError"`),
- конструктор от объекта с полями,
- равенство по структуре (через `Data`),
- интеграция с `Effect.catchTag` и `Effect.matchTag`.

Поведенчески это аналог дискриминированного union-а из «голого» TS, но
встроенный в рантайм Effect.

## Использование

### В драйвере

`mapPgError` (`src/drivers/pglite.ts:35`) и `mapSqliteError`
(`src/drivers/sqlite.ts:57`) — это «адаптеры» от исключений конкретных
библиотек к доменным ошибкам. См. таблицу маппинга в
`docs/lld/driver-runtime.md#режимы-отказа`.

### В бизнес-коде

```ts
program.pipe(
  Effect.catchTag("UniqueViolationError", (e) =>
    Effect.logWarning(`User already exists: ${e.constraint}`),
  ),
);
```

`catchTag` сам сужает тип `e` до конкретного класса. Остальные ветки
`DriverError` останутся в канале ошибок.

## Нетривиальные решения

### `constraint` извлекается строкой, а не из структуры

Ни PGlite, ни better-sqlite3 не отдают имя нарушенного ограничения как
структурное поле. Поэтому маппер сначала пробует
`error.constraint`, потом регулярку по сообщению, и в самом крайнем
случае подставляет `"unknown"`. Это компромисс «лучше неточное, чем
никакое»: для UI и логов имя ограничения важно.

### Поле `cause` имеет тип `unknown`, не `Error`

Драйвера могут бросать что угодно — не обязательно `Error`. `unknown`
честнее отражает реальность; разбирать `cause` бизнес-коду обычно не
нужно, для логики хватает `_tag`.

### Почему `NotFoundError` / `TooManyError` лежат рядом, но не в `DriverError`

Они появятся, когда будут реализованы хелперы вроде `findOne` /
`findExactlyOne`. Это **запрос-уровневая семантика**, не драйверная,
поэтому в `DriverError` они не включены. Объявление рядом — чтобы
один импорт давал весь спектр доменных ошибок ORM.

### `StatementTimeoutError` отдельно от `DbError`

Таймауты не обязательно бывают «фатальными» для приложения — иногда
их хочется ретраить, в отличие от `DbError`. Поэтому отдельный тег.

## Граничные случаи

- **PG возвращает ошибку без `code`**: маппер падает в `DbError`. Не
  пропадёт — `cause` будет содержать исходное исключение.
- **SQLite UNIQUE без понятного сообщения**: regex не сматчился, поле
  `constraint` будет `"unknown"`.
- **Cause-объект не сериализуем**: при логировании `Effect.log(err)`
  превратит его в строку через стандартный `inspect`. Никаких
  «выбросит при логировании» сценариев.

## Ограничения

- Ошибки сети (PG over TCP) — на сегодня неактуальны, потому что
  используется встроенный PGlite. Если переедем на сетевой PG, в
  union понадобится добавить `ConnectionError`.
- Нет общего «retryable / non-retryable» флага. Бизнес-код судит по
  тегу.

## См. также

- LLD: `docs/lld/driver-runtime.md` — где и как мапятся ошибки
- HLD: `docs/hld/01-architecture-overview.md#errors`
- Пример: `playground/lesson-1.ts` (`Effect.catchTag("UniqueViolationError", …)`)
