// backend/scripts/createAdmin.js
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import User from '../models/User.js'; // Adjust path to your User model

dotenv.config();

// Replace these with your admin details
const adminData = {
  username: 'admin',
  password: 'StrongPassword222##', // plain password (will be hashed)
  name: 'System Admin',
  dob: '2004-01-01',
  sport: 'running',
  gender: 'Male',
  contact_info: '8791973879',
  role: 'admin',
};

const createAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('Connected to DB');

    const existing = await User.findOne({ username: adminData.username });
    if (existing) {
      console.log('Admin user already exists.');
      process.exit(0);
    }

    const hashedPassword = await bcrypt.hash(adminData.password, 10);
    const adminUser = new User({ ...adminData, password: hashedPassword });
    await adminUser.save();

    console.log('Admin user created successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Error creating admin:', err);
    process.exit(1);
  }
};

createAdmin();