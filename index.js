const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { upload, processExcelFile } = require("./file-upload");
const bodyparser = require("body-parser");
const authRoutes = require("./Routes/auth.routes");
const filesRoutes = require("./Routes/files.routes");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyparser.json());

app.get("/", (req, res) => {
  res.send("excel upload is running");
});

//routes
app.use("/auth", authRoutes);
app.use("/files", filesRoutes);

// app.post("/upload", upload.single("file"), (req, res) => {
//   console.log(req.file);
//   const result = processExcelFile(req.file.path);
//   console.log(result);
//   if (result.success) {
//     res.json({
//       message: "✅ File uploaded successfully!",
//       data: result.data,
//     });
//   } else {
//     res
//       .status(500)
//       .json({ error: "❌ Failed to process file", details: result.error });
//   }
// });

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
