const express = require("express");
const taskController = require("../controllers/taskController");
const auth = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");

/**
 * Task routes.
 *
 * A route file is a table of contents: URL, method, middleware, handler.
 * There is no logic here, so the whole surface of the resource can be read
 * at a glance.
 */
const router = express.Router();

// Applies to every route below, so auth cannot be forgotten on a new one.
router.use(auth);

router
  .route("/")
  .get(asyncHandler(taskController.list))
  .post(asyncHandler(taskController.create))
  // Bulk delete requires ?completed=, enforced in the service.
  .delete(asyncHandler(taskController.removeByFilter));

router
  .route("/:taskId")
  .get(asyncHandler(taskController.getOne))
  .patch(asyncHandler(taskController.patch))
  .put(asyncHandler(taskController.replace))
  .delete(asyncHandler(taskController.remove));

module.exports = router;
