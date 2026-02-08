const multer = require("multer");
const xlsx = require("xlsx");
const path = require("path");
const pool = require("../db");
const archiver = require("archiver");
const fs = require("fs");

const multerS3 = require("multer-s3");
const s3Config = require("../s3Config");

const upload = multer({
  storage: multerS3({
    s3: s3Config,
    bucket: process.env.AWS_BUCKET_NAME,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    metadata: function (req, file, cb) {
      cb(null, { fieldName: file.fieldname });
    },
    key: function (req, file, cb) {
      cb(null, Date.now() + path.extname(file.originalname));
    },
  }),
});

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
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { originalname, mimetype, size, key, location } = req.file;
    const filename = key; // Use S3 key as filename
    const filePath = key; // Use S3 key as filePath for consistency

    // Require authenticated user (middleware should populate req.user)
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // The uploader becomes the owner of the file
    const userId = parseInt(req.user.id);
    const folderId = req.body.folderId ? parseInt(req.body.folderId) : null;

    // If folderId provided, verify user has access to folder
    if (folderId) {
      const folderCheck = await pool.query(
        "SELECT owner_id FROM folders WHERE id = $1",
        [folderId]
      );
      if (folderCheck.rows.length === 0) {
        return res.status(404).json({ error: "Folder not found" });
      }
      // Check ownership (allow admin or folder owner)
      if (req.user.role !== "admin" && folderCheck.rows[0].owner_id !== userId) {
        return res.status(403).json({ error: "Access denied to folder" });
      }
    }

    await pool.query(
      `INSERT INTO files 
        (user_id, original_name, stored_name, file_type, file_size, upload_path, folder_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, originalname, filename, mimetype, size, filePath, folderId]
    );

    res.status(201).json({ message: "✅ File uploaded successfully" });
  } catch (err) {
    console.error("❌ Error uploading file:", err);
    res.status(500).json({ error: "Error uploading file" });
  }
};


//Pagination helper function
const getPaginatedResults = async (query, params, page = 1, pageSize = 10) => {
  try {
    // Validate page and pageSize
    page = Math.max(1, parseInt(page) || 1);
    pageSize = Math.max(1, Math.min(100, parseInt(pageSize) || 10)); // Max 100 items per page

    // Get total count
    const countQuery = `SELECT COUNT(*) FROM (${query}) AS count_query`;
    const countResult = await pool.query(countQuery, params);
    const totalItems = parseInt(countResult.rows[0].count);

    // Calculate offset
    const offset = (page - 1) * pageSize;

    // Get paginated data
    const paginatedQuery = `${query} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const paginatedParams = [...params, pageSize, offset];
    const result = await pool.query(paginatedQuery, paginatedParams);

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalItems / pageSize);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    return {
      data: result.rows,
      pagination: {
        currentPage: page,
        pageSize: pageSize,
        totalItems: totalItems,
        totalPages: totalPages,
        hasNextPage: hasNextPage,
        hasPrevPage: hasPrevPage,
      },
    };
  } catch (err) {
    // throw err;
    res.status(500).json({ error: "Error fetching paginated results" });
  }
};

//Get files
const getAllFiles = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const page = req.query.page || 1;
    const pageSize = req.query.pageSize || 10;

    let query;
    let params = [];

    if (req.user.role === "admin") {
      // Admin can see all files
      query = "SELECT * FROM files ORDER BY id DESC";
    } else {
      // Regular user sees only their files
      query = "SELECT * FROM files WHERE user_id=$1 ORDER BY id DESC";
      params.push(req.user.id);
    }

    const result = await getPaginatedResults(query, params, page, pageSize);
    res.status(200).json(result);
  } catch (err) {
    console.error("❌ Error fetching files:", err);
    res.status(500).json({ error: "Error fetching files" });
  }
};

//Search files by name and apply filters
const searchFiles = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { search, fileType, startDate, endDate } = req.query;
    let query = "SELECT * FROM files WHERE 1=1";
    let params = [];
    let paramCount = 1;

    // Add user filter (non-admin users only see their files)
    if (req.user.role !== "admin") {
      query += ` AND user_id = $${paramCount}`;
      params.push(req.user.id);
      paramCount++;
    }

    // Add search filter by file name
    if (search && search.trim()) {
      query += ` AND original_name ILIKE $${paramCount}`;
      params.push(`%${search.trim()}%`);
      paramCount++;
    }

    // Add file type filter
    if (fileType && fileType.trim()) {
      query += ` AND file_type ILIKE $${paramCount}`;
      params.push(`%${fileType.trim()}%`);
      paramCount++;
    }

    // Add date range filter
    if (startDate) {
      query += ` AND uploaded_at >= $${paramCount}`;
      params.push(new Date(startDate));
      paramCount++;
    }

    if (endDate) {
      // Add one day to include the entire end date
      const endDatePluOne = new Date(endDate);
      endDatePluOne.setDate(endDatePluOne.getDate() + 1);
      query += ` AND uploaded_at < $${paramCount}`;
      params.push(endDatePluOne);
      paramCount++;
    }

    query += " ORDER BY uploaded_at DESC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error searching files:", err);
    res.status(500).json({ error: "Error searching files" });
  }
};

//Get files by id
const getFile = async (req, res) => {
  try {
    if (!req.user || !req.user.id) return res.status(401).json({ message: "Unauthorized" });

    const fileId = parseInt(req.query.id);
    if (isNaN(fileId)) {
      return res.status(400).json({ message: "Invalid file ID" });
    }

    let result;
    if (req.user.role === "admin") {
      result = await pool.query("SELECT * FROM files WHERE id=$1", [fileId]);
    } else {
      result = await pool.query("SELECT * FROM files WHERE id=$1 AND user_id=$2", [fileId, req.user.id]);
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "File not found" });
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error("❌ Error fetching file:", err);
    res.status(500).json({ message: "Something went wrong" });
  }
};

//Delete files by id
const deleteFile = async (req, res) => {
  try {
    if (!req.user || !req.user.id) return res.status(401).json({ message: "Unauthorized" });

    const fileId = parseInt(req.query.id);
    if (isNaN(fileId)) return res.status(400).json({ message: 'Invalid file ID' });

    let result;
    if (req.user.role === "admin") {
      result = await pool.query("DELETE FROM files WHERE id=$1", [fileId]);
    } else {
      result = await pool.query("DELETE FROM files WHERE id=$1 AND user_id=$2 RETURNING *", [fileId, req.user.id]);
    }

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "File not found or not authorized" });
    }

    const file = result.rows[0];

    // Delete from S3
    const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
    const s3Config = require("../s3Config");

    const command = new DeleteObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: file.upload_path,
    });

    try {
      await s3Config.send(command);
    } catch (s3Err) {
      console.error("❌ Error deleting file from S3:", s3Err);
      // Optionally continue to delete from DB or return error
    }

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "File not found or not authorized" });
    }

    res.json({ message: "File deleted successfully" });
  } catch (err) {
    console.error("❌ Error deleting file:", err);
    res.status(500).json({ message: "Something went wrong" });
  }
}

//Download Files
const downloadFile = async (req, res) => {
  try {
    if (!req.user || !req.user.id) return res.status(401).json({ message: "Unauthorized" });

    const fileId = parseInt(req.query.id);
    const isPreview = req.query.preview === 'true'; // Check for preview flag

    if (isNaN(fileId)) return res.status(400).json({ message: 'Invalid file ID' });

    // 1️⃣ Find file info from DB
    let result;
    if (req.user.role === "admin") {
      result = await pool.query("SELECT * FROM files WHERE id=$1", [fileId]);
    } else {
      result = await pool.query("SELECT * FROM files WHERE id=$1 AND user_id=$2", [fileId, req.user.id]);
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "File not found" });
    }

    const file = result.rows[0];

    // 3️⃣ Get file from S3 (Support Range Request for Video/Audio)
    const { GetObjectCommand } = require("@aws-sdk/client-s3");
    const s3Config = require("../s3Config");

    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: file.upload_path,
    };

    // Forward Range header if present
    if (req.headers.range) {
      params.Range = req.headers.range;
    }

    const command = new GetObjectCommand(params);
    const response = await s3Config.send(command);

    // Set headers
    res.setHeader('Content-Type', file.file_type || 'application/octet-stream');

    // Inline for preview, Attachment for download
    if (isPreview) {
      res.setHeader('Content-Disposition', `inline; filename="${file.original_name}"`);
    } else {
      res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
    }

    // Handle Partial Content (206)
    if (response.ContentRange) {
      res.status(206);
      res.setHeader('Content-Range', response.ContentRange);
      res.setHeader('Content-Length', response.ContentLength);
      res.setHeader('Accept-Ranges', 'bytes');
    } else {
      res.setHeader('Content-Length', response.ContentLength);
    }

    // Stream the file
    response.Body.pipe(res);
  }
  catch (err) {
    console.error("❌ Error downloading files:", err);
    res.status(500).json({ message: "Something went wrong" });
  }
}

//Update file name by id
const updateFileName = async (req, res) => {
  try {
    if (!req.user || !req.user.id) return res.status(401).json({ message: "Unauthorized" });

    const fileId = parseInt(req.params.id);
    const fileName = req.body.file_name?.trim();

    if (!fileId || isNaN(fileId)) {
      return res.status(400).json({ message: 'Invalid file ID' });
    }

    if (!fileName) {
      return res.status(400).json({ message: 'New name required' });
    }

    let result;
    if (req.user.role === "admin") {
      result = await pool.query(
        `UPDATE files SET original_name = $1 WHERE id = $2`,
        [fileName, fileId]
      );
    } else {
      result = await pool.query(
        `UPDATE files SET original_name = $1 WHERE id = $2 AND user_id = $3`,
        [fileName, fileId, req.user.id]
      );
    }

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'File not found or not authorized' });
    }
    res.status(200).json({ message: 'File name updated successfully' });
  } catch (err) {
    console.error('❌ Error updating file name:', err);
    res.status(500).json({ message: 'Something went wrong' });
  }
}

module.exports = { upload, processExcelFile, fileUpload, getAllFiles, searchFiles, getFile, deleteFile, downloadFile, updateFileName, getPaginatedResults };