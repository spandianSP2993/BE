const nodemailer = require("nodemailer");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const bcrypt = require("bcrypt");
const pool = require("../db");

const SECRET = process.env.SECRET_KEY;
const mailUser = process.env.MAILTRAP_USER;
const mailPassword = process.env.MAILTRAP_PASS;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:4200";
let users = [{ email: "senthilpandian01@gmail.com", password: "123456" }];
let otpStore = {};
let resetTokenStore = {};
// Nodemailer setup
const transporter = nodemailer.createTransport({
  host: "smtp.mailtrap.io",
  port: 2525,
  auth: { user: mailUser, pass: mailPassword },
});

//------------------REGISTER------------------
const userRegister = async (req, res) => {
  const { name, email, password } = req.body;
  try {
    // check duplicate email
    const exists = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (exists.rows.length) {
      return res.status(409).json({ message: "Email already registered" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (name, email, password) VALUES ($1,$2,$3) RETURNING id",
      [name, email, hashed]
    );
    res.json({ message: "User registered", userId: result.rows[0].id });
  } catch (err) {
    console.error(err);
    // handle unique constraint just in case of race condition
    if (err.code === "23505") {
      return res.status(409).json({ message: "Email already registered" });
    }
    res.status(500).json({ message: "Error registering user" });
  }
};

// ------------------ LOGIN -------------------
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1️⃣ Check user in DB
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ message: "Invalid Credentials" });
    }

    // 2️⃣ Compare password (hashed)
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ message: "Invalid Credentials" });
    }

    // 3️⃣ Generate OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    otpStore[email] = {
      otp,
      expires: Date.now() + 5 * 60 * 1000, // expires in 5 min
    };
    console.log(`✅ OTP for ${email}: ${otp}`);

    // 4️⃣ Mailtrap transporter
    const transporter = nodemailer.createTransport({
      host: "sandbox.smtp.mailtrap.io",
      port: 2525,
      auth: {
        user: mailUser,
        pass: mailPassword,
      },
    });

    // 5️⃣ Send OTP email
    await transporter.sendMail({
      from: '"File Management App" <no-reply@fms.com>',
      to: email,
      subject: "Your OTP Code",
      text: `Your OTP is ${otp}. It will expire in 5 minutes.`,
    });

    res.json({ message: "OTP sent to your email (check Mailtrap inbox)" });
  } catch (err) {
    console.error("❌ Error in login:", err);
    res.status(500).json({ message: "Something went wrong" });
  }
};

// ------------------ VERIFY OTP -------------------
const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    const storedOtp = otpStore[email];
    if (!storedOtp) {
      return res.status(400).json({ message: "No OTP requested" });
    }

    // ✅ Validate OTP
    if (storedOtp.otp === otp && Date.now() < storedOtp.expires) {
      delete otpStore[email];

      // Fetch user id and role from DB
      const result = await pool.query("SELECT id, role FROM users WHERE email = $1", [email]);
      const userId = result.rows[0]?.id || null;
      const role = result.rows[0]?.role || "user";

      // Generate JWT including id and role
      const token = jwt.sign({ email, id: userId, role }, SECRET, { expiresIn: "1h" });

      return res.status(200).json({
        message: "Login successful",
        token,
        userId,
        role,
      });
    }

    res.status(400).json({ message: "Invalid or expired OTP" });
  } catch (err) {
    console.error("❌ Error verifying OTP:", err);
    res.status(500).json({ message: "Something went wrong" });
  }
};

// ------------------- RESET PASSWORD REQUEST -------------------
const requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;

    // Check if user exists
    const result = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) {
      // Don't reveal if email exists (security best practice)
      return res.status(200).json({ message: "If email exists, reset link sent" });
    }

    const userId = result.rows[0].id;

    // Generate reset token (expires in 30 minutes)
    const resetToken = jwt.sign({ userId, email }, SECRET, { expiresIn: "30m" });
    resetTokenStore[email] = { token: resetToken, expires: Date.now() + 30 * 60 * 1000 };

    // Create reset link
    const resetLink = `${FRONTEND_URL}/reset-password?token=${resetToken}`;

    // Send email
    await transporter.sendMail({
      from: '"File Management App" <no-reply@fms.com>',
      to: email,
      subject: "Password Reset Link",
      html: `
        <p>You requested a password reset.</p>
        <p>Click the link below to reset your password (valid for 30 minutes):</p>
        <a href="${resetLink}">Reset Password</a>
        <p>Or copy this link: ${resetLink}</p>
        <p>If you didn't request this, ignore this email.</p>
      `,
    });

    res.status(200).json({ message: "Reset link sent to your email" });
  } catch (err) {
    console.error("❌ Error requesting password reset:", err);
    res.status(500).json({ message: "Error processing request" });
  }
};

// ------------------- VERIFY RESET TOKEN & UPDATE PASSWORD -------------------
const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ message: "Token and new password required" });
    }

    // Verify token
    jwt.verify(token, SECRET, async (err, decoded) => {
      if (err) {
        if (err.name === "TokenExpiredError") {
          return res.status(401).json({ message: "Reset link expired" });
        }
        return res.status(403).json({ message: "Invalid reset link" });
      }

      const { userId, email } = decoded;

      // Validate password strength (optional)
      if (newPassword.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }

      // Hash new password
      const hashed = await bcrypt.hash(newPassword, 10);

      // Update password in DB
      await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hashed, userId]);

      // Clear reset token
      delete resetTokenStore[email];

      res.status(200).json({ message: "✅ Password reset successfully" });
    });
  } catch (err) {
    console.error("❌ Error resetting password:", err);
    res.status(500).json({ message: "Error resetting password" });
  }
};

module.exports = { login, verifyOtp, userRegister, requestPasswordReset, resetPassword };
