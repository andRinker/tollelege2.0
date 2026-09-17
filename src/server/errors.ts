/** Errors thrown by the data layer. Their messages are safe to show to teachers. */
export class NotFoundError extends Error {
  constructor(message = "That item doesn't exist or isn't in your account.") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export class LimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LimitError";
  }
}

export function isUserFacingError(error: unknown): error is NotFoundError | ConflictError | LimitError {
  return error instanceof NotFoundError || error instanceof ConflictError || error instanceof LimitError;
}

/** Postgres unique_violation, optionally for a specific constraint or index. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  const pgError = cause as { code?: string; constraint?: string; message?: string };
  if (pgError?.code !== "23505") return false;
  if (!constraint) return true;
  return pgError.constraint === constraint || Boolean(pgError.message?.includes(constraint));
}
