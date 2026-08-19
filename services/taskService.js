const { taskRepository } = require("../repositories/taskRepository");
const AppError = require("../utils/AppError");

/**
 * Business rules for tasks.
 *
 * Shape checking happens in the validate middleware, so everything arriving
 * here is already the right type, trimmed, with defaults applied. What is left
 * is the part a schema cannot express: who owns a row, whether it exists, and
 * what a result means.
 *
 * Nothing in this file touches req or res, and nothing writes SQL.
 */

const taskService = {
  async createTask(userId, body) {
    // userId comes from the verified token. The schema rejects unknown keys, so
    // a client cannot smuggle userId in the body to create a task for someone
    // else.
    return taskRepository.create({ userId, ...body });
  },

  /**
   * Lists tasks with filtering, search, sorting and pagination.
   *
   * The count runs alongside the page rather than after it. Both queries are
   * independent, so awaiting them in sequence would double the latency for no
   * reason.
   */
  async listTasks(userId, query) {
    const { page, limit, sort, ...filters } = query;
    const offset = (page - 1) * limit;

    const [tasks, total] = await Promise.all([
      taskRepository.findAllByUser(userId, { filters, limit, offset, sort }),
      taskRepository.countByUser(userId, filters),
    ]);

    const totalPages = Math.ceil(total / limit);

    // An empty page is a valid answer, not an error, so this returns 200 with
    // an empty array rather than a 404. Asking for page 50 of 3 is likewise a
    // legitimate question with the answer "nothing".
    return {
      tasks,
      meta: {
        page,
        limit,
        total,
        totalPages,
        // Computed server-side so a client does not have to reimplement the
        // arithmetic — and get it wrong on the last page.
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1 && total > 0,
      },
    };
  },

  async getTask(userId, taskId) {
    const task = await taskRepository.findByIdAndUser(taskId, userId);
    // Absent and not-yours give the same answer, so task ids cannot be probed
    // by comparing responses.
    if (!task) throw AppError.taskNotFound();
    return task;
  },

  /**
   * Partial update.
   *
   * The schema has already reduced the body to only the keys the client sent,
   * so passing it straight through applies exactly those fields. This is what
   * lets completed:false be written; the old `completed || existing` guard
   * treated false as "not supplied" and made un-completing impossible.
   */
  async patchTask(userId, taskId, body) {
    const existing = await taskRepository.findByIdAndUser(taskId, userId);
    if (!existing) throw AppError.taskNotFound();

    return taskRepository.update(taskId, userId, body);
  },

  /** Full replacement. The schema requires every field, so nothing is merged. */
  async replaceTask(userId, taskId, body) {
    const existing = await taskRepository.findByIdAndUser(taskId, userId);
    if (!existing) throw AppError.taskNotFound();

    return taskRepository.update(taskId, userId, body);
  },

  async deleteTask(userId, taskId) {
    const removed = await taskRepository.remove(taskId, userId);
    // Zero rows means it either never existed or belonged to someone else.
    // Either way the caller learns the same thing.
    if (removed === 0) throw AppError.taskNotFound();
  },

  /**
   * Bulk delete.
   *
   * The schema makes ?completed= required, so there is no way to reach this
   * without a filter. The old DELETE /tasks took no parameters and removed
   * every row in the table, for every user.
   */
  async deleteByFilter(userId, query) {
    return taskRepository.removeByCompleted(userId, query.completed);
  },
};

module.exports = taskService;
