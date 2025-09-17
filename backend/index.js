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

app.get('/api/athletes', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name FROM athletes;');
    res.json(rows);
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
