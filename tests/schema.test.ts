import { describe, expect, expectTypeOf, it } from "vite-plus/test";
import { integer, nullable, primaryKey, text, withDefault } from "../src/schema/columns.ts";
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
