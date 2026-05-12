# Dialect — Low-Level Design

## Назначение

Описывает интерфейс `Dialect` и две его реализации — `PgDialect` и
`SqliteDialect`. Dialect отвечает за **SQL-уровневые** различия между
движками: плейсхолдеры, кавычки, маппинг типов колонок. Сам по себе
запросов не делает — это «справочник», к которому обращается бизнес-код
при сборке SQL.

См. также общую картину в
`docs/hld/01-architecture-overview.md#dialect`.

## Источник

- Файл: `src/dialect.ts:1`

## Публичный API

| Символ          | Тип                      | Назначение                       |
| --------------- | ------------------------ | -------------------------------- |
| `DbDialectId`   | `"postgres" \| "sqlite"` | Литеральный union идентификатора |
| `Dialect`       | `interface`              | Контракт диалекта                |
| `PgDialect`     | `Dialect`                | Реализация для Postgres / PGlite |
| `SqliteDialect` | `Dialect`                | Реализация для SQLite            |

## Структура `Dialect`

```ts
interface Dialect {
  readonly id: DbDialectId;
  readonly placeholder: (n: number) => string;
  readonly quoteIdentifier: (name: string) => string;
  readonly mapColumnType: (sqlType: string, opts: { autoIncrement?: boolean }) => string;
  readonly supportsReturning: boolean;
}
```

| Поле                                | Назначение                  | PG                                   | SQLite                   |
| ----------------------------------- | --------------------------- | ------------------------------------ | ------------------------ |
| `id`                                | литерал движка              | `"postgres"`                         | `"sqlite"`               |
| `placeholder(n)`                    | плейсхолдер параметра №`n`  | `$n`                                 | `?` (номер игнорируется) |
| `quoteIdentifier(name)`             | оборачивает имя             | `"name"` с экранированием `"` → `""` | то же самое              |
| `mapColumnType(t, {autoIncrement})` | имя типа для CREATE TABLE   | см. ниже                             | см. ниже                 |
| `supportsReturning`                 | поддерживает ли `RETURNING` | `true`                               | `true` (с 3.35+)         |

### Маппинг типов

Внутренний «алфавит» — `SqlType = "integer" \| "real" \| "text" \| "blob" \| "boolean"`
(объявлен в `src/schema/columns.ts:7`). Dialect переводит его в строку
движка:

| `SqlType`                       | PG                 | SQLite                       |
| ------------------------------- | ------------------ | ---------------------------- |
| `integer` (без `autoIncrement`) | `INTEGER`          | `INTEGER`                    |
| `integer` (с `autoIncrement`)   | `BIGSERIAL`        | `BIGSERIAL` (см. примечание) |
| `real`                          | `DOUBLE PRECISION` | `REAL`                       |
| `text`                          | `TEXT`             | `TEXT`                       |
| `blob`                          | `BYTEA`            | `BLOB`                       |
| `boolean`                       | `BOOLEAN`          | `INTEGER` (см. ниже)         |
| любой другой                    | `t.toUpperCase()`  | `t.toUpperCase()`            |

**Примечание о `BIGSERIAL` в SQLite**: SQLite не знает такого типа.
Это известная неточность текущей реализации — `mapColumnType` для
SQLite возвращает `BIGSERIAL` при `autoIncrement === true`, но
канонически в SQLite используется `INTEGER PRIMARY KEY AUTOINCREMENT`.
В живом примере `playground/lesson-1.ts` обход выполнен на стороне
бизнес-кода: SQL для CREATE TABLE строится через ветвление по
`db.dialect.id`, минуя `mapColumnType`.

## Нетривиальные решения

### `placeholder` принимает номер, но SQLite его игнорирует

Сигнатура общая, чтобы вызывающий код был одинаковым:

```ts
const ph = (n: number) => db.dialect.placeholder(n);
sql += ` VALUES (${ph(1)}, ${ph(2)}, ${ph(3)})`;
```

На PG получится `$1, $2, $3`, на SQLite — `?, ?, ?`. Это допустимо,
потому что в SQLite **позиционные параметры** работают по порядку
появления в строке, и номер на стороне SQL-текста не нужен.

### Экранирование `"` через `"".replace(/"/g, '""')`

Стандартный SQL-приём двойного экранирования. Защищает от инъекции
через имя таблицы. Тот же приём в обоих диалектах.

### `boolean` → `INTEGER` только на уровне dialect

`Dialect` отвечает за **строку типа в CREATE TABLE**. Кодирование
значений (`true → 1`) живёт в codec-слое — см. `docs/lld/codec.md`. Без
codec булевы значения улетели бы в SQLite как JS-`true`, что
better-sqlite3 биндит как `1`, но без явного контракта.

## Граничные случаи

- Идентификатор с двойной кавычкой: `quoteIdentifier('weird"name')` →
  `"weird""name"`. SQL-стандарт.
- `mapColumnType("uuid", {})` — `"uuid".toUpperCase()` → `"UUID"`.
  Сработает на PG, не сработает на SQLite (нет такого типа). Это не
  ошибка диалекта — вызывающий код должен знать, что использует
  движково-специфичный тип.

## Ограничения

- Нет понятия квалифицированного идентификатора (`schema.table`).
- Нет экранирования значений — это работа драйвера (через параметры).
- Нет диалектных функций (например, форматирование дат).

## См. также

- LLD: `docs/lld/codec.md` (различие dialect / codec)
- LLD: `docs/lld/driver-runtime.md` (кто читает `dialect`)
- HLD: `docs/hld/01-architecture-overview.md#dialect`
