const express = require("express");
const authController = require("../controllers/authController");
const asyncHandler = require("../utils/asyncHandler");

/**
 * Registration and login.
 *
 * Neither route uses the auth middleware, because both exist to obtain a
 * token in the first place.
 */
const router = express.Router();

router.post("/register", asyncHandler(authController.register));
router.post("/login", asyncHandler(authController.login));

module.exports = router;
