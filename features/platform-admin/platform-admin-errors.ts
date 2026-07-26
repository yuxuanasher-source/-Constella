export class PlatformAdminValidationError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "PlatformAdminValidationError";
  }
}

export class PlatformAdminConflictError extends Error {
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = "PlatformAdminConflictError";
  }
}
