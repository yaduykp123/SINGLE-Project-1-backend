import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { protect } from '../middlewares/authMiddleware.js';
import { adminOnly } from '../middlewares/adminMiddleware.js';
import mongoose from 'mongoose';
import User from '../models/userSchema.js';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongoServer;
const app = express();
app.use(express.json());
app.use(cookieParser());

// Dummy routes for testing
app.get('/protected', protect, (req, res) => res.json({ user: req.user._id }));
app.get('/admin-only', protect, adminOnly, (req, res) => res.json({ admin: true }));

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Auth Middleware', () => {
  it('should reject requests without token', async () => {
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.message).toContain('no token');
  });

  it('should allow access with valid token', async () => {
    const user = await User.create({
      fullName: 'Auth Test',
      email: 'auth@example.com',
      phone: '9876543210',
      password: 'hash',
      accountType: 'household',
      isVerified: true,
    });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'testsecret');
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toBe(user._id.toString());
  });

  it('should allow access using a token stored in cookies', async () => {
    const user = await User.create({
      fullName: 'Cookie Auth',
      email: 'cookie-auth@example.com',
      phone: '9876543299',
      password: 'hash',
      accountType: 'household',
      isVerified: true,
    });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'testsecret');
    const res = await request(app)
      .get('/protected')
      .set('Cookie', [`token=${token}`]);

    expect(res.status).toBe(200);
    expect(res.body.user).toBe(user._id.toString());
  });

  it('should reject a malformed token', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer not-a-real-jwt');

    expect(res.status).toBe(401);
    expect(res.body.message).toContain('token failed');
  });

  it('should reject a token signed with the wrong secret', async () => {
    const badToken = jwt.sign({ id: 'someid' }, 'wrong-secret');
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${badToken}`);

    expect(res.status).toBe(401);
    expect(res.body.message).toContain('token failed');
  });

  it('should reject a token for a user that no longer exists', async () => {
    const token = jwt.sign({ id: new mongoose.Types.ObjectId() }, process.env.JWT_SECRET || 'testsecret');
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.message).toContain('user not found');
  });

  it('should reject a blocked user even with a valid token', async () => {
    const user = await User.create({
      fullName: 'Blocked User',
      email: 'blocked@example.com',
      phone: '9876543298',
      password: 'hash',
      accountType: 'household',
      isVerified: true,
      isBlocked: true,
    });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'testsecret');
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('blocked');
  });
});

describe('Admin Middleware', () => {
  it('should reject non-admin users', async () => {
    const user = await User.create({
      fullName: 'Regular',
      email: 'regular@example.com',
      phone: '9876543211',
      password: 'hash',
      accountType: 'household',
      isVerified: true,
      isAdmin: false,
    });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'testsecret');
    const res = await request(app)
      .get('/admin-only')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('should allow admin users through', async () => {
    const admin = await User.create({
      fullName: 'Admin',
      email: 'admin-mw@example.com',
      phone: '9876543212',
      password: 'hash',
      accountType: 'admin',
      isVerified: true,
      isAdmin: true,
    });

    const token = jwt.sign({ id: admin._id }, process.env.JWT_SECRET || 'testsecret');
    const res = await request(app)
      .get('/admin-only')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.admin).toBe(true);
  });
});