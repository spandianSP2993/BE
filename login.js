const nodemailer = require("nodemailer");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const bcrypt = require("bcrypt");
const pool = require("./db");

const SECRET = process.env.SECRET_KEY;
const mailUser = process.env.MAILTRAP_USER;
const mailPassword = process.env.MAILTRAP_PASS;
let users = [{ email: "senthilpandian01@gmail.com", password: "123456" }];
let otpStore = {};

//------------------REGISTER------------------
const userRegister = async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (name, email, password) VALUES ($1,$2,$3) RETURNING id",
      [name, email, hashed]
    );
    res.json({ message: "User registered", userId: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error registering user" });
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
        user: process.env.MAILTRAP_USER,
        pass: process.env.MAILTRAP_PASS,
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
const verifyOtp = (req, res) => {
  try {
    const { email, otp } = req.body;

    const storedOtp = otpStore[email];
    if (!storedOtp) {
      return res.status(400).json({ message: "No OTP requested" });
    }

    // ✅ Validate OTP
    if (storedOtp.otp === otp && Date.now() < storedOtp.expires) {
      delete otpStore[email];

      // Generate JWT
      const token = jwt.sign({ email }, SECRET, { expiresIn: "1h" });

      return res.status(200).json({
        message: "Login successful",
        token,
      });
    }

    res.status(400).json({ message: "Invalid or expired OTP" });
  } catch (err) {
    console.error("❌ Error verifying OTP:", err);
    res.status(500).json({ message: "Something went wrong" });
  }
};

module.exports = { login, verifyOtp, userRegister };
