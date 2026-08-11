const express = require("express");
const authController = require("../controllers/authController");
const auth = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

/**
 * `/me` rather than `/:userId`.
 *
 * The token already identifies the caller, so an id in the path would add
 * nothing except an enumeration target and an ownership check on every read.
 */
router.get("/me", auth, asyncHandler(authController.me));

module.exports = router;
