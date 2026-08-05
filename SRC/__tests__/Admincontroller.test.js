import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../app.js';
import User from '../models/userSchema.js';
import Product from '../models/productSchema.js';
import Order from '../models/OrderSchema.js';
import jwt from 'jsonwebtoken';

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
  await Product.deleteMany({});
  await Order.deleteMany({});
});

describe('Admin Controller', () => {
  describe('POST /api/admin/register-admin', () => {
    it('should register a new admin with a valid admin secret', async () => {
      const res = await request(app).post('/api/admin/register-admin').send({
        fullName: 'Admin User',
        email: 'admin@example.com',
        phone: '9876543210',
        password: 'password123',
        adminSecret: process.env.ADMIN_SECRET_KEY,
      });

      expect(res.status).toBe(201);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.isAdmin).toBe(true);
      expect(res.body.user.accountType).toBe('admin');

      const stored = await User.findOne({ email: 'admin@example.com' });
      expect(stored.isVerified).toBe(true);
      expect(stored.password).not.toBe('password123');
    });

    it('should reject an invalid admin secret', async () => {
      const res = await request(app).post('/api/admin/register-admin').send({
        fullName: 'Fake Admin',
        email: 'fake@example.com',
        phone: '9876543211',
        password: 'password123',
        adminSecret: 'wrong-secret',
      });

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Invalid admin secret');

      const stored = await User.findOne({ email: 'fake@example.com' });
      expect(stored).toBeNull();
    });

    it('should reject an empty request body', async () => {
      const res = await request(app)
        .post('/api/admin/register-admin')
        .set('Content-Type', 'application/json')
        .send();

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Request body is missing');
    });

    it('should reject duplicate emails', async () => {
      await User.create({
        fullName: 'Existing',
        email: 'dup-admin@example.com',
        phone: '9876543212',
        password: 'hash',
        accountType: 'household',
      });

      const res = await request(app).post('/api/admin/register-admin').send({
        fullName: 'Admin Two',
        email: 'dup-admin@example.com',
        phone: '9876543213',
        password: 'password123',
        adminSecret: process.env.ADMIN_SECRET_KEY,
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('User already exists');
    });
  });

  describe('Protected admin management routes', () => {
    let adminToken;
    let regularToken;
    let regularUserId;

    beforeEach(async () => {
      const admin = await User.create({
        fullName: 'Admin',
        email: 'admin2@example.com',
        phone: '9876543214',
        password: 'hash',
        accountType: 'admin',
        isAdmin: true,
        isVerified: true,
      });
      adminToken = jwt.sign({ id: admin._id }, process.env.JWT_SECRET || 'testsecret');

      const regular = await User.create({
        fullName: 'Regular',
        email: 'regular2@example.com',
        phone: '9876543215',
        password: 'hash',
        accountType: 'household',
        isVerified: true,
      });
      regularUserId = regular._id;
      regularToken = jwt.sign({ id: regular._id }, process.env.JWT_SECRET || 'testsecret');
    });

    it('should reject non-admins from listing users', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${regularToken}`);

      expect(res.status).toBe(403);
    });

    it('should allow admins to list all users', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
      // password/otp should be excluded
      expect(res.body[0].password).toBeUndefined();
    });

    it('should block a regular user', async () => {
      const res = await request(app)
        .put(`/api/admin/users/${regularUserId}/block`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user.isBlocked).toBe(true);

      const updated = await User.findById(regularUserId);
      expect(updated.isBlocked).toBe(true);
    });

    it('should unblock a user', async () => {
      await User.findByIdAndUpdate(regularUserId, { isBlocked: true });

      const res = await request(app)
        .put(`/api/admin/users/${regularUserId}/unblock`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user.isBlocked).toBe(false);
    });

    it('should prevent blocking another admin', async () => {
      const otherAdmin = await User.create({
        fullName: 'Other Admin',
        email: 'otheradmin@example.com',
        phone: '9876543216',
        password: 'hash',
        accountType: 'admin',
        isAdmin: true,
        isVerified: true,
      });

      const res = await request(app)
        .put(`/api/admin/users/${otherAdmin._id}/block`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Cannot block admin users');
    });

    it('should return 404 when blocking a non-existent user', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .put(`/api/admin/users/${fakeId}/block`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('should delete a regular user', async () => {
      const res = await request(app)
        .delete(`/api/admin/users/${regularUserId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const deleted = await User.findById(regularUserId);
      expect(deleted).toBeNull();
    });

    it('should prevent deleting another admin', async () => {
      const otherAdmin = await User.create({
        fullName: 'Other Admin 2',
        email: 'otheradmin2@example.com',
        phone: '9876543217',
        password: 'hash',
        accountType: 'admin',
        isAdmin: true,
        isVerified: true,
      });

      const res = await request(app)
        .delete(`/api/admin/users/${otherAdmin._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Cannot delete admin users');
    });

    it('should list all products for admins', async () => {
      const seller = await User.findById(regularUserId);
      await Product.create({
        name: 'Test Product',
        category: 'Grocery Items',
        marketPrice: 100,
        discountPrice: 80,
        quantity: 1,
        unit: 'kg',
        stock: 10,
        expiryDate: new Date(Date.now() + 86400000),
        owner: seller._id,
        ownerName: seller.fullName,
        ownerType: 'household',
        location: { type: 'Point', coordinates: [0, 0] },
        city: 'Delhi',
      });

      const res = await request(app)
        .get('/api/admin/products')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].owner.email).toBe(seller.email);
    });

    it('should delete a product for moderation', async () => {
      const seller = await User.findById(regularUserId);
      const product = await Product.create({
        name: 'Moderated Product',
        category: 'Grocery Items',
        marketPrice: 100,
        discountPrice: 80,
        quantity: 1,
        unit: 'kg',
        stock: 10,
        expiryDate: new Date(Date.now() + 86400000),
        owner: seller._id,
        ownerName: seller.fullName,
        ownerType: 'household',
        location: { type: 'Point', coordinates: [0, 0] },
        city: 'Delhi',
      });

      const res = await request(app)
        .delete(`/api/admin/products/${product._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const deleted = await Product.findById(product._id);
      expect(deleted).toBeNull();
    });

    it('should list all orders for admins', async () => {
      const seller = await User.findById(regularUserId);
      const product = await Product.create({
        name: 'Ordered Product',
        category: 'Grocery Items',
        marketPrice: 100,
        discountPrice: 80,
        quantity: 1,
        unit: 'kg',
        stock: 10,
        expiryDate: new Date(Date.now() + 86400000),
        owner: seller._id,
        ownerName: seller.fullName,
        ownerType: 'household',
        location: { type: 'Point', coordinates: [0, 0] },
        city: 'Delhi',
      });

      await Order.create({
        product: product._id,
        productName: product.name,
        quantity: 1,
        unitPrice: 80,
        totalAmount: 80,
        buyer: seller._id,
        buyerName: seller.fullName,
        buyerEmail: seller.email,
        buyerPhone: seller.phone,
        shippingAddress: {
          name: seller.fullName,
          phone: seller.phone,
          email: seller.email,
          street: '123 St',
          city: 'Delhi',
          state: 'Delhi',
          pincode: '110001',
        },
        seller: seller._id,
        sellerName: seller.fullName,
        paymentId: 'pay_admin_test',
        orderId: 'order_admin_test',
      });

      const res = await request(app)
        .get('/api/admin/orders')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
    });

    it('should update an order status for dispute resolution', async () => {
      const seller = await User.findById(regularUserId);
      const product = await Product.create({
        name: 'Disputed Product',
        category: 'Grocery Items',
        marketPrice: 100,
        discountPrice: 80,
        quantity: 1,
        unit: 'kg',
        stock: 10,
        expiryDate: new Date(Date.now() + 86400000),
        owner: seller._id,
        ownerName: seller.fullName,
        ownerType: 'household',
        location: { type: 'Point', coordinates: [0, 0] },
        city: 'Delhi',
      });

      const order = await Order.create({
        product: product._id,
        productName: product.name,
        quantity: 1,
        unitPrice: 80,
        totalAmount: 80,
        buyer: seller._id,
        buyerName: seller.fullName,
        buyerEmail: seller.email,
        buyerPhone: seller.phone,
        shippingAddress: {
          name: seller.fullName,
          phone: seller.phone,
          email: seller.email,
          street: '123 St',
          city: 'Delhi',
          state: 'Delhi',
          pincode: '110001',
        },
        seller: seller._id,
        sellerName: seller.fullName,
        paymentId: 'pay_admin_test2',
        orderId: 'order_admin_test2',
        status: 'pending',
      });

      const res = await request(app)
        .put(`/api/admin/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelled' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('cancelled');
    });
  });
});