const express = require("express");
const { upload, fileUpload, getAllFiles, getFile } = require("../file-upload");
const router = express.Router();
require("dotenv").config();

const SECRET = process.env.SECRET_KEY;
// ✅ Middleware to check JWT
const authMiddleware = (req, res, next) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.status(403).json({ error: "No token" });

  jwt.verify(token, SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid token" });
    req.user = user;
    next();
  });
};

router.post("/upload", authMiddleware, upload.single("file"), fileUpload);
router.get("/getFiles", authMiddleware, getAllFiles);
router.get("/getMyFile", authMiddleware, getFile);

module.exports = router;
