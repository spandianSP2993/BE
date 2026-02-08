const express = require("express");
const {getUserById} = require("../Controllers/users");
const router = express.Router();

// Get user by ID
router.get("/:id", getUserById);

module.exports = router;