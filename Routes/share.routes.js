const express = require("express");
const { generateLink, getLinkInfo, accessLink } = require("../Controllers/share");
const router = express.Router();
const jwt = require("jsonwebtoken");
require("dotenv").config();

const SECRET = process.env.SECRET_KEY;

// Auth Middleware (Optional for accessing, Required for generating)
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

// Generate Link (Requires Auth)
router.post("/generate", authMiddleware, generateLink);

// Get Link Info (Public)
router.get("/:token", getLinkInfo);

// Access Link (Public or Password Protected)
router.post("/:token/access", accessLink);

module.exports = router;
