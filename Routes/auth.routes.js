const express = require("express");
const { login, verifyOtp, userRegister } = require("../login");
const router = express.Router();

//register
router.post("/register", userRegister);
//login
router.post("/login", login);
//verify token
router.post("/verify-otp", verifyOtp);

module.exports = router;
