const pool = require("../db");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcryptjs");
const { GetObjectCommand } = require("@aws-sdk/client-s3");
const s3Config = require("../s3Config");

// Generate a Share Link
const generateLink = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const { fileId, folderId, expiresAt, password } = req.body;

        if (!fileId && !folderId) {
            return res.status(400).json({ error: "Must share a file or a folder" });
        }

        if (fileId && folderId) {
            return res.status(400).json({ error: "Cannot share both file and folder at once" });
        }

        // Verify ownership
        let resource;
        if (fileId) {
            resource = await pool.query("SELECT owner_id FROM files WHERE id = $1", [fileId]);
        } else {
            resource = await pool.query("SELECT owner_id FROM folders WHERE id = $1", [folderId]);
        }

        if (resource.rows.length === 0) {
            return res.status(404).json({ error: "Resource not found" });
        }

        // Allow admin uses to share anything? for now restrict to owner
        /* if (req.user.role !== 'admin' && resource.rows[0].owner_id !== req.user.id) ... */
        // Logic from file-upload usually checks owner_id or admin
        /* Assuming simple owner check */
        if (req.user.role !== "admin" && resource.rows[0].owner_id !== req.user.id) {
            // Small adjustment: file table usually has user_id, folder has owner_id. 
            // Let's check db schema quickly if needed. file-upload.js uses user_id for files.
            // folders.js uses owner_id.
            // Let's correct this.
        }

        // Check ownership specifically for file vs folder
        if (fileId) {
            // Files table uses user_id
            const fileCheck = await pool.query("SELECT user_id FROM files WHERE id = $1", [fileId]);
            if (fileCheck.rows.length === 0) return res.status(404).json({ error: "File not found" });
            if (req.user.role !== "admin" && fileCheck.rows[0].user_id !== req.user.id) {
                return res.status(403).json({ error: "Access denied" });
            }
        } else {
            // Folders table uses owner_id
            const folderCheck = await pool.query("SELECT owner_id FROM folders WHERE id = $1", [folderId]);
            if (folderCheck.rows.length === 0) return res.status(404).json({ error: "Folder not found" });
            if (req.user.role !== "admin" && folderCheck.rows[0].owner_id !== req.user.id) {
                return res.status(403).json({ error: "Access denied" });
            }
        }


        const token = uuidv4();
        let passwordHash = null;
        let isPublic = true;

        if (password && password.trim()) {
            passwordHash = await bcrypt.hash(password, 10);
            isPublic = false;
        }

        const result = await pool.query(
            `INSERT INTO shared_links 
       (file_id, folder_id, token, expires_at, password_hash, is_public, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING token, expires_at, is_public`,
            [
                fileId || null,
                folderId || null,
                token,
                expiresAt || null,
                passwordHash,
                isPublic,
                req.user.id,
            ]
        );

        res.status(201).json({
            message: "Share link created",
            link: `${process.env.FRONTEND_URL}/share/${token}`,
            data: result.rows[0],
        });
    } catch (err) {
        console.error("❌ Error generating link:", err);
        res.status(500).json({ error: "Error generating link" });
    }
};

// Get Link Info (Check if valid/protected)
const getLinkInfo = async (req, res) => {
    try {
        const { token } = req.params;

        const query = `
      SELECT s.*,
            f.original_name as file_name, f.file_type, f.file_size,
            fo.name as folder_name
      FROM shared_links s
      LEFT JOIN files f ON s.file_id = f.id
      LEFT JOIN folders fo ON s.folder_id = fo.id
      WHERE s.token = $1
            `;
        const result = await pool.query(query, [token]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Link not found" });
        }

        const link = result.rows[0];

        // Check expiration
        if (link.expires_at && new Date() > new Date(link.expires_at)) {
            return res.status(410).json({ error: "Link expired" });
        }

        // Return public info
        res.json({
            token: link.token,
            isProtected: !link.is_public,
            type: link.file_id ? "file" : "folder",
            name: link.file_name || link.folder_name,
            expiresAt: link.expires_at,
        });
    } catch (err) {
        console.error("❌ Error fetching link info:", err);
        res.status(500).json({ error: "Error fetching link info" });
    }
};

// Access Link (Download/View)
const accessLink = async (req, res) => {
    try {
        const { token } = req.params;
        const { password } = req.body;
        const isPreview = req.query.preview === 'true';

        const query = `
      SELECT s.*,
            f.original_name, f.stored_name, f.file_type, f.upload_path,
            fo.name as folder_name
      FROM shared_links s
      LEFT JOIN files f ON s.file_id = f.id
      LEFT JOIN folders fo ON s.folder_id = fo.id
      WHERE s.token = $1
            `;

        const result = await pool.query(query, [token]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Link not found" });
        }

        const link = result.rows[0];

        // Check expiration
        if (link.expires_at && new Date() > new Date(link.expires_at)) {
            return res.status(410).json({ error: "Link expired" });
        }

        // Check password if not public
        if (!link.is_public) {
            // Allow password to be passed in query param for GET requests (video streaming)
            const pwd = password || req.query.password;

            if (!pwd) {
                return res.status(401).json({ error: "Password required" });
            }
            const isMatch = await bcrypt.compare(pwd, link.password_hash);
            if (!isMatch) {
                return res.status(401).json({ error: "Incorrect password" });
            }
        }

        // If File -> Stream Download
        if (link.file_id) {
            const params = {
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: link.upload_path,
            };

            if (req.headers.range) {
                params.Range = req.headers.range;
            }

            const command = new GetObjectCommand(params);
            const response = await s3Config.send(command);

            res.setHeader("Content-Type", link.file_type || "application/octet-stream");

            if (isPreview) {
                res.setHeader("Content-Disposition", `inline; filename="${link.original_name}"`);
            } else {
                res.setHeader(
                    "Content-Disposition",
                    `attachment; filename="${link.original_name}"`
                );
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

            return response.Body.pipe(res);
        }

        // If Folder -> Return Contents
        if (link.folder_id) {
            // Determine which folder to show (root shared folder or subfolder)
            // For MVP, just show root shared folder contents

            const subfolders = await pool.query(
                "SELECT id, name, created_at FROM folders WHERE parent_id = $1 ORDER BY name",
                [link.folder_id]
            );

            const files = await pool.query(
                "SELECT id, original_name, file_type, file_size, uploaded_at FROM files WHERE folder_id = $1 ORDER BY id DESC",
                [link.folder_id]
            );

            return res.json({
                type: "folder",
                name: link.folder_name,
                folders: subfolders.rows,
                files: files.rows,
            });
        }

        res.status(400).json({ error: "Invalid share link type" });

    } catch (err) {
        console.error("❌ Error accessing link:", err);
        res.status(500).json({ error: "Error accessing link" });
    }
};

module.exports = { generateLink, getLinkInfo, accessLink };
