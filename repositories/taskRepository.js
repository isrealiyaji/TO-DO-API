const db = require("../config/db");

/**
 * Database access for tasks.
 *
 * This file is the only place that knows SQL or that the columns are named
 * snake_case. It takes and returns plain camelCase objects, so if the storage
 * ever changes, nothing above this layer has to.
 *
 * It contains no business rules and no HTTP knowledge. It does not decide
 * whether a missing task is a 404; it just reports that there was no row.
 */

/** Turns a database row into the shape the rest of the app uses. */
const mapTask = (row) => ({
  id: row.id,
  userId: row.user_id,
  title: row.title,
  description: row.description,
  completed: Boolean(row.completed), // MySQL gives back 0/1, not true/false
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * Columns that may be sorted on.
 *
 * A sort column cannot be a bound parameter, it has to be interpolated into
 * the SQL string. So it is looked up in this map rather than taken from user
 * input, which is what keeps the query safe.
 */
const SORTABLE = {
  createdAt: "created_at",
  title: "title",
};

/** Builds the shared WHERE clause for a user's tasks. */
const buildFilter = (userId, completed) => {
  const clauses = ["user_id = ?"];
  const params = [userId];

  if (completed !== undefined) {
    clauses.push("completed = ?");
    params.push(completed ? 1 : 0);
  }

  return { where: clauses.join(" AND "), params };
};

const taskRepository = {
  async create({ userId, title, description = null, completed = false }) {
    const [result] = await db.query(
      "INSERT INTO tasks (user_id, title, description, completed) VALUES (?, ?, ?, ?)",
      [userId, title, description, completed ? 1 : 0]
    );
    return taskRepository.findByIdAndUser(result.insertId, userId);
  },

  /**
   * Looks up one task, scoped to its owner.
   *
   * There is deliberately no findById(id). Every read is scoped by user_id so
   * that one user can never reach another user's row, even by accident.
   */
  async findByIdAndUser(id, userId) {
    const [rows] = await db.query(
      "SELECT * FROM tasks WHERE id = ? AND user_id = ? LIMIT 1",
      [id, userId]
    );
    return rows.length ? mapTask(rows[0]) : null;
  },

  async findAllByUser(userId, { completed, limit, offset, sort }) {
    const { where, params } = buildFilter(userId, completed);
    const column = SORTABLE[sort.field];
    const direction = sort.descending ? "DESC" : "ASC";

    const [rows] = await db.query(
      `SELECT * FROM tasks WHERE ${where} ORDER BY ${column} ${direction} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return rows.map(mapTask);
  },

  async countByUser(userId, { completed }) {
    const { where, params } = buildFilter(userId, completed);
    const [rows] = await db.query(
      `SELECT COUNT(*) AS total FROM tasks WHERE ${where}`,
      params
    );
    return rows[0].total;
  },

  /**
   * Updates only the columns present in `fields`.
   *
   * `fields` has already been filtered by the service to the keys the caller
   * actually sent, which is what allows completed:false to be written instead
   * of being mistaken for "not supplied".
   */
  async update(id, userId, fields) {
    const columns = {
      title: "title",
      description: "description",
      completed: "completed",
    };

    const assignments = [];
    const params = [];

    for (const [key, column] of Object.entries(columns)) {
      if (key in fields) {
        assignments.push(`${column} = ?`);
        params.push(key === "completed" ? (fields[key] ? 1 : 0) : fields[key]);
      }
    }

    if (assignments.length === 0) return taskRepository.findByIdAndUser(id, userId);

    await db.query(
      `UPDATE tasks SET ${assignments.join(", ")} WHERE id = ? AND user_id = ?`,
      [...params, id, userId]
    );
    return taskRepository.findByIdAndUser(id, userId);
  },

  /** Returns the number of rows removed, so the service can tell 404 from success. */
  async remove(id, userId) {
    const [result] = await db.query(
      "DELETE FROM tasks WHERE id = ? AND user_id = ?",
      [id, userId]
    );
    return result.affectedRows;
  },

  async removeByCompleted(userId, completed) {
    const { where, params } = buildFilter(userId, completed);
    const [result] = await db.query(`DELETE FROM tasks WHERE ${where}`, params);
    return result.affectedRows;
  },
};

module.exports = { taskRepository, SORTABLE };
