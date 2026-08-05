import { jest } from '@jest/globals';
import { getClientIp, lookupLocationByIp } from '../utils/ipLocation.js';

describe('getClientIp', () => {
  it('should prefer the x-forwarded-for header when present', () => {
    const req = {
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    expect(getClientIp(req)).toBe('203.0.113.5');
  });

  it('should fall back to the socket remote address', () => {
    const req = { headers: {}, socket: { remoteAddress: '198.51.100.7' } };
    expect(getClientIp(req)).toBe('198.51.100.7');
  });

  it('should fall back to req.ip when the socket has no address', () => {
    const req = { headers: {}, socket: {}, ip: '198.51.100.8' };
    expect(getClientIp(req)).toBe('198.51.100.8');
  });
});

describe('lookupLocationByIp', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('should skip lookup and return empty fields for loopback addresses', async () => {
    const result = await lookupLocationByIp('127.0.0.1');
    expect(result).toEqual({ city: '', state: '', country: '', latitude: null, longitude: null });
  });

  it('should skip lookup and return empty fields for private IPv4 addresses', async () => {
    const result = await lookupLocationByIp('192.168.1.50');
    expect(result).toEqual({ city: '', state: '', country: '', latitude: null, longitude: null });
  });

  it('should skip lookup when the ip is missing', async () => {
    const result = await lookupLocationByIp(undefined);
    expect(result).toEqual({ city: '', state: '', country: '', latitude: null, longitude: null });
  });

  it('should return data from ipapi.co when it succeeds', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        city: 'Kochi',
        region: 'Kerala',
        country_name: 'India',
        latitude: 9.9312,
        longitude: 76.2673,
      }),
    });

    const result = await lookupLocationByIp('203.0.113.5');

    expect(result).toEqual({
      city: 'Kochi',
      state: 'Kerala',
      country: 'India',
      latitude: 9.9312,
      longitude: 76.2673,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith('https://ipapi.co/203.0.113.5/json/');
  });

  it('should fall back to geolocation-db.com when ipapi.co has no city', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ city: 'Not found' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          city: 'Mumbai',
          state: 'Maharashtra',
          country_name: 'India',
          latitude: 19.076,
          longitude: 72.8777,
        }),
      });

    const result = await lookupLocationByIp('203.0.113.6');

    expect(result).toEqual({
      city: 'Mumbai',
      state: 'Maharashtra',
      country: 'India',
      latitude: 19.076,
      longitude: 72.8777,
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('should fall back to ipinfo.io when the first two providers fail', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          city: 'Delhi',
          region: 'Delhi',
          country: 'India',
          loc: '28.7041,77.1025',
        }),
      });

    const result = await lookupLocationByIp('203.0.113.7');

    expect(result).toEqual({
      city: 'Delhi',
      state: 'Delhi',
      country: 'India',
      latitude: 28.7041,
      longitude: 77.1025,
    });
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('should return null coordinates when all providers fail', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network error'));

    const result = await lookupLocationByIp('203.0.113.8');

    expect(result).toEqual({ city: '', state: '', country: '', latitude: null, longitude: null });
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});