import { jest } from '@jest/globals';

const scheduleMock = jest.fn();
const findMock = jest.fn();
const sendMailMock = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('node-cron', () => ({
  default: { schedule: scheduleMock },
  schedule: scheduleMock,
}));

jest.unstable_mockModule('../models/productSchema.js', () => ({
  default: { find: findMock },
}));

jest.unstable_mockModule('../config/nodemailer.js', () => ({
  default: { sendMail: sendMailMock },
  sendEmail: jest.fn(),
}));

const { startExpiryCheckScheduler } = await import('../jobs/reminderJob.js');

const buildQuery = (products) => ({
  populate: jest.fn().mockResolvedValue(products),
});

const buildProduct = (overrides = {}) => ({
  name: 'Milk',
  category: 'Dairy',
  stock: 5,
  expiryDate: new Date(Date.now() + 86400000),
  owner: { email: 'seller@example.com', fullName: 'Seller' },
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

beforeEach(() => {
  scheduleMock.mockClear();
  findMock.mockClear();
  sendMailMock.mockClear();
});

describe('startExpiryCheckScheduler', () => {
  it('should register a daily 9am cron schedule', () => {
    startExpiryCheckScheduler();

    expect(scheduleMock).toHaveBeenCalledTimes(1);
    expect(scheduleMock.mock.calls[0][0]).toBe('0 9 * * *');
    expect(typeof scheduleMock.mock.calls[0][1]).toBe('function');
  });

  it('should email the seller and mark the reminder as sent for each expiring product', async () => {
    startExpiryCheckScheduler();
    const cronCallback = scheduleMock.mock.calls[0][1];

    const product = buildProduct();
    findMock.mockReturnValue(buildQuery([product]));

    await cronCallback();

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const mailOptions = sendMailMock.mock.calls[0][0];
    expect(mailOptions.to).toBe('seller@example.com');
    expect(mailOptions.subject).toContain('Milk');

    expect(product.expiryReminderSent).toBe(true);
    expect(product.save).toHaveBeenCalledTimes(1);
  });

  it('should skip products whose owner has no email', async () => {
    startExpiryCheckScheduler();
    const cronCallback = scheduleMock.mock.calls[0][1];

    const product = buildProduct({ owner: null });
    findMock.mockReturnValue(buildQuery([product]));

    await cronCallback();

    expect(sendMailMock).not.toHaveBeenCalled();
    expect(product.save).not.toHaveBeenCalled();
  });

  it('should continue processing remaining products if one email fails to send', async () => {
    startExpiryCheckScheduler();
    const cronCallback = scheduleMock.mock.calls[0][1];

    const failingProduct = buildProduct({ name: 'Bread', owner: { email: 'fail@example.com', fullName: 'Fail Seller' } });
    const okProduct = buildProduct({ name: 'Cheese', owner: { email: 'ok@example.com', fullName: 'OK Seller' } });

    sendMailMock.mockRejectedValueOnce(new Error('smtp down')).mockResolvedValueOnce(undefined);
    findMock.mockReturnValue(buildQuery([failingProduct, okProduct]));

    await cronCallback();

    expect(sendMailMock).toHaveBeenCalledTimes(2);
    expect(failingProduct.save).not.toHaveBeenCalled();
    expect(okProduct.expiryReminderSent).toBe(true);
    expect(okProduct.save).toHaveBeenCalledTimes(1);
  });

  it('should not throw when the database query fails', async () => {
    startExpiryCheckScheduler();
    const cronCallback = scheduleMock.mock.calls[0][1];

    findMock.mockImplementation(() => {
      throw new Error('db down');
    });

    await expect(cronCallback()).resolves.toBeUndefined();
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});