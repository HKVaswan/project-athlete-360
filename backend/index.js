// backend/index.js
import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import morgan from 'morgan';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// -------------------------
// ENVIRONMENT CHECKS
// -------------------------
const requiredEnvs = ['JWT_SECRET', 'DATABASE_URL', 'FRONTEND_URL'];
requiredEnvs.forEach((env) => {
  if (!process.env[env]) {
    console.error(`FATAL ERROR: ${env} is not defined`);
    process.exit(1);
  }
});

const JWT_SECRET = process.env.JWT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL;

// -------------------------
// MIDDLEWARE
// -------------------------
app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());
app.use(morgan('dev')); // logs all requests

// -------------------------
// POSTGRESQL POOL
// -------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// -------------------------
// DATABASE INIT
// -------------------------
const initializeDatabase = async () => {
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');

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
    process.exit(1);
  }
};
initializeDatabase();

// -------------------------
// AUTH MIDDLEWARE
// -------------------------
const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Token required' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(403).json({ success: false, message: 'Invalid or expired token' });
  }
};

const authorizeRoles = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Permission denied' });
  }
  next();
};

// -------------------------
// ROUTES
// -------------------------

// --- Login ---
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (!userResult.rows.length)
      return res.status(401).json({ success: false, message: 'Invalid username or password' });

    const user = userResult.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword)
      return res.status(401).json({ success: false, message: 'Invalid username or password' });

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.status(200).json({ success: true, message: 'Login successful', data: { token, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error during login' });
  }
});

// --- Registration ---
app.post('/api/register', async (req, res) => {
  const client = await pool.connect();
  try {
    const { username, password, name, dob, sport, gender, contact_info, role } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }

    // Default role
    let assignedRole = 'athlete';
    const token = req.headers['authorization']?.split(' ')[1];

    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role === 'admin' && ['athlete', 'coach', 'admin'].includes(role)) {
          assignedRole = role;
        } else if (decoded.role === 'coach') {
          assignedRole = 'athlete';
        }
      } catch {
        console.warn('Invalid token for role assignment, defaulting to athlete.');
      }
    }

    await client.query('BEGIN');
    const hashedPassword = await bcrypt.hash(password, 10);

    const userInsert = await client.query(
      'INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, role',
      [username, hashedPassword, assignedRole]
    );

    const newUserId = userInsert.rows[0].id;

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
    res.status(201).json({ success: true, message: 'User created successfully', data: { user: userInsert.rows[0] } });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ success: false, message: 'Error during registration' });
  } finally {
    client.release();
  }
});

// --- Test Authenticated Route ---
app.get('/api/me', authenticateToken, (req, res) => {
  res.status(200).json({ success: true, message: 'Token valid', data: req.user });
});

// --- Root ---
app.get('/', (req, res) => {
  res.send('Backend is running!');
});

// -------------------------
// SERVER START
// -------------------------
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});