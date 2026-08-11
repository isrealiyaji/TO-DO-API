/**
 * An error the application raised on purpose, as opposed to a crash.
 *
 * Services throw these. The error middleware turns them into responses.
 * Because the status code and error code travel with the error, a service
 * never needs to touch `res` to report a failure.
 */
class AppError extends Error {
  constructor(statusCode, code, message, details = []) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    // Marks this as an error we anticipated. Anything without this flag is a
    // genuine bug and must never have its message shown to the client.
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message, details = []) {
    return new AppError(400, "VALIDATION_ERROR", message, details);
  }

  static invalidQuery(message, details = []) {
    return new AppError(400, "INVALID_QUERY_PARAM", message, details);
  }

  static unauthenticated(message = "Authentication required") {
    return new AppError(401, "UNAUTHENTICATED", message);
  }

  static invalidCredentials() {
    // Deliberately identical for an unknown email and a wrong password, so
    // registered emails cannot be discovered by comparing responses.
    return new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
  }

  static taskNotFound() {
    // Also returned when the task exists but belongs to someone else, so task
    // ids cannot be enumerated.
    return new AppError(404, "TASK_NOT_FOUND", "Task not found");
  }

  static routeNotFound(method, path) {
    return new AppError(404, "ROUTE_NOT_FOUND", `Cannot ${method} ${path}`);
  }

  static emailTaken() {
    return new AppError(409, "EMAIL_ALREADY_EXISTS", "An account with that email already exists");
  }
}

module.exports = AppError;
