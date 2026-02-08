const pool = require("../db");
const path = require("path");

// ✅ Create folder
const createFolder = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { name, parentId } = req.body;
    const ownerId = req.user.id;

    if (!name || name.trim() === "") {
      return res.status(400).json({ error: "Folder name is required" });
    }

    // Sanitize folder name (no path traversal)
    const sanitizedName = path.basename(name.trim());

    // Check if parent folder exists and user has access
    if (parentId) {
      const parentFolder = await pool.query(
        "SELECT id, owner_id FROM folders WHERE id = $1",
        [parentId]
      );
      if (parentFolder.rows.length === 0) {
        return res.status(404).json({ error: "Parent folder not found" });
      }
      // Check ownership (allow admin or owner)
      if (req.user.role !== "admin" && parentFolder.rows[0].owner_id !== ownerId) {
        return res.status(403).json({ error: "Access denied" });
      }
    }

    const result = await pool.query(
      `INSERT INTO folders (name, owner_id, parent_id) 
       VALUES ($1, $2, $3) 
       RETURNING id, name, owner_id, parent_id, created_at`,
      [sanitizedName, ownerId, parentId || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("❌ Error creating folder:", err);
    res.status(500).json({ error: "Error creating folder" });
  }
};

// ✅ Get folder contents (subfolders + files)
const getFolderContents = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const folderId = req.params.id ? parseInt(req.params.id) : null;

    // If folderId provided, verify user has access
    if (folderId) {
      const folder = await pool.query(
        "SELECT id, owner_id FROM folders WHERE id = $1",
        [folderId]
      );
      if (folder.rows.length === 0) {
        return res.status(404).json({ error: "Folder not found" });
      }
      // Allow admin or folder owner
      if (req.user.role !== "admin" && folder.rows[0].owner_id !== req.user.id) {
        return res.status(403).json({ error: "Access denied" });
      }
    }

    // Get subfolders
    const subfolders = await pool.query(
      "SELECT id, name, owner_id, parent_id, created_at FROM folders WHERE parent_id IS NOT DISTINCT FROM $1 ORDER BY name",
      [folderId]
    );

    // Get files in folder
    let files;
    if (req.user.role === "admin") {
      // Admin sees all files in this folder
      files = await pool.query(
        "SELECT * FROM files WHERE folder_id IS NOT DISTINCT FROM $1 ORDER BY id DESC",
        [folderId]
      );
    } else {
      // User sees only their files
      files = await pool.query(
        "SELECT * FROM files WHERE folder_id IS NOT DISTINCT FROM $1 AND user_id = $2 ORDER BY id DESC",
        [folderId, req.user.id]
      );
    }

    res.json({
      folders: subfolders.rows,
      files: files.rows,
    });
  } catch (err) {
    console.error("❌ Error fetching folder contents:", err);
    res.status(500).json({ message: "Error fetching folder contents" });
  }
};

// ✅ Get folder info
const getFolder = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const folderId = parseInt(req.params.id);

    const result = await pool.query(
      "SELECT id, name, owner_id, parent_id, created_at FROM folders WHERE id = $1",
      [folderId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Folder not found" });
    }

    const folder = result.rows[0];

    // Check access
    if (req.user.role !== "admin" && folder.owner_id !== req.user.id) {
      return res.status(403).json({ error: "Access denied" });
    }

    res.json(folder);
  } catch (err) {
    console.error("❌ Error fetching folder:", err);
    res.status(500).json({ error: "Error fetching folder" });
  }
};

// ✅ Rename folder
const renameFolder = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const folderId = parseInt(req.params.id);
    const { name } = req.body;

    if (!name || name.trim() === "") {
      return res.status(400).json({ error: "Folder name is required" });
    }

    const sanitizedName = path.basename(name.trim());

    // Check ownership
    const folder = await pool.query("SELECT owner_id FROM folders WHERE id = $1", [folderId]);
    if (folder.rows.length === 0) {
      return res.status(404).json({ error: "Folder not found" });
    }

    if (req.user.role !== "admin" && folder.rows[0].owner_id !== req.user.id) {
      return res.status(403).json({ error: "Access denied" });
    }

    const result = await pool.query(
      "UPDATE folders SET name = $1, updated_at = now() WHERE id = $2 RETURNING *",
      [sanitizedName, folderId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("❌ Error renaming folder:", err);
    res.status(500).json({ error: "Error renaming folder" });
  }
};

// ✅ Move folder (change parent)
const moveFolder = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const folderId = parseInt(req.params.id);
    const { parentId } = req.body;

    // Check if moving to itself (prevent circular reference)
    if (parentId === folderId) {
      return res.status(400).json({ error: "Cannot move folder to itself" });
    }

    // Check ownership of source folder
    const folder = await pool.query("SELECT owner_id FROM folders WHERE id = $1", [folderId]);
    if (folder.rows.length === 0) {
      return res.status(404).json({ error: "Folder not found" });
    }

    if (req.user.role !== "admin" && folder.rows[0].owner_id !== req.user.id) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Validate parent folder if provided
    if (parentId) {
      const parentFolder = await pool.query(
        "SELECT owner_id FROM folders WHERE id = $1",
        [parentId]
      );
      if (parentFolder.rows.length === 0) {
        return res.status(404).json({ error: "Parent folder not found" });
      }
      if (req.user.role !== "admin" && parentFolder.rows[0].owner_id !== req.user.id) {
        return res.status(403).json({ error: "Cannot move to folder you don't own" });
      }
    }

    const result = await pool.query(
      "UPDATE folders SET parent_id = $1, updated_at = now() WHERE id = $2 RETURNING *",
      [parentId || null, folderId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("❌ Error moving folder:", err);
    res.status(500).json({ error: "Error moving folder" });
  }
};

// ✅ Delete folder (recursive - deletes subfolders and files)
const deleteFolder = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const folderId = parseInt(req.params.id);
    const fs = require("fs");

    // Check ownership
    const folder = await pool.query("SELECT owner_id FROM folders WHERE id = $1", [folderId]);
    if (folder.rows.length === 0) {
      return res.status(404).json({ error: "Folder not found" });
    }

    if (req.user.role !== "admin" && folder.rows[0].owner_id !== req.user.id) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Get all files in this folder and subfolders (recursive)
    const getFilesInFolder = async (id) => {
      const result = await pool.query(
        "SELECT id, upload_path FROM files WHERE folder_id = $1",
        [id]
      );
      const subfolders = await pool.query("SELECT id FROM folders WHERE parent_id = $1", [id]);

      let allFiles = result.rows;
      for (const subfolder of subfolders.rows) {
        allFiles = allFiles.concat(await getFilesInFolder(subfolder.id));
      }
      return allFiles;
    };

    const filesToDelete = await getFilesInFolder(folderId);

    // Delete files from S3
    if (filesToDelete.length > 0) {
      const { DeleteObjectsCommand } = require("@aws-sdk/client-s3");
      const s3Config = require("../s3Config");

      const objectsToDelete = filesToDelete.map(file => ({ Key: file.upload_path }));

      const command = new DeleteObjectsCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Delete: {
          Objects: objectsToDelete,
        },
      });

      try {
        await s3Config.send(command);
      } catch (s3Err) {
        console.error("❌ Error deleting files from S3:", s3Err);
        // Continue to delete from DB even if S3 fails (or handle as needed)
      }
    }

    // Delete folder and cascade (DB handles via ON DELETE CASCADE)
    await pool.query("DELETE FROM folders WHERE id = $1", [folderId]);

    res.json({ message: "Folder deleted successfully" });
  } catch (err) {
    console.error("❌ Error deleting folder:", err);
    res.status(500).json({ error: "Error deleting folder" });
  }
};

// ✅ Get root folders (user's top-level folders)
const getRootFolders = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    let result;
    if (req.user.role === "admin") {
      // Admin sees all root folders
      result = await pool.query(
        "SELECT id, name, owner_id, parent_id, created_at FROM folders WHERE parent_id IS NULL ORDER BY name"
      );
    } else {
      // User sees only their root folders
      result = await pool.query(
        "SELECT id, name, owner_id, parent_id, created_at FROM folders WHERE parent_id IS NULL AND owner_id = $1 ORDER BY name",
        [req.user.id]
      );
    }

    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching root folders:", err);
    res.status(500).json({ error: "Error fetching root folders" });
  }
};

module.exports = {
  createFolder,
  getFolderContents,
  getFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
  getRootFolders,
};
