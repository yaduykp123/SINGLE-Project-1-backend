import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { jest } from '@jest/globals';


// ✅ MOCK email service BEFORE importing app
jest.unstable_mockModule('../utils/sendEmail.js', () => ({
  sendOTPEmail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  sendOrderConfirmation: jest.fn().mockResolvedValue(undefined),
  sendSellerNotification: jest.fn().mockResolvedValue(undefined),
  sendExpiryReminder: jest.fn().mockResolvedValue(undefined),
}));

// ✅ MOCK the email service module that nodemailer uses
jest.unstable_mockModule('../config/nodemailer.js', () => ({
  default: { sendMail: jest.fn().mockResolvedValue(undefined) },
  sendEmail: jest.fn().mockResolvedValue(undefined),
}));

const app = (await import('../app.js')).default;
const User = (await import('../models/userSchema.js')).default;
const { generateOTP } = await import('../utils/generateOtp.js');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await User.deleteMany({});
});

describe('Auth Controller', () => {
  describe('POST /api/auth/register', () => {
    it('should register a new user and return userId', async () => {
      const res = await request(app).post('/api/auth/register').send({
        fullName: 'Test User',
        email: 'test@example.com',
        phone: '9876543210',
        password: 'password123',
        accountType: 'household',
      });

      expect(res.status).toBe(201);
      expect(res.body.userId).toBeDefined();
      expect(res.body.message).toContain('verify your email');
    });

    it('should reject duplicate verified emails', async () => {
      await User.create({
        fullName: 'Existing',
        email: 'dup@example.com',
        phone: '9876543211',
        password: 'hash',
        accountType: 'shop',
        isVerified: true,
      });

      const res = await request(app).post('/api/auth/register').send({
        fullName: 'Test',
        email: 'dup@example.com',
        phone: '9876543212',
        password: 'password123',
        accountType: 'household',
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('User already exists');
    });

    it('should validate required fields', async () => {
      const res = await request(app).post('/api/auth/register').send({});
      expect(res.status).toBe(500); // Mongoose validation via error middleware
    });
  });

  describe('POST /api/auth/verify-otp', () => {
    it('should verify OTP and return token', async () => {
      const otp = generateOTP();
      const user = await User.create({
        fullName: 'OTP User',
        email: 'otp@example.com',
        phone: '9876543213',
        password: 'hash',
        accountType: 'household',
        otp,
        otpExpiry: new Date(Date.now() + 10 * 60 * 1000),
        isVerified: false,
      });

      const res = await request(app).post('/api/auth/verify-otp').send({
        userId: user._id.toString(),
        otp,
      });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe('otp@example.com');
    });

    it('should reject invalid OTP', async () => {
      const user = await User.create({
        fullName: 'Bad OTP',
        email: 'bad@example.com',
        phone: '9876543214',
        password: 'hash',
        accountType: 'household',
        otp: '123456',
        otpExpiry: new Date(Date.now() + 10 * 60 * 1000),
        isVerified: false,
      });

      const res = await request(app).post('/api/auth/verify-otp').send({
        userId: user._id.toString(),
        otp: '000000',
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid OTP');
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login with valid credentials', async () => {
      const bcrypt = await import('bcryptjs');
      const hashed = await bcrypt.hash('password123', 10);
      
      await User.create({
        fullName: 'Login User',
        email: 'login@example.com',
        phone: '9876543215',
        password: hashed,
        accountType: 'shop',
        isVerified: true,
      });

      const res = await request(app).post('/api/auth/login').send({
        email: 'login@example.com',
        password: 'password123',
      });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.accountType).toBe('shop');
    });

    it('should reject blocked users', async () => {
      const bcrypt = await import('bcryptjs');
      const hashed = await bcrypt.hash('password123', 10);
      
      await User.create({
        fullName: 'Blocked',
        email: 'blocked@example.com',
        phone: '9876543216',
        password: hashed,
        accountType: 'household',
        isVerified: true,
        isBlocked: true,
      });

      const res = await request(app).post('/api/auth/login').send({
        email: 'blocked@example.com',
        password: 'password123',
      });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('blocked');
    });
  });

  describe('POST /api/auth/refresh-token', () => {
    it('should refresh access token using valid refresh token cookie', async () => {
      const bcrypt = await import('bcryptjs');
      const hashed = await bcrypt.hash('password123', 10);
      
      const user = await User.create({
        fullName: 'Refresh User',
        email: 'refresh@example.com',
        phone: '9876543217',
        password: hashed,
        accountType: 'household',
        isVerified: true,
      });

      const loginRes = await request(app).post('/api/auth/login').send({
        email: 'refresh@example.com',
        password: 'password123',
      });

      const cookies = loginRes.headers['set-cookie'];
      expect(cookies).toBeDefined();

      const refreshRes = await request(app)
        .post('/api/auth/refresh-token')
        .set('Cookie', cookies);

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.token).toBeDefined();
    });

    it('should reject refresh request without cookie', async () => {
      const res = await request(app).post('/api/auth/refresh-token');
      expect(res.status).toBe(401);
      expect(res.body.message).toContain('No refresh token');
    });
  });
});