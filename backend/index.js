const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
const frontendUrl = process.env.FRONTEND_URL || 'https://your-frontend-url.vercel.app';
app.use(cors({ origin: frontendUrl }));
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
  ssl: { rejectUnauthorized: false }
});

// --- Database Initialization ---
const initializeDatabase = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'athlete'
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS athletes (
        id SERIAL PRIMARY KEY,
        user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        athlete_id VARCHAR(255) UNIQUE,
        dob DATE,
        sport VARCHAR(100),
        gender VARCHAR(20),
        contact_info VARCHAR(255)
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS training_sessions (
        id SERIAL PRIMARY KEY,
        athlete_id INTEGER REFERENCES athletes(id) ON DELETE CASCADE,
        session_date TIMESTAMP NOT NULL DEFAULT NOW(),
        notes TEXT
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS performance_metrics (
        id SERIAL PRIMARY KEY,
        athlete_id INTEGER REFERENCES athletes(id) ON DELETE CASCADE,
        metric_name VARCHAR(255) NOT NULL,
        metric_value VARCHAR(255) NOT NULL,
        entry_date TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_training_sessions_athlete_id ON training_sessions(athlete_id);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_performance_metrics_athlete_id ON performance_metrics(athlete_id);');
    console.log('Database initialized successfully.');
  } catch (err) {
    console.error('Error initializing database:', err);
  }
};
initializeDatabase();

// --- JWT Middleware ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Authentication token required.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
    req.user = user;
    next();
  });
};

const authorizeRoles = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Permission denied.' });
  }
  next();
};

// --- Authentication Endpoints ---
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (userResult.rows.length === 0)
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });

    const user = userResult.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword)
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });

    const token = jwt.sign({ userId: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
    res.status(200).json({ success: true, message: 'Login successful', data: { token, user: { role: user.role, userId: user.id } } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "An error occurred during login." });
  }
});

// --- Registration Endpoint ---
app.post('/api/register', async (req, res) => {
  const client = await pool.connect();
  try {
    const { username, password, name, dob, sport, gender, contact_info, role } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }

    // Default role is athlete for public registration
    let assignedRole = 'athlete';
    const token = req.headers['authorization']?.split(' ')[1];

    // Role assignment based on token
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role === 'admin') {
          // Admin can assign any role
          if (['athlete', 'coach', 'admin'].includes(role)) assignedRole = role;
        } else if (decoded.role === 'coach') {
          // Coach can create only athletes
          assignedRole = 'athlete';
        }
      } catch (err) {
        console.error('Invalid token for role assignment, defaulting to athlete.');
      }
    }

    await client.query('BEGIN');
    const hashedPassword = await bcrypt.hash(password, 10);

    const userInsertResult = await client.query(
      'INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, role',
      [username, hashedPassword, assignedRole]
    );

    const newUserId = userInsertResult.rows[0].id;

    // Only athletes require a full profile
    if (assignedRole === 'athlete') {
      if (!name || !dob || !sport || !gender || !contact_info) {
        throw new Error('All athlete profile fields are required for this role.');
      }
      await client.query(
        'INSERT INTO athletes (user_id, name, dob, sport, gender, contact_info) VALUES ($1, $2, $3, $4, $5, $6)',
        [newUserId, name, dob, sport, gender, contact_info]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, message: 'User created successfully', data: { user: userInsertResult.rows[0] } });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ success: false, message: "An error occurred during registration." });
  } finally {
    client.release();
  }
});

// --- Other endpoints remain unchanged (user, athlete, training session, performance metrics, etc.) ---

app.get('/api/me', authenticateToken, (req, res) => {
  res.status(200).json({ success: true, message: 'Token is valid', data: req.user });
});

app.get('/', (req, res) => {
  res.send('Backend is running!');
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});