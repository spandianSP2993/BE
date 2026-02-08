const express = require("express");
const { login, verifyOtp, userRegister, requestPasswordReset, resetPassword } = require("../Controllers/login");
const router = express.Router();

//register
router.post("/register", userRegister);
//login
router.post("/login", login);
//verify token
router.post("/verify-otp", verifyOtp);
//request password reset
router.post("/request-password-reset", requestPasswordReset);
router.post("/reset-password", resetPassword);

module.exports = router;
