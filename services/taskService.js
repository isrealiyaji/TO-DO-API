const { taskRepository, SORTABLE } = require("../repositories/taskRepository");
const AppError = require("../utils/AppError");

/**
 * Business rules for tasks.
 *
 * This layer decides what is valid, what counts as "not found", and what a
 * partial update means. It never touches `req` or `res`, and it never writes
 * SQL, so the same functions would work unchanged behind a CLI or a job queue.
 */

const MAX_TITLE = 255;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

/** Rejects anything that is not a positive integer id. */
const parseId = (value) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) {
    throw AppError.badRequest("Invalid task id", [
      { field: "taskId", issue: "must be a positive integer" },
    ]);
  }
  return id;
};

const validateTitle = (title, details) => {
  if (typeof title !== "string" || title.trim().length === 0) {
    details.push({ field: "title", issue: "title is required" });
  } else if (title.length > MAX_TITLE) {
    details.push({ field: "title", issue: `title must be at most ${MAX_TITLE} characters` });
  }
};

const validateDescription = (description, details) => {
  if (description !== null && typeof description !== "string") {
    details.push({ field: "description", issue: "description must be a string or null" });
  }
};

const validateCompleted = (completed, details) => {
  if (typeof completed !== "boolean") {
    details.push({ field: "completed", issue: "completed must be a boolean" });
  }
};

/** Reads "true"/"false" from a query string. Anything else is an error, not a default. */
const parseBoolean = (value, field) => {
  if (value === "true") return true;
  if (value === "false") return false;
  throw AppError.invalidQuery(`Invalid ${field}`, [
    { field, issue: "must be 'true' or 'false'" },
  ]);
};

/** Turns "-createdAt" into a validated field plus a direction. */
const parseSort = (value) => {
  const raw = value ?? "-createdAt";
  const descending = raw.startsWith("-");
  const field = descending ? raw.slice(1) : raw;

  if (!(field in SORTABLE)) {
    throw AppError.invalidQuery("Invalid sort", [
      { field: "sort", issue: `must be one of ${Object.keys(SORTABLE).join(", ")}, optionally prefixed with '-'` },
    ]);
  }
  return { field, descending };
};

const parsePagination = ({ page, limit }) => {
  const parsed = { page: 1, limit: DEFAULT_LIMIT };

  if (page !== undefined) {
    const value = Number(page);
    if (!Number.isInteger(value) || value < 1) {
      throw AppError.invalidQuery("Invalid page", [
        { field: "page", issue: "must be an integer of 1 or more" },
      ]);
    }
    parsed.page = value;
  }

  if (limit !== undefined) {
    const value = Number(limit);
    if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
      throw AppError.invalidQuery("Invalid limit", [
        { field: "limit", issue: `must be an integer between 1 and ${MAX_LIMIT}` },
      ]);
    }
    parsed.limit = value;
  }

  return parsed;
};

const taskService = {
  async createTask(userId, body) {
    const details = [];
    const { title, description = null, completed = false } = body ?? {};

    validateTitle(title, details);
    validateDescription(description, details);
    validateCompleted(completed, details);

    if (details.length) throw AppError.badRequest("Request validation failed", details);

    // userId comes from the verified token, never from the body, so a caller
    // cannot create a task owned by someone else.
    return taskRepository.create({ userId, title: title.trim(), description, completed });
  },

  async listTasks(userId, query) {
    const { page, limit } = parsePagination(query);
    const sort = parseSort(query.sort);
    const completed =
      query.completed === undefined ? undefined : parseBoolean(query.completed, "completed");

    const offset = (page - 1) * limit;

    const [tasks, total] = await Promise.all([
      taskRepository.findAllByUser(userId, { completed, limit, offset, sort }),
      taskRepository.countByUser(userId, { completed }),
    ]);

    // An empty page is a valid result, not an error. The caller gets 200.
    return {
      tasks,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 0 },
    };
  },

  async getTask(userId, taskIdParam) {
    const id = parseId(taskIdParam);
    const task = await taskRepository.findByIdAndUser(id, userId);
    // Missing and not-yours are the same answer, so ids cannot be probed.
    if (!task) throw AppError.taskNotFound();
    return task;
  },

  /**
   * Partial update.
   *
   * Only keys the caller actually sent are applied. This is checked with `in`
   * rather than truthiness, which is what allows completed:false and an empty
   * description to be written. The previous `completed || existing` version
   * silently discarded false and made a task impossible to un-complete.
   */
  async patchTask(userId, taskIdParam, body) {
    const id = parseId(taskIdParam);
    const payload = body ?? {};
    const details = [];
    const fields = {};

    if ("title" in payload) {
      validateTitle(payload.title, details);
      fields.title = typeof payload.title === "string" ? payload.title.trim() : payload.title;
    }
    if ("description" in payload) {
      validateDescription(payload.description, details);
      fields.description = payload.description;
    }
    if ("completed" in payload) {
      validateCompleted(payload.completed, details);
      fields.completed = payload.completed;
    }

    if (Object.keys(fields).length === 0) {
      details.push({ field: "body", issue: "at least one of title, description, completed is required" });
    }
    if (details.length) throw AppError.badRequest("Request validation failed", details);

    const existing = await taskRepository.findByIdAndUser(id, userId);
    if (!existing) throw AppError.taskNotFound();

    return taskRepository.update(id, userId, fields);
  },

  /**
   * Full replacement.
   *
   * Every field is required, because PUT replaces the whole resource. That is
   * the difference from PATCH: omitting description here is not "leave it",
   * it is invalid.
   */
  async replaceTask(userId, taskIdParam, body) {
    const id = parseId(taskIdParam);
    const details = [];
    const payload = body ?? {};

    validateTitle(payload.title, details);
    if (!("description" in payload)) {
      details.push({ field: "description", issue: "description is required (send null to clear it)" });
    } else {
      validateDescription(payload.description, details);
    }
    if (!("completed" in payload)) {
      details.push({ field: "completed", issue: "completed is required" });
    } else {
      validateCompleted(payload.completed, details);
    }

    if (details.length) throw AppError.badRequest("Request validation failed", details);

    const existing = await taskRepository.findByIdAndUser(id, userId);
    if (!existing) throw AppError.taskNotFound();

    return taskRepository.update(id, userId, {
      title: payload.title.trim(),
      description: payload.description,
      completed: payload.completed,
    });
  },

  async deleteTask(userId, taskIdParam) {
    const id = parseId(taskIdParam);
    const removed = await taskRepository.remove(id, userId);
    if (removed === 0) throw AppError.taskNotFound();
  },

  /**
   * Bulk delete, filter required.
   *
   * There is no way to delete every task in one call. The old DELETE /tasks
   * took no parameters and removed rows for every user in the table.
   */
  async deleteByFilter(userId, query) {
    if (query.completed === undefined) {
      throw AppError.invalidQuery("A filter is required for bulk delete", [
        { field: "completed", issue: "must be provided, e.g. ?completed=true" },
      ]);
    }
    const completed = parseBoolean(query.completed, "completed");
    return taskRepository.removeByCompleted(userId, completed);
  },
};

module.exports = taskService;
