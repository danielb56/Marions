// Shared limits for the completion-photo upload flow. The presign route, the
// complete route and the browser queue must agree on these, so they live in one
// place rather than as repeated literals.

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

// A submission still accepts photo evidence while it is awaiting review or has
// been sent back for changes. Once approved or rejected it is closed.
export const OPEN_SUBMISSION_STATUSES: readonly string[] = ["submitted", "changes_requested"];
