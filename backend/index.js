const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const app = express();
const port = process.env.env || 3000;

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
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL
      );
    `);
    console.log('Users table ensured to exist.');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS athletes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        athlete_id VARCHAR(255) UNIQUE
      );
    `);
    console.log('Athletes table ensured to exist.');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS training_sessions (
        id SERIAL PRIMARY KEY,
        athlete_id VARCHAR(255) REFERENCES athletes(athlete_id) ON DELETE CASCADE,
        session_date TIMESTAMP NOT NULL DEFAULT NOW(),
        notes TEXT
      );
    `);
    console.log('Training_sessions table ensured to exist.');

  } catch (err) {
    console.error('Error initializing database:', err);
  }
};

initializeDatabase();

// Login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await pool.query('SELECT * FROM users WHERE username = $1', [username]);

    if (user.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const validPassword = await bcrypt.compare(password, user.rows[0].password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    res.status(200).json({ message: 'Login successful' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An error occurred during login." });
  }
});

// Register endpoint
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const newUser = await pool.query(
      'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING *',
      [username, hashedPassword]
    );

    res.status(201).json({ message: 'User created successfully', user: newUser.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An error occurred during registration." });
  }
});

// All previous API endpoints for athletes
app.get('/api/athletes', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, athlete_id FROM athletes;');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An error occurred fetching athletes." });
  }
});

app.post('/api/athletes', async (req, res) => {
  try {
    const { name, athlete_id } = req.body;
    if (!name || !athlete_id) {
      return res.status(400).json({ error: 'Athlete name and ID are required.' });
    }
    const result = await pool.query(
      'INSERT INTO athletes (name, athlete_id) VALUES ($1, $2) RETURNING *',
      [name, athlete_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An error occurred creating the athlete." });
  }
});

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

app.put('/api/athletes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, athlete_id } = req.body;
    if (!name || !athlete_id) {
      return res.status(400).json({ error: 'New athlete name and ID are required.' });
    }
    const result = await pool.query(
      'UPDATE athletes SET name = $1, athlete_id = $2 WHERE id = $3 RETURNING *',
      [name, athlete_id, id]
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

// New endpoint to create a new training session
app.post('/api/training-sessions', async (req, res) => {
  try {
    const { athlete_id, session_date, notes } = req.body;
    if (!athlete_id) {
      return res.status(400).json({ error: 'Athlete ID is required.' });
    }
    const result = await pool.query(
      'INSERT INTO training_sessions (athlete_id, session_date, notes) VALUES ($1, $2, $3) RETURNING *',
      [athlete_id, session_date, notes]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An error occurred creating the training session." });
  }
});

app.get('/', (req, res) => {
  res.send('Backend is running!');
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
