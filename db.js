const { Pool } = require("pg");

const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "File_Management_System_Test",
  password: "Wbcuser_1",
  port: "5432",
});

pool.connect((err, client, release) => {
  if (err) {
    console.error("error connecting to db", err.stack);
  } else {
    console.log("Connecting to db");
    release();
  }
});

module.exports = pool;
