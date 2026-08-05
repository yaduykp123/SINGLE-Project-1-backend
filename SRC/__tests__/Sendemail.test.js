import { jest } from '@jest/globals';

const sendEmailMock = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../config/nodemailer.js', () => ({
  sendEmail: sendEmailMock,
  default: { sendMail: jest.fn() },
}));

const {
  sendOTPEmail,
  sendExpiryReminder,
  sendOrderConfirmation,
  sendSellerNotification,
} = await import('../utils/sendEmail.js');

beforeEach(() => {
  sendEmailMock.mockClear();
});

describe('sendOTPEmail', () => {
  it('should send an OTP email with the correct subject and OTP embedded in the body', async () => {
    await sendOTPEmail('user@example.com', '123456', 'Alice');

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0][0];
    expect(call.to).toBe('user@example.com');
    expect(call.subject).toBe('expireOff - Email Verification OTP');
    expect(call.html).toContain('123456');
    expect(call.html).toContain('Alice');
  });
});

describe('sendExpiryReminder', () => {
  it('should list every expiring product in the email body', async () => {
    const products = [
      { name: 'Milk', expiryDate: new Date('2026-08-01'), quantity: 2, unit: 'ltr' },
      { name: 'Bread', expiryDate: new Date('2026-08-02'), quantity: 1, unit: 'packs' },
    ];

    await sendExpiryReminder('seller@example.com', products, 'Bob');

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0][0];
    expect(call.to).toBe('seller@example.com');
    expect(call.subject).toBe('expireOff - Products Expiring Soon!');
    expect(call.html).toContain('Milk');
    expect(call.html).toContain('Bread');
    expect(call.html).toContain('2 ltr');
    expect(call.html).toContain('1 packs');
  });

  it('should handle an empty product list gracefully', async () => {
    await sendExpiryReminder('seller@example.com', [], 'Bob');

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0][0];
    expect(call.html).toContain('<ul');
  });
});

describe('sendOrderConfirmation', () => {
  it('should include order details in the confirmation email', async () => {
    const order = {
      orderId: 'order_123',
      productName: 'Yogurt',
      quantity: 3,
      totalAmount: 150,
      status: 'confirmed',
    };

    await sendOrderConfirmation('buyer@example.com', order, 'Carol');

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0][0];
    expect(call.to).toBe('buyer@example.com');
    expect(call.subject).toBe('expireOff - Order Confirmed');
    expect(call.html).toContain('order_123');
    expect(call.html).toContain('Yogurt');
    expect(call.html).toContain('150');
  });
});

describe('sendSellerNotification', () => {
  it('should include buyer contact details for the seller', async () => {
    const order = {
      orderId: 'order_456',
      productName: 'Cheese',
      quantity: 1,
      totalAmount: 90,
      buyerName: 'Dave',
      buyerPhone: '9876543210',
    };

    await sendSellerNotification('seller@example.com', order, 'Eve');

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0][0];
    expect(call.to).toBe('seller@example.com');
    expect(call.subject).toBe('expireOff - New Order Received');
    expect(call.html).toContain('Dave');
    expect(call.html).toContain('9876543210');
  });
});