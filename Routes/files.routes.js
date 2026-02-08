const express = require("express");
const { upload, fileUpload, getAllFiles, searchFiles, getFile, deleteFile, downloadFile, updateFileName } = require("../Controllers/file-upload");
const router = express.Router();
const jwt = require("jsonwebtoken");
require("dotenv").config();

const SECRET = process.env.SECRET_KEY;
// ✅ Middleware to check JWT
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

router.post("/upload", authMiddleware, upload.single("file"), fileUpload);
router.get("/getFiles", authMiddleware, getAllFiles);
router.get("/searchFiles", authMiddleware, searchFiles);
router.get("/getMyFile", authMiddleware, getFile);
router.delete("/deleteFile", authMiddleware, deleteFile);
router.get("/exportFiles", authMiddleware, downloadFile);
router.put("/renameFile/:id", authMiddleware, updateFileName);

module.exports = router;
