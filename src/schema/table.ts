import type { ColumnDef } from "./columns.ts";

export interface TableDef<Name extends string, Cols extends Record<string, ColumnDef>> {
  readonly _name: Name;
  readonly _columns: Cols;
}

export const table = <N extends string, C extends Record<string, ColumnDef>>(
  name: N,
  columns: C,
): TableDef<N, C> => ({ _name: name, _columns: columns });
