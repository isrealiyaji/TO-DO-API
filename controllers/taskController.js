const taskService = require("../services/taskService");
const { ok, created, noContent } = require("../utils/respond");

/**
 * HTTP layer for tasks.
 *
 * A controller does three things and nothing else: pull values off the
 * request, call one service function, and choose the success response.
 *
 * There is no try/catch here. Handlers are wrapped in asyncHandler at the
 * route, so a thrown AppError travels straight to the error middleware.
 */

const taskController = {
  async create(req, res) {
    const task = await taskService.createTask(req.user.id, req.body);
    return created(res, task, `/api/v1/tasks/${task.id}`);
  },

  async list(req, res) {
    const { tasks, meta } = await taskService.listTasks(req.user.id, req.query);
    return ok(res, tasks, meta);
  },

  async getOne(req, res) {
    const task = await taskService.getTask(req.user.id, req.params.taskId);
    return ok(res, task);
  },

  async patch(req, res) {
    const task = await taskService.patchTask(req.user.id, req.params.taskId, req.body);
    return ok(res, task);
  },

  async replace(req, res) {
    const task = await taskService.replaceTask(req.user.id, req.params.taskId, req.body);
    return ok(res, task);
  },

  async remove(req, res) {
    await taskService.deleteTask(req.user.id, req.params.taskId);
    return noContent(res);
  },

  async removeByFilter(req, res) {
    await taskService.deleteByFilter(req.user.id, req.query);
    return noContent(res);
  },
};

module.exports = taskController;
