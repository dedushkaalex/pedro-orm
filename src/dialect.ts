export type DbDialectId = "postgres" | "sqlite";

export interface Dialect {
  readonly id: DbDialectId;
  readonly placeholder: (n: number) => string;
  readonly quoteIdentifier: (name: string) => string;
  readonly mapColumnType: (sqlType: string, opts: { autoIncrement?: boolean }) => string;
  readonly supportsReturning: boolean;
}

export const PgDialect: Dialect = {
  id: "postgres",
  placeholder: (n) => `$${n}`,
  quoteIdentifier: (name) => `"${name.replace(/"/g, '""')}"`,
  mapColumnType: (t, { autoIncrement }) => {
    if (autoIncrement && t === "integer") return "BIGSERIAL";
    return (
      {
        integer: "INTEGER",
        real: "DOUBLE PRECISION",
        text: "TEXT",
        blob: "BYTEA",
        boolean: "BOOLEAN",
      }[t] ?? t.toUpperCase()
    );
  },
  supportsReturning: true,
};

export const SqliteDialect: Dialect = {
  id: "sqlite",
  placeholder: () => "?",
  quoteIdentifier: (name) => `"${name.replace(/"/g, '""')}"`,
  mapColumnType: (t, { autoIncrement }) => {
    if (autoIncrement && t === "integer") return "BIGSERIAL";
    return (
      {
        integer: "INTEGER",
        real: "REAL",
        text: "TEXT",
        blob: "BLOB",
        boolean: "INTEGER", // SQLite не имеет boolean: кодируем как INTEGER 0/1
      }[t] ?? t.toUpperCase()
    );
  },
  supportsReturning: true,
};
