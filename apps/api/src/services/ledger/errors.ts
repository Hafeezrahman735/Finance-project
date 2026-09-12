import { AppError } from "../../lib/errors.js";

/** Ledger failures map to 4xx envelopes; see CEO review Section 2 (error and rescue map). */

export class UnbalancedEntryError extends AppError {
  constructor(debitMinor: bigint, creditMinor: bigint) {
    super(422, "validation_error", "unbalanced_entry", `Entry does not balance: debits ${debitMinor} vs credits ${creditMinor} minor units`);
  }
}

export class InvalidLineError extends AppError {
  constructor(message: string, param?: string) {
    super(422, "validation_error", "invalid_line", message, param);
  }
}

export class CrossOrgReferenceError extends AppError {
  constructor(entity: string) {
    // 404, not 403: never confirm that a foreign id exists (CEO review Section 3).
    super(404, "not_found", "not_found", `${entity} not found`);
  }
}

export class CurrencyMismatchError extends AppError {
  constructor(expected: string, got: string) {
    super(422, "validation_error", "currency_mismatch", `Currency must be ${expected}; got ${got}`, "currency");
  }
}

export class EntryNotFoundError extends AppError {
  constructor() {
    super(404, "not_found", "entry_not_found", "Entry not found");
  }
}

export class InvalidTransitionError extends AppError {
  constructor(message: string) {
    super(409, "conflict", "invalid_transition", message);
  }
}

export class EntryLockedError extends AppError {
  constructor() {
    super(409, "conflict", "entry_locked", "This entry is reconciled or in a closed period; post a reversing entry instead");
  }
}

export class StaleVersionError extends AppError {
  constructor() {
    super(409, "conflict", "stale_version", "This entry changed since you loaded it; refresh and try again");
  }
}
