const multer = require("multer");
const xlsx = require("xlsx");
const path = require("path");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

const processExcelFile = (filePath) => {
  try {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const jsonData = xlsx.utils.sheet_to_json(sheet);
    return { success: true, data: jsonData };
  } catch (error) {
    return { success: false, error };
  }
};

//File Upload
const fileUpload = async (req, res) => {
  try {
    const { originalname, filename, mimetype, size, path } = req.file;
    await pool.query(
      "INSERT INTO files (user_id, original_name, stored_name, file_type, file_size, upload_path) VALUES ($1,$2,$3,$4,$5,$6)",
      [req.user.userId, originalname, filename, mimetype, size, path]
    );
    res.json({ message: "File uploaded successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error uploading file" });
  }
};

//Get files
const getAllFiles = async (req, res) => {
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Not allowed" });

  const result = await pool.query("SELECT * FROM files");
  res.json(result.rows);
};

//Get files by id
const getFile = async (req, res) => {
  const result = await pool.query("SELECT * FROM files WHERE user_id=$1", [
    req.user.userId,
  ]);
  res.json(result.rows);
};

module.exports = { upload, processExcelFile, fileUpload, getAllFiles, getFile };
