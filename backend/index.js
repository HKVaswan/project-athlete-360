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

    // Add indexes for performance
    await pool.query('CREATE INDEX IF NOT EXISTS idx_training_sessions_athlete_id ON training_sessions(athlete_id);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_performance_metrics_athlete_id ON performance_metrics(athlete_id);');
    console.log('Database indexes ensured to exist.');

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
    return res.status(401).json({ success: false, message: 'Authentication token required.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
    }
    req.user = user;
    next();
  });
};

const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Permission denied.' });
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
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }
    const user = userResult.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }

    const token = jwt.sign({ userId: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
    const decodedToken = jwt.decode(token);
    const exp = decodedToken.exp * 1000;
    
    res.status(200).json({ success: true, message: 'Login successful', data: { token, role: user.role, userId: user.id, exp } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "An error occurred during login." });
  }
});

// Register endpoint (now handles both user and athlete creation)
app.post('/api/register', async (req, res) => {
  const client = await pool.connect();
  try {
    const { username, password, name, dob, sport, gender, contact_info, role } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }
    
    const token = req.headers['authorization']?.split(' ')[1];
    let userRole = 'athlete'; // Default role is athlete

    // Check if an admin is creating the user
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role === 'admin' && ['athlete', 'coach', 'admin'].includes(role)) {
          userRole = role; // Assign the specified role
        }
      } catch (err) {
        // Invalid token, continue with default 'athlete' role.
        console.error('Invalid token for role assignment, defaulting to athlete role.');
      }
    }

    // Begin transaction
    await client.query('BEGIN');

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const userInsertResult = await client.query(
      'INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, role',
      [username, hashedPassword, userRole]
    );

    const newUserId = userInsertResult.rows[0].id;

    if (userRole === 'athlete') {
      if (!name || !dob || !sport || !gender || !contact_info) {
        throw new Error('All athlete profile fields are required for this role.');
      }
      const athleteInsertResult = await client.query(
        'INSERT INTO athletes (user_id, name, dob, sport, gender, contact_info) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [newUserId, name, dob, sport, gender, contact_info]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({ 
      success: true,
      message: 'User created successfully', 
      data: {
        user: userInsertResult.rows[0]
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ success: false, message: "An error occurred during registration." });
  } finally {
    client.release();
  }
});

// --- User Management Endpoints (Admin Only) ---
app.get('/api/users', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, role FROM users ORDER BY id ASC');
    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "An error occurred fetching users." });
  }
});

app.delete('/api/users/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;

    // Prevent deleting the logged-in admin user
    if (req.user.userId === parseInt(id, 10)) {
      return res.status(400).json({ success: false, message: "Cannot delete your own account." });
    }

    await client.query('BEGIN');
    
    // Deleting the user will automatically delete the linked athlete row due to ON DELETE CASCADE
    const result = await client.query('DELETE FROM users WHERE id = $1 RETURNING *', [id]);
    
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "User not found." });
    }

    await client.query('COMMIT');
    res.status(200).json({ success: true, message: "User deleted successfully." });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ success: false, message: "An error occurred deleting the user." });
  } finally {
    client.release();
  }
});


// --- Protected Endpoints for Athlete Management ---
app.post('/api/athletes', authenticateToken, authorizeRoles('coach', 'admin'), async (req, res) => {
  try {
    const { user_id, name, athlete_id, dob, sport, gender, contact_info } = req.body;
    // Security Fix: Do not allow user_id to be passed in body. It should be assigned by the system.
    const newAthleteResult = await pool.query(
      'INSERT INTO athletes (name, athlete_id, dob, sport, gender, contact_info) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [name, athlete_id, dob, sport, gender, contact_info]
    );
    res.status(201).json({ success: true, data: newAthleteResult.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "An error occurred creating the athlete." });
  }
});

app.get('/api/athletes', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const userId = req.query.userId;
    
    if (req.user.role === 'coach' || req.user.role === 'admin') {
      const { rows } = await pool.query('SELECT * FROM athletes LIMIT $1 OFFSET $2', [limit, offset]);
      res.status(200).json({ success: true, data: rows });
    } else if (req.user.role === 'athlete' && userId) {
      const { rows } = await pool.query('SELECT * FROM athletes WHERE user_id = $1 LIMIT $2 OFFSET $3', [userId, limit, offset]);
      res.status(200).json({ success: true, data: rows });
    } else {
      res.status(403).json({ success: false, message: 'Permission denied.' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "An error occurred fetching athletes." });
  }
});

app.get('/api/athletes/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const athleteResult = await pool.query('SELECT * FROM athletes WHERE id = $1', [id]);
    const athlete = athleteResult.rows[0];

    if (!athlete) {
      return res.status(404).json({ success: false, message: "Athlete not found." });
    }

    const isAuthorized = req.user.role === 'coach' || req.user.role === 'admin' || req.user.userId === athlete.user_id;
    if (!isAuthorized) {
      return res.status(403).json({ success: false, message: 'Permission denied.' });
    }

    const trainingSessionsResult = await pool.query('SELECT * FROM training_sessions WHERE athlete_id = $1 ORDER BY session_date DESC', [id]);
    const performanceMetricsResult = await pool.query('SELECT * FROM performance_metrics WHERE athlete_id = $1 ORDER BY entry_date DESC', [id]);
    
    res.status(200).json({
      success: true,
      data: {
        ...athlete,
        training_sessions: trainingSessionsResult.rows,
        performance_metrics: performanceMetricsResult.rows
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "An error occurred fetching the athlete profile." });
  }
});

app.put('/api/athletes/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (req.user.role === 'coach' || req.user.role === 'admin') {
      const { name, athlete_id, dob, sport, gender, contact_info } = req.body;
      const updateResult = await pool.query(
        'UPDATE athletes SET name = $1, athlete_id = $2, dob = $3, sport = $4, gender = $5, contact_info = $6 WHERE id = $7 RETURNING *',
        [name, athlete_id, dob, sport, gender, contact_info, id]
      );
      if (updateResult.rowCount === 0) {
        return res.status(404).json({ success: false, message: "Athlete not found." });
      }
      res.status(200).json({ success: true, message: "Athlete updated successfully", data: updateResult.rows[0] });
    } else if (req.user.role === 'athlete') {
      const { name, contact_info } = req.body;

      // Verify athlete is updating their own profile
      const athleteResult = await pool.query('SELECT user_id FROM athletes WHERE id = $1', [id]);
      if (athleteResult.rows.length === 0 || athleteResult.rows[0].user_id !== req.user.userId) {
        return res.status(403).json({ success: false, message: 'Permission denied.' });
      }

      const updateResult = await pool.query(
        'UPDATE athletes SET name = $1, contact_info = $2 WHERE id = $3 RETURNING *',
        [name, contact_info, id]
      );
      if (updateResult.rowCount === 0) {
        return res.status(404).json({ success: false, message: "Athlete not found." });
      }
      res.status(200).json({ success: true, message: "Athlete updated successfully", data: updateResult.rows[0] });
    } else {
      res.status(403).json({ success: false, message: 'Permission denied.' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "An error occurred updating the athlete." });
  }
});

app.delete('/api/athletes/:id', authenticateToken, authorizeRoles('coach', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM athletes WHERE id = $1 RETURNING *', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Athlete not found." });
    }
    res.status(200).json({ success: true, message: "Athlete deleted successfully." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "An error occurred deleting the athlete." });
  }
});

// --- Protected Endpoints for Training Sessions ---
app.post('/api/training-sessions', authenticateToken, authorizeRoles('coach', 'admin'), async (req, res) => {
  try {
    const { athlete_id, session_date, notes } = req.body;
    const result = await pool.query(
      'INSERT INTO training_sessions (athlete_id, session_date, notes) VALUES ($1, $2, $3) RETURNING *',
      [athlete_id, session_date, notes]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "An error occurred creating the training session." });
  }
});

app.get('/api/training-sessions/:athleteId', authenticateToken, async (req, res) => {
  try {
    const { athleteId } = req.params;
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    
    const athleteResult = await pool.query('SELECT user_id FROM athletes WHERE id = $1', [athleteId]);
    if (athleteResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Athlete not found." });
    }
    const athleteUserId = athleteResult.rows[0].user_id;

    if (req.user.role === 'coach' || req.user.role === 'admin' || req.user.userId === athleteUserId) {
      const { rows } = await pool.query(
        'SELECT session_date, notes FROM training_sessions WHERE athlete_id = $1 ORDER BY session_date DESC LIMIT $2 OFFSET $3',
        [athleteId, limit, offset]
      );
      res.status(200).json({ success: true, data: rows });
    } else {
      res.status(403).json({ success: false, message: 'Permission denied.' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "An error occurred fetching training sessions." });
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
      return res.status(404).json({ success: false, message: "Training session not found." });
    }
    res.status(200).json({ success: true, message: "Training session updated successfully", data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "An error occurred updating the training session." });
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
      return res.status(404).json({ success: false, message: "Training session not found." });
    }
    res.status(200).json({ success: true, message: "Training session deleted successfully." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "An error occurred deleting the training session." });
  }
});

// --- Protected Endpoints for Performance Metrics ---
app.post('/api/performance-metrics', authenticateToken, authorizeRoles('coach', 'admin'), async (req, res) => {
  try {
    const { athlete_id, metric_name, metric_value, notes } = req.body;
    const result = await pool.query(
      'INSERT INTO performance_metrics (athlete_id, metric_name, metric_value, notes) VALUES ($1, $2, $3, $4) RETURNING *',
      [athlete_id, metric_name, metric_value, notes]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "An error occurred creating the performance metric." });
  }
});

app.get('/api/performance-metrics/:athleteId', authenticateToken, async (req, res) => {
  try {
    const { athleteId } = req.params;
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    
    const athleteResult = await pool.query('SELECT user_id FROM athletes WHERE id = $1', [athleteId]);
    if (athleteResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Athlete not found." });
    }
    const athleteUserId = athleteResult.rows[0].user_id;

    if (req.user.role === 'coach' || req.user.role === 'admin' || req.user.userId === athleteUserId) {
      const { rows } = await pool.query(
        'SELECT entry_date, metric_name, metric_value FROM performance_metrics WHERE athlete_id = $1 ORDER BY entry_date DESC LIMIT $2 OFFSET $3',
        [athleteId, limit, offset]
      );
      res.status(200).json({ success: true, data: rows });
    } else {
      res.status(403).json({ success: false, message: 'Permission denied.' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "An error occurred fetching performance metrics." });
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
      return res.status(404).json({ success: false, message: "Performance metric not found." });
    }
    res.status(200).json({ success: true, message: "Performance metric updated successfully", data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "An error occurred updating the performance metric." });
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
      return res.status(404).json({ success: false, message: "Performance metric not found." });
    }
    res.status(200).json({ success: true, message: "Performance metric deleted successfully." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "An error occurred deleting the performance metric." });
  }
});


app.get('/api/me', authenticateToken, (req, res) => {
  res.status(200).json({ success: true, message: 'Token is valid', data: req.user });
});

app.get('/', (req, res) => {
  res.send('Backend is running!');
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
