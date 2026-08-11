const express = require("express");
const taskRoutes = require("./taskRoutes");
const authRoutes = require("./authRoutes");
const userRoutes = require("./userRoutes");

/**
 * Mounts every resource under one router.
 *
 * The version prefix is applied where this router is mounted in app.js, so a
 * future /api/v2 is a new mount rather than an edit to every route file.
 */
const router = express.Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/tasks", taskRoutes);

module.exports = router;
