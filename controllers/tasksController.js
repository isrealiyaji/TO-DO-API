const tasks = [];
const jwt = require("jsonwebtoken");
const db = require("../config/db");
require("dotenv").config();
// title: string, description: string, completed: boolean
class TasksController {
  //Create a task
  async createTask(req, res) {
    try {
        const { title, description } = req.body;
      if (!title) {
        return res.status(400).json({
          success: false,
          message: "Title is required",
        });
      }
      //Authorization begins
      // Check if user is authenticated
      const authorization = req.header("authorization");
      if (!authorization) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized",
        });
      }
      // Verify the token
      const token = authorization.split(" ")[1];
      const verifiedToken = jwt.verify(token, process.env.JWT_SECRET);
      if (!verifiedToken) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized",
        });
      }
      //Authorization ends
      const [result] = await db.query(
        "INSERT INTO tasks (title, description, user_id) VALUES (?, ?, ?)",
        [title, description, verifiedToken.id]
      ); // SQL prepared statement
      const [newTask] = await db.query("SELECT * FROM tasks WHERE id = ?", [
        result.insertId,
      ]);
      res.status(201).json({
        success: true,
        message: "Task created successfully",
        data: newTask,
      });
    } catch (err) {
      res
        .status(500)
        .json({ error: "Error creating task", details: err.message });
    }
  }

  //No longer used
  async getAllTasks(req, res) {
    try {
      const [task] = await db.query("SELECT * FROM task");
      console.log(task);
      return res.status(200).json({
        success: true,
        message: "All Tasks",
        data: task,
      });
    } catch (error) {
      res
        .status(500)
        .json({ error: "Error fetching task", details: err.message });
    }
  }

  // Get all unfinished tasks
  //TODO: Add user_id
  async getallUnfinishedTasks(req, res) {
    // const [unfinishedTasks] = await db.query("SELECT * FROM tasks WHERE user_id = ? AND completed = ?",[userId, 0]);
    const [unfinishedTasks] = await db.query(
      "SELECT * FROM tasks WHERE completed = ?",
      [0]
    );
    return res.status(200).json({
      success: true,
      message: "All Unfinished Tasks",
      data: unfinishedTasks,
    });
  }

  // Get all completed tasks
  //TODO: Add user_id
  async getAllCompletedTasks(req, res) {
    try {
      const [completedTasks] = await db.query(
        " SELECT * FROM task WHERE completed = ?",
        [1]
      );
      console.log("completedTasks", completedTasks);
      return res.status(200).json({
        success: true,
        message: "All Completed Tasks",
        data: completedTasks,
      });
    } catch (err) {
      res
        .status(500)
        .json({ error: "Error creating task", details: err.message });
    }
  }

  //Get single task
  async getSingleTask(req, res) {
    try {
      const taskId = req.params.taskId;
      const [rows] = await db.query("SELECT * FROM tasks WHERE id = ?", taskId);
      console.log(rows);
      return res.status(200).json({
        success: true,
        message: "Single Task",
        data: rows,
      });
    } catch (err) {
      res
        .status(500)
        .json({ error: "Error creating task", details: err.message });
    }
  }

  //Update task
  async updateTask(req, res) {
    try {
      const taskId = req.params.taskId;
      const { title, description, completed } = req.body;
      console.log(taskId);
      const [getTask] = await db.query("SELECT * FROM tasks WHERE id = ?", [
        taskId,
      ]);
      if (!getTask || getTask.length <= 0) {
        return res.status(404).json({
          success: false,
          message: "Task not found",
        });
      }
      const [updateTask] = await db.query(
        "UPDATE tasks set title=?, description=?, completed=? WHERE id=?",
        [
          title || getTask[0].title,
          description || getTask[0].description,
          completed || getTask[0].completed,
          taskId,
        ]
      );
      const [updatedTask] = await db.query("SELECT * FROM tasks WHERE id = ?", [
        taskId,
      ]);

      return res.status(200).json({
        success: true,
        message: "Task updated successfully",
        data: updatedTask,
      });
    } catch (err) {
      res
        .status(500)
        .json({ error: "Error creating task", details: err.message });
    }
  }
  // Delete all completed tasks
  //TODO: Add user_id
  async deleteAllCompletedTask(req, res) {
    try {
      const [deleteTask] = await db.query(
        "DELETE FROM task WHERE completed = ?",
        [1]
      );
      console.log(deleteTask);
      const deletedCount = deleteTask.affectedRows;
      return res.status(200).json({
        success: true,
        message: `${deletedCount} completed task(s) deleted successfully`,
        data: "",
      });
    } catch (err) {
      res
        .status(500)
        .json({ error: "Error creating task", details: err.message });
    }
  }

  //Delete a task
  async deleteTask(req, res) {
    try {
      const taskId = req.params.taskId;
      const [task] = await db.query("SELECT * FROM task WHERE id = ?", [
        taskId,
      ]);

      if (!task.length) {
        return res.status(404).json({
          success: false,
          message: "Task not found",
        });
      }

      //Find the index of the task in the tasks array and then remove it from the array

      const [deleteResult] = await db.query("DELETE FROM task WHERE id = ?", [
        taskId,
      ]);

      return res.status(200).json({
        success: true,
        message: "Task deleted successfully",
        data: "",
      });
    } catch (error) {
      res
        .status(500)
        .json({ error: "Error fetching task", details: err.message });
    }
  }

  // Delete all tasks
  //TODO: Add user_id
  async deleteAllTask(req, res) {
    try {
      const [deleteResult] = await db.query("DELETE FROM task");
      const deletedCount = deleteResult.affectedRows;

      return res.status(200).json({
        success: true,
        message: `${deletedCount} task(s) deleted successfully`,
      });
    } catch (error) {
      res
        .status(500)
        .json({ error: "Error fetching task", details: err.message });
    }
  }

  /**
   * ROADMAP
   *
   *
   * Authentication && Authorization
   * JWT tokens
   * Middlewares
   * Tasks App -> Sign in -> Mange your tasks -> Logout
   * Databases -> MongoDB (NoSQL) -> MySQL (relational database)
   * User Mangement App APIs
   * Ecommerce App APIs
   * Build your own app
   *
   */

  //TODO: Assingment: Put everything in try catch block just like the create task fuinction and then integrate it with the frontend
  //TODO: Assingment: Add an env.example with all the details for DB connection
  //TODO: Assingment: Properly document your APIs and add steps on how to run the app into your README file
}

module.exports = new TasksController();
