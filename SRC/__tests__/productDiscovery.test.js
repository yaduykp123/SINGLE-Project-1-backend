import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../app.js';
import Product from '../models/productSchema.js';
import User from '../models/userSchema.js';
import Offer from '../models/OfferSchema.js';
import jwt from 'jsonwebtoken';

let mongoServer;
let token;
let userId;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  const user = await User.create({
    fullName: 'Green Grocer',
    email: 'grocer@example.com',
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
  await Offer.deleteMany({});
});

describe('Product Discovery & Search APIs', () => {
  beforeEach(async () => {
    const now = Date.now();
    await Product.create([
      {
        name: 'Organic Red Apples',
        brand: 'FarmFresh',
        description: 'Crisp sweet Himachal apples',
        category: 'Fruits',
        marketPrice: 200,
        discountPrice: 100, // 50% discount
        quantity: 1,
        unit: 'kg',
        stock: 15,
        expiryDate: new Date(now + 2 * 86400000), // 2 days left
        owner: userId,
        ownerName: 'Green Grocer',
        ownerType: 'shop',
        location: { type: 'Point', coordinates: [77.209, 28.6139] },
        city: 'Delhi',
        isActive: true,
      },
      {
        name: 'Fresh Cow Milk',
        brand: 'Amul',
        description: 'Pasteurized toned milk',
        category: 'Dairy',
        marketPrice: 60,
        discountPrice: 48, // 20% discount
        quantity: 1,
        unit: 'ltr',
        stock: 8,
        expiryDate: new Date(now + 12 * 3600000), // today
        owner: userId,
        ownerName: 'Green Grocer',
        ownerType: 'shop',
        location: { type: 'Point', coordinates: [77.209, 28.6139] },
        city: 'Delhi',
        isActive: true,
      },
      {
        name: 'Whole Wheat Sourdough',
        brand: 'BakersArt',
        description: 'Artisan freshly baked bread',
        category: 'Bakery',
        marketPrice: 120,
        discountPrice: 90, // 25% discount
        quantity: 1,
        unit: 'packs',
        stock: 5,
        expiryDate: new Date(now + 5 * 86400000), // 5 days
        owner: userId,
        ownerName: 'Green Grocer',
        ownerType: 'shop',
        location: { type: 'Point', coordinates: [77.209, 28.6139] },
        city: 'Delhi',
        isActive: true,
      },
    ]);
  });

  it('searches products by keyword in name, brand, or description', async () => {
    const res = await request(app).get('/api/products').query({ search: 'apple' });
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].name).toBe('Organic Red Apples');
  });

  it('filters products by brand', async () => {
    const res = await request(app).get('/api/products').query({ brand: 'Amul' });
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].brand).toBe('Amul');
  });

  it('filters products by price range', async () => {
    const res = await request(app).get('/api/products').query({ minPrice: 80, maxPrice: 110 });
    expect(res.status).toBe(200);
    expect(res.body.every(p => p.discountPrice >= 80 && p.discountPrice <= 110)).toBe(true);
  });

  it('filters products by minimum discount percentage', async () => {
    const res = await request(app).get('/api/products').query({ minDiscount: 40 });
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].name).toBe('Organic Red Apples');
  });

  it('sorts products by price ascending and descending', async () => {
    const asc = await request(app).get('/api/products').query({ sort: 'price_asc' });
    expect(asc.status).toBe(200);
    expect(asc.body[0].discountPrice).toBeLessThanOrEqual(asc.body[1].discountPrice);

    const desc = await request(app).get('/api/products').query({ sort: 'price_desc' });
    expect(desc.status).toBe(200);
    expect(desc.body[0].discountPrice).toBeGreaterThanOrEqual(desc.body[1].discountPrice);
  });

  it('sorts products by earliest expiry first', async () => {
    const res = await request(app).get('/api/products').query({ sort: 'expiry_asc' });
    expect(res.status).toBe(200);
    expect(res.body[0].name).toBe('Fresh Cow Milk'); // expires today
  });

  it('returns distinct brands via GET /api/products/brands', async () => {
    const res = await request(app).get('/api/products/brands');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toContain('Amul');
    expect(res.body).toContain('FarmFresh');
  });

  it('returns categories with product counts via GET /api/products/categories', async () => {
    const res = await request(app).get('/api/products/categories');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const fruitCat = res.body.find(c => c.name === 'Fruits');
    expect(fruitCat).toBeDefined();
    expect(fruitCat.count).toBe(1);
  });

  it('returns featured deals via GET /api/products/featured-deals', async () => {
    const res = await request(app).get('/api/products/featured-deals');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    // Highest discount (50% for Apples) should be first
    expect(res.body[0].name).toBe('Organic Red Apples');
  });

  it('supports paginated responses when page and limit are specified', async () => {
    const res = await request(app).get('/api/products').query({ page: 1, limit: 2 });
    expect(res.status).toBe(200);
    expect(res.body.products).toBeDefined();
    expect(res.body.products.length).toBe(2);
    expect(res.body.total).toBe(3);
    expect(res.body.totalPages).toBe(2);
    expect(res.body.hasMore).toBe(true);
  });
});
