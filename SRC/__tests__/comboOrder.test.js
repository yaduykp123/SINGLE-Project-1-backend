import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../app.js';
import Order from '../models/OrderSchema.js';
import Product from '../models/productSchema.js';
import User from '../models/userSchema.js';
import Offer from '../models/OfferSchema.js';
import Batch from '../models/BatchSchema.js';
import jwt from 'jsonwebtoken';

let mongoServer;
let buyerToken;
let sellerToken;
let strangerToken;
let buyerId;
let sellerId;
let strangerId;
let product1;
let product2;
let comboOffer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  // 1. Create Buyer
  const buyer = await User.create({
    fullName: 'Test Buyer',
    email: 'buyer@combo.com',
    phone: '9876543210',
    password: 'hash',
    accountType: 'household',
    isVerified: true,
  });
  buyerId = buyer._id;
  buyerToken = jwt.sign({ id: buyerId }, process.env.JWT_SECRET || 'testsecret');

  // 2. Create Seller
  const seller = await User.create({
    fullName: 'Test Merchant',
    email: 'seller@combo.com',
    phone: '9876543211',
    password: 'hash',
    accountType: 'shop',
    isVerified: true,
  });
  sellerId = seller._id;
  sellerToken = jwt.sign({ id: sellerId }, process.env.JWT_SECRET || 'testsecret');

  // 3. Create Stranger (for Access Control verification)
  const stranger = await User.create({
    fullName: 'Unauthorized User',
    email: 'stranger@combo.com',
    phone: '9876543212',
    password: 'hash',
    accountType: 'household',
    isVerified: true,
  });
  strangerId = stranger._id;
  strangerToken = jwt.sign({ id: strangerId }, process.env.JWT_SECRET || 'testsecret');

  // 4. Create Two Products for Combo Package
  product1 = await Product.create({
    name: 'Organic Apples',
    category: 'Fruits',
    brand: 'FreshFarm',
    marketPrice: 150,
    discountPrice: 120,
    quantity: 1,
    unit: 'kg',
    stock: 20,
    expiryDate: new Date(Date.now() + 5 * 86400000),
    owner: sellerId,
    ownerName: 'Test Merchant',
    ownerType: 'shop',
    location: { type: 'Point', coordinates: [75.89, 11.16] },
    city: 'Kozhikode',
    image: 'https://images.unsplash.com/apples.jpg',
  });

  product2 = await Product.create({
    name: 'Pure Honey',
    category: 'Grocery Items',
    brand: 'NaturePure',
    marketPrice: 200,
    discountPrice: 160,
    quantity: 1,
    unit: 'bottle',
    stock: 15,
    expiryDate: new Date(Date.now() + 30 * 86400000),
    owner: sellerId,
    ownerName: 'Test Merchant',
    ownerType: 'shop',
    location: { type: 'Point', coordinates: [75.89, 11.16] },
    city: 'Kozhikode',
    image: 'https://images.unsplash.com/honey.jpg',
  });

  // Create Batches for inventory tracking
  await Batch.create({
    product: product1._id,
    seller: sellerId,
    batchNumber: 'BATCH-APP-01',
    initialQuantity: 20,
    availableStock: 20,
    expiryDate: product1.expiryDate,
  });

  await Batch.create({
    product: product2._id,
    seller: sellerId,
    batchNumber: 'BATCH-HON-01',
    initialQuantity: 15,
    availableStock: 15,
    expiryDate: product2.expiryDate,
  });

  // 5. Create Combo Offer
  comboOffer = await Offer.create({
    title: 'Breakfast Power Combo Pack',
    description: 'Fresh organic apples combined with pure raw honey at an unbeatable deal.',
    discountPercentage: 25, // 25% off base prices: (120 + 160) * 0.75 = 210
    category: 'All',
    shopOwner: sellerId,
    products: [product1._id, product2._id],
    expiresAt: new Date(Date.now() + 7 * 86400000),
    city: 'Kozhikode',
    isActive: true,
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Combo Pack Order Integration', () => {
  let createdComboOrderId;

  const validShipping = {
    name: 'Test Buyer',
    phone: '9876543210',
    email: 'buyer@combo.com',
    street: '45 Green Park Way',
    city: 'Kozhikode',
    state: 'Kerala',
    pincode: '673634',
  };

  describe('1. Combo Order Creation & Pricing Snapshot', () => {
    it('should calculate correct combo pack pricing in create-order', async () => {
      const res = await request(app)
        .post('/api/orders/create-order')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          amount: 210,
          isCombo: true,
          comboId: comboOffer._id,
          quantity: 1,
        });

      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      // 210 * 100 paise = 21000
      expect(res.body.amount).toBe(21000);
    });

    it('should create combo order with immutable snapshot of all products', async () => {
      const res = await request(app)
        .post('/api/orders/verify-payment')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          razorpay_order_id: 'order_combo_1001',
          razorpay_payment_id: 'pay_combo_1001',
          razorpay_signature: 'sig_mock',
          isCombo: true,
          comboId: comboOffer._id,
          quantity: 1,
          shippingAddress: validShipping,
        });

      expect(res.status).toBe(201);
      expect(res.body.order).toBeDefined();

      const order = res.body.order;
      createdComboOrderId = order._id;

      expect(order.isCombo).toBe(true);
      expect(order.productName).toBe('Breakfast Power Combo Pack');
      expect(order.totalAmount).toBe(210);

      // Verify immutable snapshot
      expect(order.combo).toBeDefined();
      expect(order.combo.name).toBe('Breakfast Power Combo Pack');
      expect(order.combo.discountPercentage).toBe(25);
      expect(order.combo.itemsCount).toBe(2);
      expect(order.combo.items.length).toBe(2);

      const appleItem = order.combo.items.find((i) => i.name === 'Organic Apples');
      expect(appleItem).toBeDefined();
      expect(appleItem.marketPrice).toBe(150);
      expect(appleItem.unitPrice).toBe(90); // 120 * 0.75
      expect(appleItem.category).toBe('Fruits');

      const honeyItem = order.combo.items.find((i) => i.name === 'Pure Honey');
      expect(honeyItem).toBeDefined();
      expect(honeyItem.marketPrice).toBe(200);
      expect(honeyItem.unitPrice).toBe(120); // 160 * 0.75
      expect(honeyItem.brand).toBe('NaturePure');
    });
  });

  describe('2. Order History Display (Buyer & Seller)', () => {
    it('should return combo order in /api/orders/my-orders with full combo details', async () => {
      const res = await request(app)
        .get('/api/orders/my-orders')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      const found = res.body.find((o) => o._id.toString() === createdComboOrderId.toString());
      expect(found).toBeDefined();
      expect(found.isCombo).toBe(true);
      expect(found.combo.items.length).toBe(2);
      expect(found.combo.name).toBe('Breakfast Power Combo Pack');
    });

    it('should return combo order in seller received orders', async () => {
      const res = await request(app)
        .get('/api/orders/received')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      const found = res.body.find((o) => o._id.toString() === createdComboOrderId.toString());
      expect(found).toBeDefined();
      expect(found.buyerName).toBe('Test Buyer');
      expect(found.isCombo).toBe(true);
    });
  });

  describe('3. Single Order Details Endpoint (/api/orders/:id)', () => {
    it('should return full combo details for buyer', async () => {
      const res = await request(app)
        .get(`/api/orders/${createdComboOrderId}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body._id).toBe(createdComboOrderId);
      expect(res.body.isCombo).toBe(true);
      expect(res.body.combo.items.length).toBe(2);
    });

    it('should return full combo details for seller', async () => {
      const res = await request(app)
        .get(`/api/orders/${createdComboOrderId}`)
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body._id).toBe(createdComboOrderId);
    });
  });

  describe('4. Historical Snapshot Integrity After Combo Edits / Deactivation', () => {
    it('should retain historical order snapshot even if seller deactivates combo and edits product', async () => {
      // Seller edits the original Offer
      await Offer.findByIdAndUpdate(comboOffer._id, {
        title: 'MODIFIED COMBO TITLE THAT SHOULD NOT AFFECT HISTORICAL ORDER',
        isActive: false,
        discountPercentage: 5,
        products: [], // stripped products
      });

      // Seller modifies product price
      await Product.findByIdAndUpdate(product1._id, {
        name: 'Changed Product Name',
        marketPrice: 9999,
        discountPrice: 8888,
      });

      // Customer fetches their order
      const res = await request(app)
        .get(`/api/orders/${createdComboOrderId}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      const order = res.body;

      // Assert historical snapshot remained completely intact!
      expect(order.combo.name).toBe('Breakfast Power Combo Pack');
      expect(order.combo.discountPercentage).toBe(25);
      expect(order.combo.items.length).toBe(2);
      expect(order.combo.items[0].name).toBe('Organic Apples');
      expect(order.combo.items[0].marketPrice).toBe(150);
      expect(order.combo.items[0].unitPrice).toBe(90);
    });
  });

  describe('5. Access Control', () => {
    it('should block unauthorized user from accessing another user combo order', async () => {
      const res = await request(app)
        .get(`/api/orders/${createdComboOrderId}`)
        .set('Authorization', `Bearer ${strangerToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('6. Cancellation & Batch Stock Restoration', () => {
    it('should restore batch stock for each product when combo order is cancelled', async () => {
      const batchAppleBefore = await Batch.findOne({ product: product1._id });
      const availableBefore = batchAppleBefore.availableStock;

      const res = await request(app)
        .put(`/api/orders/${createdComboOrderId}/status`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ status: 'cancelled' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('cancelled');
      expect(res.body.stockRestored).toBe(true);

      const batchAppleAfter = await Batch.findOne({ product: product1._id });
      expect(batchAppleAfter.availableStock).toBe(availableBefore + 1);
    });
  });

  describe('7. Individual Product Orders Regression', () => {
    it('should continue to create and fetch individual product orders normally', async () => {
      const res = await request(app)
        .post('/api/orders/verify-payment')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          razorpay_order_id: 'order_single_2001',
          razorpay_payment_id: 'pay_single_2001',
          razorpay_signature: 'sig_mock',
          productId: product2._id,
          quantity: 1,
          shippingAddress: validShipping,
        });

      expect(res.status).toBe(201);
      expect(res.body.order.isCombo).toBe(false);
      expect(res.body.order.productName).toBe('Pure Honey');

      const ordersRes = await request(app)
        .get('/api/orders/my-orders')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(ordersRes.status).toBe(200);
      const singleOrder = ordersRes.body.find((o) => o._id === res.body.order._id);
      expect(singleOrder).toBeDefined();
      expect(singleOrder.isCombo).toBe(false);
    });
  });
});
