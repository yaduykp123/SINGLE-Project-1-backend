import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../app.js';
import Order from '../models/OrderSchema.js';
import Product from '../models/productSchema.js';
import User from '../models/userSchema.js';
import jwt from 'jsonwebtoken';

let mongoServer;
let buyerToken;
let sellerToken;
let buyerId;
let sellerId;
let productId;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  const buyer = await User.create({
    fullName: 'Buyer',
    email: 'buyer@example.com',
    phone: '9876543210',
    password: 'hash',
    accountType: 'household',
    isVerified: true,
  });
  buyerId = buyer._id;
  buyerToken = jwt.sign({ id: buyerId }, process.env.JWT_SECRET || 'testsecret');

  const seller = await User.create({
    fullName: 'Seller',
    email: 'seller@example.com',
    phone: '9876543211',
    password: 'hash',
    accountType: 'shop',
    isVerified: true,
  });
  sellerId = seller._id;
  sellerToken = jwt.sign({ id: sellerId }, process.env.JWT_SECRET || 'testsecret');

  const product = await Product.create({
    name: 'Test Product',
    category: 'Grocery Items',
    marketPrice: 100,
    discountPrice: 80,
    quantity: 1,
    unit: 'kg',
    stock: 10,
    expiryDate: new Date(Date.now() + 86400000),
    owner: sellerId,
    ownerName: 'Seller',
    ownerType: 'shop',
    location: { type: 'Point', coordinates: [0, 0] },
    city: 'Delhi',
  });
  productId = product._id;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Order Controller', () => {
  describe('POST /api/orders/create-order', () => {
    it('should create a Razorpay order', async () => {
      const res = await request(app)
        .post('/api/orders/create-order')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ amount: 160 });

      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      expect(res.body.amount).toBe(16000); // paise
    });

    it('should reject invalid amounts', async () => {
      const res = await request(app)
        .post('/api/orders/create-order')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ amount: -10 });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/orders/my-orders', () => {
    it('should return buyer orders', async () => {
      await Order.create({
        product: productId,
        productName: 'Test Product',
        quantity: 1,
        unitPrice: 80,
        totalAmount: 80,
        buyer: buyerId,
        buyerName: 'Buyer',
        buyerEmail: 'buyer@example.com',
        buyerPhone: '9876543210',
        shippingAddress: { name: 'Buyer', phone: '9876543210', email: 'buyer@example.com', street: '123 St', city: 'Delhi', state: 'Delhi', pincode: '110001' },
        seller: sellerId,
        sellerName: 'Seller',
        paymentId: 'pay_test',
        orderId: 'order_test',
      });

      const res = await request(app)
        .get('/api/orders/my-orders')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
    });
  });

  describe('PUT /api/orders/:id/status', () => {
    it('should allow seller to update status', async () => {
      const order = await Order.create({
        product: productId,
        productName: 'Test Product',
        quantity: 1,
        unitPrice: 80,
        totalAmount: 80,
        buyer: buyerId,
        buyerName: 'Buyer',
        buyerEmail: 'buyer@example.com',
        buyerPhone: '9876543210',
        shippingAddress: { name: 'Buyer', phone: '9876543210', email: 'buyer@example.com', street: '123 St', city: 'Delhi', state: 'Delhi', pincode: '110001' },
        seller: sellerId,
        sellerName: 'Seller',
        paymentId: 'pay_test2',
        orderId: 'order_test2',
        status: 'pending',
      });

      const res = await request(app)
        .put(`/api/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ status: 'confirmed' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('confirmed');
    });
  });
});