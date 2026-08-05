import { jest } from '@jest/globals';

const sendMailMock = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../config/nodemailer.js', () => ({
  default: { sendMail: sendMailMock },
  sendEmail: jest.fn(),
}));

const { sendOTP, sendOrderConfirmationEmail } = await import('../services/emailService.js');

beforeEach(() => {
  sendMailMock.mockClear();
});

describe('sendOTP', () => {
  it('should send the OTP verification email to the given address', async () => {
    await sendOTP('user@example.com', '654321');

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const call = sendMailMock.mock.calls[0][0];
    expect(call.to).toBe('user@example.com');
    expect(call.subject).toBe('ExpireOFF Verification Code');
    expect(call.html).toContain('654321');
  });
});

describe('sendOrderConfirmationEmail', () => {
  it('should send order confirmation details to the buyer', async () => {
    const details = {
      bookingId: 'BOOK123',
      productName: 'Paneer',
      quantity: 2,
      totalPrice: 200,
      buyerName: 'Frank',
    };

    await sendOrderConfirmationEmail('buyer@example.com', details);

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const call = sendMailMock.mock.calls[0][0];
    expect(call.to).toBe('buyer@example.com');
    expect(call.subject).toBe('Order Confirmed: expireOFF Booking #BOOK123');
    expect(call.html).toContain('Paneer');
    expect(call.html).toContain('Frank');
    expect(call.html).toContain('200');
  });

  it('should not throw when sending the email fails', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('smtp down'));

    await expect(
      sendOrderConfirmationEmail('buyer@example.com', {
        bookingId: 'BOOK456',
        productName: 'Ghee',
        quantity: 1,
        totalPrice: 300,
        buyerName: 'Grace',
      })
    ).resolves.toBeUndefined();
  });
});