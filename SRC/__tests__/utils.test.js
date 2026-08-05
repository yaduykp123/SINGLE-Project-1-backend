import { generateOTP, getOTPExpiry } from '../utils/generateOtp.js';
import { generateToken } from '../utils/generateToken.js';
import jwt from 'jsonwebtoken';

describe('Utils', () => {
  describe('generateOTP', () => {
    it('should generate 6 digit numeric OTP', () => {
      const otp = generateOTP();
      expect(otp).toMatch(/^\d{6}$/);
      expect(parseInt(otp)).toBeGreaterThanOrEqual(100000);
    });
  });

  describe('getOTPExpiry', () => {
    it('should return future date ~10 minutes ahead', () => {
      const before = new Date();
      const expiry = getOTPExpiry();
      const after = new Date();
      
      expect(expiry.getTime()).toBeGreaterThan(before.getTime() + 9 * 60 * 1000);
      expect(expiry.getTime()).toBeLessThan(after.getTime() + 11 * 60 * 1000);
    });
  });

  describe('generateToken', () => {
    it('should generate valid JWT', () => {
      const token = generateToken('user123');
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'testsecret');
      expect(decoded.id).toBe('user123');
    });
  });
});