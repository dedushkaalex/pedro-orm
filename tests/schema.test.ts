import { describe, expect, expectTypeOf, it } from "vite-plus/test";
import {
  integer,
  nullable,
  primaryKey,
  text,
  varchar,
  withDefault,
} from "../src/schema/columns.ts";
import { table } from "../src/schema/table.ts";
import type { InferInsert, InferRow } from "../src/schema/infer.ts";

const articles = table("articles", {
  id: primaryKey(integer()),
  title: text(),
  likes: withDefault(integer(), 0),
});

describe("E1.1", () => {
  it("runtime: _hasDefault = true, _default доступен", () => {
    expect(articles._columns.likes._default).toBe(0);
    expect(articles._columns.likes._hasDefault).toBe(true);
  });

  it("types: колонка с default опциональна в insert", () => {
    expectTypeOf<{ title: string }>().toExtend<InferInsert<typeof articles>>();
  });
});

// Пример из infer.ts: name: text("hello") — с дефолтом
const users = table("users", {
  id: primaryKey(integer(2)),
  name: text("hello"),
  email: text(),
  age: nullable(integer()),
});

describe("users example", () => {
  it("InferRow", () => {
    type Expected = {
      id: number;
      name: string;
      email: string;
      age: number | null;
    };
    expectTypeOf<InferRow<typeof users>>().toExtend<Expected>();
    expectTypeOf<Expected>().toExtend<InferRow<typeof users>>();
  });

  it("InferInsert: PK и колонки с default опциональны", () => {
    type Expected = {
      email: string;
      age: number | null;
      id?: number;
      name?: string;
    };
    expectTypeOf<InferInsert<typeof users>>().toExtend<Expected>();
    expectTypeOf<Expected>().toExtend<InferInsert<typeof users>>();
  });
});

// varchar(n) — TEXT с фиксированной длиной, хранится как literal type
const posts = table("posts", {
  id: primaryKey(integer()),
  title: varchar(255),
  body: varchar(1000),
});

describe("varchar", () => {
  it("runtime: _type = 'varchar', _varcharLength хранит n", () => {
    expect(posts._columns.title._type).toBe("varchar");
    expect(posts._columns.title._varcharLength).toBe(255);
    expect(posts._columns.body._varcharLength).toBe(1000);
  });

  it("runtime: _hasDefault = false по умолчанию", () => {
    expect(posts._columns.title._hasDefault).toBe(false);
  });

  it("types: длина сохраняется как literal через table()", () => {
    expectTypeOf<(typeof posts)["_columns"]["title"]["_varcharLength"]>().toExtend<
      255 | undefined
    >();
    expectTypeOf<(typeof posts)["_columns"]["body"]["_varcharLength"]>().toExtend<
      1000 | undefined
    >();
  });

  it("types: _type — литерал 'varchar'", () => {
    expectTypeOf<(typeof posts)["_columns"]["title"]["_type"]>().toExtend<"varchar">();
  });

  it("types: InferRow маппит varchar в string", () => {
    type Expected = { id: number; title: string; body: string };
    expectTypeOf<InferRow<typeof posts>>().toExtend<Expected>();
    expectTypeOf<Expected>().toExtend<InferRow<typeof posts>>();
  });

  it("types: InferInsert делает PK опциональным, varchar без default — required", () => {
    type Expected = { title: string; body: string; id?: number };
    expectTypeOf<InferInsert<typeof posts>>().toExtend<Expected>();
    expectTypeOf<Expected>().toExtend<InferInsert<typeof posts>>();
  });

  it("types: разные длины — разные literal-типы", () => {
    type TitleLen = (typeof posts)["_columns"]["title"]["_varcharLength"];
    type BodyLen = (typeof posts)["_columns"]["body"]["_varcharLength"];
    // 255 не extend 1000 и наоборот — длины различимы на уровне типов
    expectTypeOf<TitleLen>().not.toExtend<1000>();
    expectTypeOf<BodyLen>().not.toExtend<255>();
  });
});
