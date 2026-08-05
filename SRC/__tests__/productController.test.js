import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../app.js';
import Product from '../models/productSchema.js';
import User from '../models/userSchema.js';
import jwt from 'jsonwebtoken';

let mongoServer;
let token;
let userId;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  
  const user = await User.create({
    fullName: 'Seller',
    email: 'seller@example.com',
    phone: '9876543210',
    password: 'hash',
    accountType: 'shop',
    isVerified: true,
    location: { type: 'Point', coordinates: [77.209, 28.6139] },
    city: 'Delhi',
  });
  
  userId = user._id;
  token = jwt.sign({ id: userId }, process.env.JWT_SECRET || 'testsecret');
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Product.deleteMany({});
});

describe('Product Controller', () => {
  describe('POST /api/products', () => {
    it('should create a product with valid data', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${token}`)
        .field('name', 'Organic Apples')
        .field('category', 'Fruits')
        .field('marketPrice', '100')
        .field('discountPrice', '80')
        .field('quantity', '1')
        .field('unit', 'kg')
        .field('stock', '5')
        .field('expiryDate', '2026-12-31');

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Organic Apples');
      expect(res.body.owner.toString()).toBe(userId.toString());
    });
  });

  describe('GET /api/products', () => {
    it('should return active non-expired products', async () => {
      await Product.create([
        {
          name: 'Fresh Milk',
          category: 'Dairy',
          marketPrice: 50,
          discountPrice: 40,
          quantity: 1,
          unit: 'ltr',
          stock: 10,
          expiryDate: new Date(Date.now() + 86400000),
          owner: userId,
          ownerName: 'Seller',
          ownerType: 'shop',
          location: { type: 'Point', coordinates: [77.209, 28.6139] },
          city: 'Delhi',
          isActive: true,
        },
        {
          name: 'Expired Bread',
          category: 'Other',
          marketPrice: 30,
          discountPrice: 20,
          quantity: 1,
          unit: 'packs',
          stock: 5,
          expiryDate: new Date(Date.now() - 86400000),
          owner: userId,
          ownerName: 'Seller',
          ownerType: 'shop',
          location: { type: 'Point', coordinates: [77.209, 28.6139] },
          city: 'Delhi',
          isActive: true,
        },
      ]);

      const res = await request(app)
        .get('/api/products')
        .query({ longitude: 77.209, latitude: 28.6139 });

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].name).toBe('Fresh Milk');
    });

    it('should filter by category', async () => {
      await Product.create({
        name: 'Bananas',
        category: 'Fruits',
        marketPrice: 40,
        discountPrice: 30,
        quantity: 1,
        unit: 'dozen',
        stock: 10,
        expiryDate: new Date(Date.now() + 86400000),
        owner: userId,
        ownerName: 'Seller',
        ownerType: 'shop',
        location: { type: 'Point', coordinates: [77.209, 28.6139] },
        city: 'Delhi',
        isActive: true,
      });

      const res = await request(app)
        .get('/api/products')
        .query({ longitude: 77.209, latitude: 28.6139, category: 'Fruits' });

      expect(res.status).toBe(200);
      expect(res.body.every(p => p.category === 'Fruits')).toBe(true);
    });
  });

  describe('PUT /api/products/:id', () => {
    it('should update own product', async () => {
      const product = await Product.create({
        name: 'Old Name',
        category: 'Grocery Items',
        marketPrice: 100,
        discountPrice: 90,
        quantity: 2,
        unit: 'kg',
        stock: 5,
        expiryDate: new Date(Date.now() + 86400000),
        owner: userId,
        ownerName: 'Seller',
        ownerType: 'shop',
        location: { type: 'Point', coordinates: [0, 0] },
        city: 'Delhi',
      });

      const res = await request(app)
        .put(`/api/products/${product._id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'New Name', marketPrice: '120', discountPrice: '100' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('New Name');
      expect(res.body.marketPrice).toBe(120);
    });
  });
});