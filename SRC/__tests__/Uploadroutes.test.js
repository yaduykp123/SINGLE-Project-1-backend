import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import uploadRoutes from '../routes/uploadRoutes.js';
import User from '../models/userSchema.js';

// NOTE: uploadRoutes is not currently mounted in app.js, so we build a
// minimal app here (same technique used for locationRoutes) to exercise it.
const testApp = express();
testApp.use(express.json());
testApp.use('/api/upload', uploadRoutes);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, '../public/uploads');

let mongoServer;
let token;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  const user = await User.create({
    fullName: 'Upload User',
    email: 'upload@example.com',
    phone: '9876543210',
    password: 'hash',
    accountType: 'household',
    isVerified: true,
  });
  token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'testsecret');
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
  // clean up any files written during the local-fallback test
  if (fs.existsSync(uploadDir)) {
    fs.rmSync(uploadDir, { recursive: true, force: true });
  }
});

describe('Upload Routes', () => {
  it('should reject unauthenticated requests', async () => {
    const res = await request(testApp).post('/api/upload');
    expect(res.status).toBe(401);
  });

  it('should return 400 when no file is attached', async () => {
    const res = await request(testApp)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('No image file provided');
  });

  it('should save the file locally and return its URL when Cloudinary is not configured', async () => {
    // process.env has no CLOUDINARY_* vars set in the test environment,
    // so the route falls back to writing the file to local disk.
    const res = await request(testApp)
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('image', Buffer.from('fake-image-bytes'), 'test.png');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.imageUrl).toContain('/uploads/');

    const savedFileName = res.body.imageUrl.split('/uploads/')[1];
    expect(fs.existsSync(path.join(uploadDir, savedFileName))).toBe(true);
  });
});