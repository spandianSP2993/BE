const express = require("express");
const {
  createFolder,
  getFolderContents,
  getFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
  getRootFolders,
} = require("../Controllers/folders");
const router = express.Router();
const jwt = require("jsonwebtoken");
require("dotenv").config();

const SECRET = process.env.SECRET_KEY;

// ✅ Auth Middleware (same as in files.routes.js)
const authMiddleware = (req, res, next) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.status(403).json({ error: "No token" });

  jwt.verify(token, SECRET, (err, user) => {
    if (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({ error: "Token expired" });
      }
      return res.status(403).json({ error: "Invalid token" });
    }
    req.user = user;
    next();
  });
};

// Routes
router.post("/createFolder", authMiddleware, createFolder);
router.get("/rootFolders", authMiddleware, getRootFolders);
router.get("/:id/contents", authMiddleware, getFolderContents);
router.get("/:id", authMiddleware, getFolder);
router.put("/:id/rename", authMiddleware, renameFolder);
router.put("/:id/move", authMiddleware, moveFolder);
router.delete("/:id", authMiddleware, deleteFolder);

module.exports = router;
