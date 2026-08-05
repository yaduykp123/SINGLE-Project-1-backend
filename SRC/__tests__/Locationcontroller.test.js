import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import locationRoutes from '../routes/locationRoutes.js';
import User from '../models/userSchema.js';

// NOTE: locationRoutes is not currently mounted in app.js, so we build a
// minimal app here (same technique used in middleware.test.js) to exercise
// the controller logic directly through its router.
const testApp = express();
testApp.use(express.json());
testApp.use('/api/location', locationRoutes);

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
    fullName: 'Location User',
    email: 'location@example.com',
    phone: '9876543210',
    password: 'hash',
    accountType: 'household',
    isVerified: true,
  });
  userId = user._id;
  token = jwt.sign({ id: userId }, process.env.JWT_SECRET || 'testsecret');
});

describe('Location Controller', () => {
  describe('POST /api/location/save', () => {
    it('should save location data for the authenticated user', async () => {
      const res = await request(testApp)
        .post('/api/location/save')
        .set('Authorization', `Bearer ${token}`)
        .send({ city: 'Kochi', state: 'Kerala', country: 'India', latitude: 9.9312, longitude: 76.2673 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.location.city).toBe('Kochi');
      expect(res.body.location.latitude).toBe(9.9312);

      const stored = await User.findById(userId);
      expect(stored.city).toBe('Kochi');
      expect(stored.location.coordinates).toEqual([76.2673, 9.9312]);
    });

    it('should return 401 when the user no longer exists', async () => {
      const fakeToken = jwt.sign({ id: new mongoose.Types.ObjectId() }, process.env.JWT_SECRET || 'testsecret');

      const res = await request(testApp)
        .post('/api/location/save')
        .set('Authorization', `Bearer ${fakeToken}`)
        .send({ city: 'Nowhere' });

      expect(res.status).toBe(401);
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request(testApp).post('/api/location/save').send({ city: 'Kochi' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/location/me', () => {
    it('should default to empty/null location fields when unset', async () => {
      const res = await request(testApp)
        .get('/api/location/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.location).toEqual({
        city: '',
        state: '',
        country: '',
        latitude: null,
        longitude: null,
      });
    });

    it('should return previously saved location data', async () => {
      await User.findByIdAndUpdate(userId, { city: 'Pune', latitude: 18.5204, longitude: 73.8567 });

      const res = await request(testApp)
        .get('/api/location/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.location.city).toBe('Pune');
      expect(res.body.location.latitude).toBe(18.5204);
    });
  });

  describe('PUT /api/location/update', () => {
    it('should update only the provided fields', async () => {
      await User.findByIdAndUpdate(userId, { city: 'Pune', state: 'Maharashtra' });

      const res = await request(testApp)
        .put('/api/location/update')
        .set('Authorization', `Bearer ${token}`)
        .send({ city: 'Nashik' });

      expect(res.status).toBe(200);
      expect(res.body.location.city).toBe('Nashik');
      expect(res.body.location.state).toBe('Maharashtra');
    });

    it('should return 401 when the user no longer exists', async () => {
      const fakeToken = jwt.sign({ id: new mongoose.Types.ObjectId() }, process.env.JWT_SECRET || 'testsecret');

      const res = await request(testApp)
        .put('/api/location/update')
        .set('Authorization', `Bearer ${fakeToken}`)
        .send({ city: 'Nowhere' });

      expect(res.status).toBe(401);
    });
  });
});