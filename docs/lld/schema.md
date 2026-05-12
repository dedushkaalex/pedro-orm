# Schema — Low-Level Design

## Назначение

Модуль `src/schema/` — фундамент ORM. Это **type-safe DSL** на чистом
TypeScript для описания таблиц. Описав таблицу один раз через `table(...)`,
разработчик автоматически получает два связанных типа:

- **тип строки таблицы** — форма объекта, который вернётся из
  `SELECT * FROM users` (все колонки, обязательные, с учётом nullable);
- **тип входа для `INSERT`** — форма объекта, который нужно передать в
  `INSERT INTO users` (PK с auto-increment опционален).

Оба типа **вычисляются из описания схемы во время компиляции** — без
дублирования, без ручной поддержки параллельных DTO. При изменении схемы
все производные типы обновляются автоматически, и десинхронный код
перестаёт компилироваться.

Runtime-поведения у модуля почти нет: фабрики собирают plain-объекты,
всё «умное» живёт в типах.

Слой нужен как единый источник истины: схема описывается один раз, и из неё
дальше будут выводиться SQL-генератор, query builder и типы driver-а.

## Концепция: type inference

В документе часто упоминаются «инференсер-типы» (`InferRow`, `InferInsert`,
`InferColumn`). Ниже — короткое определение, чтобы документ читался без
внешнего контекста.

**Type inference** в TypeScript — это автоматическое вычисление типа без
явной аннотации:

```ts
const x = 42; // TS выводит: x: number
function f() {
  return "hi";
} // TS выводит: () => string
```

Здесь компилятор работает на уровне **значений**: смотрит на правую часть
и подставляет тип.

В этом модуле inference используется ещё и **на уровне типов** — как
вычисление одного типа из другого. Такие «вычисляющие» типы условно
называем **инференсерами**:

```ts
type Row = InferRow<typeof users>;
//          ^^^^^^^^^^^^^^^^^^^^^
//          вход:  тип-дескриптор таблицы
//          выход: тип строки этой таблицы
```

Технически это обычные generic type aliases, реализованные через mapped
types (`{ [K in keyof T]: ... }`) и conditional types
(`X extends Y ? A : B`). Они существуют только в compile-time — в
скомпилированном JS их нет.

В ORM это даёт двухуровневую цепочку вывода:

```
1. table("users", { id: integer(), ... })
    → TS сам выводит typeof users = TableDef<"users", {...}>

2. InferRow<typeof users>
    → наш инференсер вычисляет { id: number; ... }
```

Шаг 1 — встроенный TS-inference. Шаг 2 — наш собственный, написанный как
type-level код. Оба называются «inference»: первый делает компилятор
автоматически, второй — наш модуль.

Практический смысл: схема — **единый источник истины**. Описав таблицу
один раз, разработчик получает все производные типы (`InferRow`,
`InferInsert`, в будущем `InferUpdate`, входы query builder-а и т.д.)
бесплатно и в синхроне со схемой.

## Источники

- Точка входа: `src/schema/columns.ts:1`, `src/schema/table.ts:1`,
  `src/schema/infer.ts:1`
- Ключевые файлы:
  - `src/schema/columns.ts` — типы и фабрики колонок
  - `src/schema/table.ts` — тип и фабрика таблицы
  - `src/schema/infer.ts` — type-level мэппинг схема → TS

## Публичный API

### Из `columns.ts`

| Символ                   | Сигнатура                                                       | Назначение               |
| ------------------------ | --------------------------------------------------------------- | ------------------------ |
| `SqlType`                | `"integer" \| "real" \| "text" \| "blob" \| "boolean"`          | Алфавит SQL-типов        |
| `ColumnDef<T, Null, PK>` | `interface`                                                     | Дескриптор одной колонки |
| `integer()`              | `() => ColumnDef<"integer", false, false>`                      | Фабрика int-колонки      |
| `real()`                 | `() => ColumnDef<"real", false, false>`                         | Фабрика real-колонки     |
| `text()`                 | `() => ColumnDef<"text", false, false>`                         | Фабрика text-колонки     |
| `boolean()`              | `() => ColumnDef<"boolean", false, false>`                      | Фабрика boolean-колонки  |
| `nullable(c)`            | `<T, PK>(c: ColumnDef<T, false, PK>) => ColumnDef<T, true, PK>` | Модификатор nullable     |
| `primaryKey(c)`          | `<T, N>(c: ColumnDef<T, N, false>) => ColumnDef<T, N, true>`    | Модификатор PK           |

### Из `table.ts`

| Символ                 | Сигнатура                                       | Назначение         |
| ---------------------- | ----------------------------------------------- | ------------------ |
| `TableDef<Name, Cols>` | `interface`                                     | Дескриптор таблицы |
| `table(name, cols)`    | `<N, C>(name: N, columns: C) => TableDef<N, C>` | Фабрика таблицы    |

### Из `infer.ts`

| Символ           | Назначение                                                          |
| ---------------- | ------------------------------------------------------------------- |
| `SqlToTs`        | Мэппинг `SqlType → TS` (`integer → number`, `blob → Uint8Array`, …) |
| `InferColumn<C>` | TS-тип одной колонки с учётом nullable                              |
| `InferRow<T>`    | Тип строки таблицы (для `SELECT`)                                   |
| `InferInsert<T>` | Тип входа для `INSERT` (PK становится опциональным)                 |

## Структуры данных

### `ColumnDef<T, Null, PK>`

Три type-level параметра трекаются на уровне типа, а не значения:

```ts
interface ColumnDef<
  T extends SqlType = SqlType,
  Null extends boolean = boolean,
  PK extends boolean = boolean,
> {
  readonly _type: T;
  readonly _nullable: Null;
  readonly _pk: PK;
  readonly _default?: unknown;
}
```

Соответствие runtime-полей и type-параметров 1-к-1: значение поля совпадает с
литералом дженерика. Это позволяет `InferColumn` через
`C["_nullable"] extends true` различать nullable и не-nullable колонки.

### `TableDef<Name, Cols>`

```ts
interface TableDef<Name extends string, Cols extends Record<string, ColumnDef>> {
  readonly _name: Name;
  readonly _columns: Cols;
}
```

`Name` сохраняется как литеральный тип имени таблицы, `Cols` — карта колонок,
где каждое значение — конкретный `ColumnDef<...>` с узкими параметрами.

## Внутренние потоки

### Сборка колонки

1. Пользователь вызывает фабрику, например `integer()`.
2. Фабрика возвращает объект с **узкими литеральными типами**:
   `ColumnDef<"integer", false, false>`.
3. Опционально применяется модификатор: `nullable(integer())` →
   `ColumnDef<"integer", true, false>`. Модификатор иммутабельно копирует
   объект и точечно меняет один параметр в типе.
4. `primaryKey(...)` симметрично переключает третий параметр.

Цепочки `primaryKey(nullable(...))` и `nullable(primaryKey(...))` работают
эквивалентно — у каждого модификатора в сигнатуре есть соответствующий
generic для «соседнего» параметра, который пробрасывается без изменений.

### Сборка таблицы

`table(name, cols)` принимает имя и карту колонок и возвращает `TableDef`.
Дженерики `<N extends string, C extends Record<string, ColumnDef>>` сохраняют
литеральные типы — без них `name: "users"` обрезался бы до `string`, а
`columns` — до базового `Record<string, ColumnDef>` без литеральных
параметров каждой колонки.

### Вывод `InferRow`

```ts
type InferRow<T extends TableDef<string, any>> = {
  [K in keyof T["_columns"]]: InferColumn<T["_columns"][K]>;
};
```

Mapped type над колонками таблицы. Для каждого ключа `K` подставляется
`InferColumn<...>`, который через conditional type выбирает между
`SqlToTs[T] | null` и `SqlToTs[T]`.

### Вывод `InferInsert`

Пересечение двух mapped types с key remapping (`as`):

```ts
type InferInsert<T extends TableDef<string, any>> =
  // 1. Не-PK колонки — обязательные
  {
    [K in keyof T["_columns"] as T["_columns"][K]["_pk"] extends true ? never : K]: InferColumn<
      T["_columns"][K]
    >;
  } & { // 2. PK-колонки — опциональные (модификатор `?`)
    [K in keyof T["_columns"] as T["_columns"][K]["_pk"] extends true ? K : never]?: InferColumn<
      T["_columns"][K]
    >;
  };
```

Семантика `as`-клозы: ключ `K` мапится на `never` → выбрасывается из
итогового типа. Поэтому первая половина оставляет всё кроме PK, вторая —
только PK. `&` склеивает их в один объект.

Назначение: при `INSERT` PK-колонка с auto-increment не нужна на входе.

## Нетривиальные технические решения

### Дефолты дженериков `ColumnDef` — `boolean`, не `false`

`src/schema/columns.ts:11-12`:

```ts
Null extends boolean = boolean,
PK extends boolean = boolean,
```

Изначально дефолты были `= false`. Это ломалось всюду, где `ColumnDef`
используется без параметров — в первую очередь в constraint
`Record<string, ColumnDef>` внутри `TableDef` и `table(...)`. TypeScript
подставлял дефолты и в constraint-позиции, превращая её в
`Record<string, ColumnDef<SqlType, false, false>>`, и любая колонка с
`_pk: true` или `_nullable: true` переставала проходить проверку.

Дефолт generic-параметра — это **буквальная подстановка**, не «гибкая
заглушка». Поэтому правило: дефолт должен быть **самым широким**
допустимым типом (равным constraint), а не самым частым конкретным
значением. Узкая литеральная форма остаётся в фабриках, где она реально
нужна для последующего инференса.

### Узкие возвраты фабрик

Фабрики возвращают `ColumnDef<"integer", false, false>`, а не просто
`ColumnDef`. Это критично: иначе `InferColumn` не сможет различить
nullable и не-nullable колонку через `extends true`, и `InferRow`
выродится в `Record<string, unknown | null>`. Узкие литералы — это
основной носитель информации в этом DSL.

### `boolean` в `SqlToTs`

`SqlToTs.boolean = boolean`. SQLite физически хранит boolean как `INTEGER 0/1`,
но на уровне типов мы оперируем удобной TS-формой. Преобразование
числовое ↔ boolean — задача driver-слоя; в схеме нет упоминаний о хранении.

### Имя фабрики `boolean` совпадает с примитивом

`src/schema/columns.ts:39` экспортирует фабрику с именем `boolean`. Это не
конфликтует с TS-типом `boolean` (типы и значения живут в разных
namespace), но при импорте `boolean` имя затеняет встроенный примитив в
текущем модуле. Внутри `columns.ts` примитив всё ещё используется в
constraint-ах дженериков (`Null extends boolean`), потому что там — type
position.

## Граничные случаи

| Случай                                 | Поведение                                                                                                                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nullable(primaryKey(integer()))`      | Не компилируется: `primaryKey` требует `PK extends false` на входе. Семантически правильно — PK не может быть nullable. Нужно строить как `primaryKey(nullable(integer()))`. |
| Двойное применение `primaryKey`        | Не компилируется по той же причине — `<T, N, false>` отвергает уже-PK колонку.                                                                                               |
| Двойное применение `nullable`          | То же — `<T, false, PK>` отвергает уже-nullable. Идемпотентность за счёт типа.                                                                                               |
| Колонка без явного `_default`          | Поле `_default?: unknown` — опциональное, отсутствие на runtime эквивалентно «нет дефолта». На type-level пока никак не используется.                                        |
| `InferInsert` на таблице без PK        | Вторая половина пересечения свернётся в `{}` (все ключи мапятся в `never`). Итог = только обязательные поля.                                                                 |
| Nullable не-PK колонка в `InferInsert` | Сейчас остаётся **обязательной** (`email: string \| null`). Опционализация nullable — пока не реализована.                                                                   |

## Ограничения текущего слоя

- Нет фабрики для типа `blob` (`SqlType` его содержит, но `blob()` не
  экспортируется).
- Нет setter-а для `_default`. Поле есть в интерфейсе, но никак не
  заполняется и не учитывается в `InferInsert`.
- Нет индексов, foreign keys, связей.
- Нет SQL-генерации (`CREATE TABLE`, типы → SQL-литералы).
- Нет query builder, driver, миграций — всё вне этого модуля.

## См. также

- Исходники: `src/schema/`
- Песочница: `src/schema/infer.ts:34-46` — пример сборки `users` и
  применения `InferRow` / `InferInsert`
