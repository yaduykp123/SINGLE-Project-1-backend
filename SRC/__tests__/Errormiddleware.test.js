import { jest } from '@jest/globals';
import errorMiddleware from '../middlewares/errorMiddleware.js';

const buildRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const buildReq = () => ({ method: 'GET', originalUrl: '/api/test' });

describe('Error Middleware', () => {
  it('should format Mongoose validation errors as 400', () => {
    const err = {
      name: 'ValidationError',
      errors: {
        email: { message: 'Email is required' },
        phone: { message: 'Phone is required' },
      },
    };
    const req = buildReq();
    const res = buildRes();

    errorMiddleware(err, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Validation Error',
      errors: ['Email is required', 'Phone is required'],
    });
  });

  it('should format duplicate key errors as 400 with the field name', () => {
    const err = { code: 11000, keyValue: { email: 'dup@example.com' } };
    const req = buildReq();
    const res = buildRes();

    errorMiddleware(err, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Email already exists',
    });
  });

  it('should give a special message for a duplicate firebaseUid index', () => {
    const err = { code: 11000, keyValue: { firebaseUid: 'abc123' } };
    const req = buildReq();
    const res = buildRes();

    errorMiddleware(err, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toContain('Restart the server');
  });

  it('should return 401 for invalid JWT errors', () => {
    const err = { name: 'JsonWebTokenError', message: 'jwt malformed' };
    const req = buildReq();
    const res = buildRes();

    errorMiddleware(err, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Invalid token' });
  });

  it('should return 401 for expired JWT errors', () => {
    const err = { name: 'TokenExpiredError', message: 'jwt expired' };
    const req = buildReq();
    const res = buildRes();

    errorMiddleware(err, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Token expired. Please login again.',
    });
  });

  it('should default to the error statusCode when provided', () => {
    const err = { statusCode: 404, message: 'Not found' };
    const req = buildReq();
    const res = buildRes();

    errorMiddleware(err, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Not found' });
  });

  it('should fall back to 500 for unrecognized errors', () => {
    const err = { message: 'Something exploded' };
    const req = buildReq();
    const res = buildRes();

    errorMiddleware(err, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Something exploded',
    });
  });

  it('should use a generic message when the error has none', () => {
    const err = {};
    const req = buildReq();
    const res = buildRes();

    errorMiddleware(err, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Internal Server Error',
    });
  });
});