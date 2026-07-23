/**
 * A `Result<T, E>` makes failure part of a function's return type instead
 * of a side channel. The engine (see §2.5 of the build brief) never throws
 * for an *expected* failure — a dropped connection, a rejected endpoint, a
 * timeout — it returns `Err`. Throwing stays reserved for programmer error
 * (an invariant violated in our own code).
 */
export type Result<T, E> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: E }>;

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Readonly<{ ok: true; value: T }> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Readonly<{ ok: false; error: E }> {
  return !result.ok;
}

/** Unwraps a `Result`, throwing `error` (or a wrapping `Error`) on `Err`. Use only at the outermost edge — CLI harnesses, tests — never inside the engine core. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) {
    return result.value;
  }
  throw result.error instanceof Error ? result.error : new Error(String(result.error));
}

export function mapOk<T, U, E>(result: Result<T, E>, project: (value: T) => U): Result<U, E> {
  return result.ok ? ok(project(result.value)) : result;
}

export function mapErr<T, E, F>(result: Result<T, E>, project: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(project(result.error));
}
