import { describe, expect, it } from "vite-plus/test";
import { PgDialect, SqliteDialect } from "../src/dialect.ts";

describe("dialect.mapColumnType", () => {
  it("varchar(n) рендерится с длиной в обоих диалектах", () => {
    expect(PgDialect.mapColumnType("varchar", { length: 255 })).toBe("VARCHAR(255)");
    expect(SqliteDialect.mapColumnType("varchar", { length: 32 })).toBe("VARCHAR(32)");
  });

  it("varchar без length — голый VARCHAR (fallback)", () => {
    expect(PgDialect.mapColumnType("varchar", {})).toBe("VARCHAR");
    expect(SqliteDialect.mapColumnType("varchar", {})).toBe("VARCHAR");
  });

  it("стандартные типы маппятся по диалекту", () => {
    expect(PgDialect.mapColumnType("integer", {})).toBe("INTEGER");
    expect(PgDialect.mapColumnType("real", {})).toBe("DOUBLE PRECISION");
    expect(PgDialect.mapColumnType("boolean", {})).toBe("BOOLEAN");
    expect(SqliteDialect.mapColumnType("real", {})).toBe("REAL");
    expect(SqliteDialect.mapColumnType("boolean", {})).toBe("INTEGER");
  });

  it("autoIncrement + integer → BIGSERIAL", () => {
    expect(PgDialect.mapColumnType("integer", { autoIncrement: true })).toBe("BIGSERIAL");
    expect(SqliteDialect.mapColumnType("integer", { autoIncrement: true })).toBe("BIGSERIAL");
  });
});
