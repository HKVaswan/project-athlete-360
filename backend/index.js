const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

// Create a new Pool instance to connect to the database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// A function to connect to the database and ensure the table exists
const initializeDatabase = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS athletes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL
      );
    `);
    console.log('Athletes table ensured to exist.');
  } catch (err) {
    console.error('Error initializing database:', err);
  }
};

// Call the initialization function when the app starts
initializeDatabase();

app.get('/api/athletes', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name FROM athletes;');
    // If the table is empty, we will insert some sample data for demonstration
    if (rows.length === 0) {
      await pool.query("INSERT INTO athletes (name) VALUES ('Sample Athlete 1'), ('Sample Athlete 2'), ('Sample Athlete 3');");
      const { rows: updatedRows } = await pool.query('SELECT id, name FROM athletes;');
      res.json(updatedRows);
    } else {
      res.json(rows);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An error occurred fetching athletes." });
  }
});

// A placeholder API endpoint for the root URL
app.get('/', (req, res) => {
  res.send('Backend is running!');
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
