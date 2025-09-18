const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// JWT Secret Key (MUST BE SET IN ENVIRONMENT)
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL ERROR: JWT_SECRET is not defined. Please set this environment variable.');
  process.exit(1);
}

// PostgreSQL Connection Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// --- Database Schema Overhaul ---
const initializeDatabase = async () => {
  try {
    // Users table with a 'role' column
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'athlete'
      );
    `);
    console.log('Users table ensured to exist.');

    // Athletes table with a link to the users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS athletes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        athlete_id VARCHAR(255) UNIQUE,
        dob DATE,
        sport VARCHAR(100),
        gender VARCHAR(20),
        contact_info VARCHAR(255)
      );
    `);
    console.log('Athletes table ensured to exist.');

    // Training sessions table using integer athlete_id as foreign key
    await pool.query(`
      CREATE TABLE IF NOT EXISTS training_sessions (
        id SERIAL PRIMARY KEY,
        athlete_id INTEGER REFERENCES athletes(id) ON DELETE CASCADE,
        session_date TIMESTAMP NOT NULL DEFAULT NOW(),
        notes TEXT
      );
    `);
    console.log('Training_sessions table ensured to exist.');

    // Performance metrics table using integer athlete_id as foreign key
    await pool.query(`
      CREATE TABLE IF NOT EXISTS performance_metrics (
        id SERIAL PRIMARY KEY,
        athlete_id INTEGER REFERENCES athletes(id) ON DELETE CASCADE,
        metric_name VARCHAR(255) NOT NULL,
        metric_value VARCHAR(255) NOT NULL,
        entry_date TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    console.log('Performance_metrics table ensured to exist.');

  } catch (err) {
    console.error('Error initializing database:', err);
  }
};

initializeDatabase();

// --- Middleware for JWT Authentication and Authorization ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token == null) {
    return res.status(401).json({ error: 'Authentication token required.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token.' });
    }
    req.user = user;
    next();
  });
};

const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Permission denied.' });
    }
    next();
  };
};

// --- Authentication Endpoints ---

// Login endpoint (now returns a JWT token)
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    const user = userResult.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const token = jwt.sign({ userId: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
    res.status(200).json({ message: 'Login successful', token, role: user.role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An error occurred during login." });
  }
});

// Register endpoint (now includes a role for future RBAC)
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Default role to 'athlete' if not provided
    const userRole = role || 'athlete';
    
    const newUserResult = await pool.query(
      'INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, role',
      [username, hashedPassword, userRole]
    );

    res.status(201).json({ message: 'User created successfully', user: newUserResult.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An error occurred during registration." });
  }
});

// --- Protected Endpoints for Athlete Management ---
app.post('/api/athletes', authenticateToken, authorizeRoles('coach', 'admin'), async (req, res) => {
  try {
    const { user_id, name, athlete_id, dob, sport, gender, contact_info } = req.body;
    const newAthleteResult = await pool.query(
      'INSERT INTO athletes (user_id, name, athlete_id, dob, sport, gender, contact_info) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [user_id, name, athlete_id, dob, sport, gender, contact_info]
    );
    res.status(201).json(newAthleteResult.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An error occurred creating the athlete." });
  }
});

app.get('/api/athletes', authenticateToken, async (req, res) => {
  try {
    // Only fetch athletes associated with the logged-in user or all for a coach/admin
    if (req.user.role === 'coach' || req.user.role === 'admin') {
        const { rows } = await pool.query('SELECT * FROM athletes;');
        res.json(rows);
    } else if (req.user.role === 'athlete') {
        const { rows } = await pool.query('SELECT * FROM athletes WHERE user_id = $1', [req.user.userId]);
        res.json(rows);
    } else {
        res.status(403).json({ error: 'Permission denied.' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An error occurred fetching athletes." });
  }
});

app.put('/api/athletes/:id', authenticateToken, authorizeRoles('coach', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, athlete_id, dob, sport, gender, contact_info } = req.body;
    const updateResult = await pool.query(
      'UPDATE athletes SET name = $1, athlete_id = $2, dob = $3, sport = $4, gender = $5, contact_info = $6 WHERE id = $7 RETURNING *',
      [name, athlete_id, dob, sport, gender, contact_info, id]
    );
    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: "Athlete not found." });
    }
    res.status(200).json(updateResult.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An error occurred updating the athlete." });
  }
});

app.delete('/api/athletes/:id', authenticateToken, authorizeRoles('coach', 'admin'), async (req, res) => {
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

// --- Protected Endpoints for Training Sessions ---
app.post('/api/training-sessions', authenticateToken, authorizeRoles('coach', 'admin'), async (req, res) => {
  try {
    const { athlete_id, notes } = req.body;
    const result = await pool.query(
      'INSERT INTO training_sessions (athlete_id, notes) VALUES ($1, $2) RETURNING *',
      [athlete_id, notes]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An error occurred creating the training session." });
  }
});

app.get('/api/training-sessions/:athleteId', authenticateToken, async (req, res) => {
  try {
    const { athleteId } = req.params;
    const athleteResult = await pool.query('SELECT user_id FROM athletes WHERE id = $1', [athleteId]);
    if (athleteResult.rows.length === 0) {
      return res.status(404).json({ error: "Athlete not found." });
    }
    const athleteUserId = athleteResult.rows[0].user_id;

    // Check if the user is a coach/admin or if they are the athlete themselves
    if (req.user.role === 'coach' || req.user.role === 'admin' || req.user.userId === athleteUserId) {
      const { rows } = await pool.query(
        'SELECT session_date, notes FROM training_sessions WHERE athlete_id = $1 ORDER BY session_date DESC',
        [athleteId]
      );
      res.json(rows);
    } else {
      res.status(403).json({ error: 'Permission denied.' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An error occurred fetching training sessions." });
  }
});

app.put('/api/training-sessions/:id', authenticateToken, authorizeRoles('coach', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const result = await pool.query(
      'UPDATE training_sessions SET notes = $1 WHERE id = $2 RETURNING *',
      [notes, id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Training session not found." });
    }
    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An error occurred updating the training session." });
  }
});

app.delete('/api/training-sessions/:id', authenticateToken, authorizeRoles('coach', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM training_sessions WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Training session not found." });
    }
    res.status(200).json({ message: "Training session deleted successfully." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An error occurred deleting the training session." });
  }
});

// --- Protected Endpoints for Performance Metrics ---
app.post('/api/performance-metrics', authenticateToken, authorizeRoles('coach', 'admin'), async (req, res) => {
  try {
    const { athlete_id, metric_name, metric_value } = req.body;
    const result = await pool.query(
      'INSERT INTO performance_metrics (athlete_id, metric_name, metric_value) VALUES ($1, $2, $3) RETURNING *',
      [athlete_id, metric_name, metric_value]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An error occurred creating the performance metric." });
  }
});

app.get('/api/performance-metrics/:athleteId', authenticateToken, async (req, res) => {
  try {
    const { athleteId } = req.params;
    const athleteResult = await pool.query('SELECT user_id FROM athletes WHERE id = $1', [athleteId]);
    if (athleteResult.rows.length === 0) {
      return res.status(404).json({ error: "Athlete not found." });
    }
    const athleteUserId = athleteResult.rows[0].user_id;

    // Check if the user is a coach/admin or if they are the athlete themselves
    if (req.user.role === 'coach' || req.user.role === 'admin' || req.user.userId === athleteUserId) {
      const { rows } = await pool.query(
        'SELECT entry_date, metric_name, metric_value FROM performance_metrics WHERE athlete_id = $1 ORDER BY entry_date DESC',
        [athleteId]
      );
      res.json(rows);
    } else {
      res.status(403).json({ error: 'Permission denied.' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An error occurred fetching performance metrics." });
  }
});

app.put('/api/performance-metrics/:id', authenticateToken, authorizeRoles('coach', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { metric_name, metric_value } = req.body;
    const result = await pool.query(
      'UPDATE performance_metrics SET metric_name = $1, metric_value = $2 WHERE id = $3 RETURNING *',
      [metric_name, metric_value, id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Performance metric not found." });
    }
    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An error occurred updating the performance metric." });
  }
});

app.delete('/api/performance-metrics/:id', authenticateToken, authorizeRoles('coach', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM performance_metrics WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Performance metric not found." });
    }
    res.status(200).json({ message: "Performance metric deleted successfully." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An error occurred deleting the performance metric." });
  }
});


app.get('/', (req, res) => {
  res.send('Backend is running!');
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
