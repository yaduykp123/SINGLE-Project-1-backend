import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../app.js';
import User from '../models/userSchema.js';
import jwt from 'jsonwebtoken';

let mongoServer;
let userId;
let token;

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
  const user = await User.create({
    fullName: 'Profile User',
    email: 'profile@example.com',
    phone: '9876543210',
    password: 'hash',
    accountType: 'household',
    isVerified: true,
  });
  userId = user._id;
  token = jwt.sign({ id: userId }, process.env.JWT_SECRET || 'testsecret');
});

describe('User Controller', () => {
  describe('GET /api/users/profile', () => {
    it('should return the logged-in user profile without password/otp', async () => {
      const res = await request(app)
        .get('/api/users/profile')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.email).toBe('profile@example.com');
      expect(res.body.password).toBeUndefined();
      expect(res.body.otp).toBeUndefined();
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request(app).get('/api/users/profile');
      expect(res.status).toBe(401);
    });
  });

  describe('PUT /api/users/location', () => {
    it('should update the user location fields', async () => {
      const res = await request(app)
        .put('/api/users/location')
        .set('Authorization', `Bearer ${token}`)
        .send({
          city: 'Mumbai',
          state: 'Maharashtra',
          country: 'India',
          latitude: 19.076,
          longitude: 72.8777,
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Location updated');
      expect(res.body.user.city).toBe('Mumbai');
      expect(res.body.user.location.coordinates).toEqual([72.8777, 19.076]);

      const stored = await User.findById(userId);
      expect(stored.city).toBe('Mumbai');
      expect(stored.location.coordinates).toEqual([72.8777, 19.076]);
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request(app).put('/api/users/location').send({ city: 'Delhi' });
      expect(res.status).toBe(401);
    });
  });
});