import mysql from "mysql2";
import dotenv from "dotenv";

dotenv.config();

const con = mysql.createConnection({
  host: process.env.MYSQLHOST,
  port: process.env.MYSQLPORT,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
});

con.connect((error) => {
  if (error) {
    console.log("❌ Connection error:", error);
  } else {
    console.log("✅ Connected to the MySQL database!");
  }
});

con.query('SHOW TABLES', (err, results) => {
  if (err) {
    console.log('❌ Error:', err);
  } else {
    console.log('✅ Tables:', results);
  }
});

export default con;