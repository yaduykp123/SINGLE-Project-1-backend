import { jest } from '@jest/globals';

const scheduleMock = jest.fn();
const findMock = jest.fn();
const sendExpiryReminderMock = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('node-cron', () => ({
  default: { schedule: scheduleMock },
  schedule: scheduleMock,
}));

jest.unstable_mockModule('../models/productSchema.js', () => ({
  default: { find: findMock },
}));

jest.unstable_mockModule('../utils/sendEmail.js', () => ({
  sendExpiryReminder: sendExpiryReminderMock,
}));

const { startCronJobs } = await import('../utils/cronJobs.js');

// Helper to build a chainable mongoose-like query returning `products`
const buildQuery = (products) => ({
  populate: jest.fn().mockResolvedValue(products),
});

beforeEach(() => {
  scheduleMock.mockClear();
  findMock.mockClear();
  sendExpiryReminderMock.mockClear();
});

describe('startCronJobs', () => {
  it('should register a daily 9am cron schedule', () => {
    startCronJobs();

    expect(scheduleMock).toHaveBeenCalledTimes(3);
    expect(scheduleMock.mock.calls[0][0]).toBe('0 9 * * *');
    expect(scheduleMock.mock.calls[1][0]).toBe('0 10 * * *');
    expect(scheduleMock.mock.calls[2][0]).toBe('0 * * * *');
    expect(typeof scheduleMock.mock.calls[0][1]).toBe('function');
  });

  it('should group expiring products by owner and send one reminder email per owner', async () => {
    startCronJobs();
    const cronCallback = scheduleMock.mock.calls[0][1];

    const ownerA = { _id: 'owner-a', email: 'a@example.com', fullName: 'Owner A' };
    const ownerB = { _id: 'owner-b', email: 'b@example.com', fullName: 'Owner B' };

    findMock.mockReturnValue(
      buildQuery([
        { name: 'Milk', owner: ownerA },
        { name: 'Bread', owner: ownerA },
        { name: 'Eggs', owner: ownerB },
      ])
    );

    await cronCallback();

    expect(findMock).toHaveBeenCalledTimes(1);
    expect(sendExpiryReminderMock).toHaveBeenCalledTimes(2);

    const [emailA, productsA, nameA] = sendExpiryReminderMock.mock.calls.find(
      (call) => call[0] === 'a@example.com'
    );
    expect(nameA).toBe('Owner A');
    expect(productsA).toHaveLength(2);

    const [emailB, productsB] = sendExpiryReminderMock.mock.calls.find(
      (call) => call[0] === 'b@example.com'
    );
    expect(productsB).toHaveLength(1);
  });

  it('should not send any emails when there are no expiring products', async () => {
    startCronJobs();
    const cronCallback = scheduleMock.mock.calls[0][1];

    findMock.mockReturnValue(buildQuery([]));

    await cronCallback();

    expect(sendExpiryReminderMock).not.toHaveBeenCalled();
  });

  it('should not throw when the database query fails', async () => {
    startCronJobs();
    const cronCallback = scheduleMock.mock.calls[0][1];

    findMock.mockImplementation(() => {
      throw new Error('db down');
    });

    await expect(cronCallback()).resolves.toBeUndefined();
    expect(sendExpiryReminderMock).not.toHaveBeenCalled();
  });
});