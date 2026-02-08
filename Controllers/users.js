const pool = require("../db");

const getUserById = async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const result = await pool.query("SELECT id, name, email, role FROM users WHERE id = $1", [userId]);
        console.log(result.rows.length)
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }
        res.status(200).json(result.rows[0]);
    }
    catch (err) {
        res.status(500).json({ message: "Error fetching user" });
    }
}

module.exports = { getUserById };