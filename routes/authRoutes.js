const express = require("express");
const authController = require("../controllers/authController");
const validate = require("../middleware/validate");
const asyncHandler = require("../utils/asyncHandler");
const schemas = require("../validation/authSchemas");

/**
 * Registration and login.
 *
 * Neither route uses the auth middleware, because both exist to obtain a token
 * in the first place.
 */
const router = express.Router();

router.post(
  "/register",
  validate({ body: schemas.registerBody }),
  asyncHandler(authController.register)
);

router.post(
  "/login",
  validate({ body: schemas.loginBody }),
  asyncHandler(authController.login)
);

module.exports = router;
