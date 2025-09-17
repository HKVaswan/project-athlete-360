const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

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

initializeDatabase();

// GET endpoint to fetch all athletes
app.get('/api/athletes', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name FROM athletes;');
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

// POST endpoint to create a new athlete
app.post('/api/athletes', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Athlete name is required.' });
    }
    const result = await pool.query(
      'INSERT INTO athletes (name) VALUES ($1) RETURNING *',
      [name]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An error occurred creating the athlete." });
  }
});

// DELETE endpoint to delete an athlete by ID
app.delete('/api/athletes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM athletes WHERE id = $1 RETURNING *', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Athlete not found." });
    }
    res.status(200).json({ message: "Athlete deleted successfully." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An error occurred deleting the athlete." });
  }
});

// New PUT endpoint to update an athlete by ID
app.put('/api/athletes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'New athlete name is required.' });
    }
    const result = await pool.query(
      'UPDATE athletes SET name = $1 WHERE id = $2 RETURNING *',
      [name, id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Athlete not found." });
    }
    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An error occurred updating the athlete." });
  }
});

app.get('/', (req, res) => {
  res.send('Backend is running!');
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
