import { logger } from "@/lib/redact";

// SQLSTATE P0001 is raise_exception, which is what a bare `raise exception` in
// our own RPCs produces. Every one of those messages is written for the person
// using the app -- 'Worker is unavailable', 'Choose more dates. A day can hold at
// most 16 one-hour tasks starting at 8:00am', 'Reopen completed work before
// editing it'. Those are worth showing.
//
// Anything else is infrastructure: constraint names, column names, type-cast
// failures, connection errors. Those told the user nothing useful and described
// the schema to anyone who cared to read them.
const RAISED_DELIBERATELY = "P0001";

const GENERIC = "Something went wrong. Try again, and tell your manager if it keeps happening.";

type QueryError = { message?: string; code?: string } | null | undefined;

// Always logs. Returning an error to the browser without recording it server-side
// made every one of these failures invisible in observability.
export function actionError(scope: string, error: QueryError, fallback = GENERIC) {
  logger.error(`${scope}.failed`, error);
  if (error?.code === RAISED_DELIBERATELY && error.message) return { error: error.message };
  return { error: fallback };
}

// For the handful of actions that return void and rely on throwing. The thrown
// message is the same vetted text the ActionState callers would have shown.
export function throwActionError(scope: string, error: QueryError, fallback = GENERIC): never {
  throw new Error(actionError(scope, error, fallback).error);
}
