import { Data } from "effect";

export class DbError extends Data.TaggedError("DbError")<{
  readonly cause: unknown;
  readonly sql: string;
  readonly params: ReadonlyArray<unknown>;
}> {}

export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly sql: string;
}> {}

export class TooManyError extends Data.TaggedError("TooManyError")<{
  readonly sql: string;
  readonly count: number;
}> {}

export class UniqueViolationError extends Data.TaggedError("UniqueViolationError")<{
  readonly constraint: string;
  readonly sql: string;
}> {}

export class ForeignKeyViolationError extends Data.TaggedError("ForeignKeyViolationError")<{
  readonly constraint: string;
  readonly sql: string;
}> {}

export class CheckViolationError extends Data.TaggedError("CheckViolationError")<{
  readonly constraint: string;
  readonly sql: string;
}> {}

export class NotNullViolationError extends Data.TaggedError("NotNullViolationError")<{
  readonly column: string;
  readonly sql: string;
}> {}

export class StatementTimeoutError extends Data.TaggedError("StatementTimeoutError")<{
  readonly sql: string;
  readonly timeoutMs: number;
}> {}

export class CodecError extends Data.TaggedError("CodecError")<{
  readonly column: string;
  readonly value: unknown;
  readonly cause: unknown;
}> {}

export type DriverError =
  | DbError
  | UniqueViolationError
  | ForeignKeyViolationError
  | StatementTimeoutError
  | CodecError
  | NotNullViolationError
  | CheckViolationError;
