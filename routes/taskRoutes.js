const express = require("express");
const taskController = require("../controllers/taskController");
const auth = require("../middleware/auth");
const validate = require("../middleware/validate");
const asyncHandler = require("../utils/asyncHandler");
const schemas = require("../validation/taskSchemas");

/**
 * Task routes.
 *
 * Each line reads as a sentence: which method, which path, who may call it,
 * what shape the request must have, and which handler runs. Because the schema
 * sits in the route, the contract is visible without opening the controller.
 */
const router = express.Router();

// Applies to every route below, so auth cannot be forgotten on a new one.
router.use(auth);

router
  .route("/")
  .get(validate({ query: schemas.listTasksQuery }), asyncHandler(taskController.list))
  .post(validate({ body: schemas.createTaskBody }), asyncHandler(taskController.create))
  // The schema makes ?completed= required, so this cannot wipe the collection.
  .delete(validate({ query: schemas.bulkDeleteQuery }), asyncHandler(taskController.removeByFilter));

router
  .route("/:taskId")
  .get(validate({ params: schemas.taskIdParam }), asyncHandler(taskController.getOne))
  .patch(
    validate({ params: schemas.taskIdParam, body: schemas.patchTaskBody }),
    asyncHandler(taskController.patch)
  )
  .put(
    validate({ params: schemas.taskIdParam, body: schemas.replaceTaskBody }),
    asyncHandler(taskController.replace)
  )
  .delete(validate({ params: schemas.taskIdParam }), asyncHandler(taskController.remove));

module.exports = router;
