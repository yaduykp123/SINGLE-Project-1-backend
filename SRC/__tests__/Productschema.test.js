import Product from '../models/productSchema.js';

// These tests construct documents in memory only (no .save()), so no DB
// connection is required to exercise the discountPercent virtual.
describe('Product Schema - discountPercent virtual', () => {
  it('should calculate the correct discount percentage', () => {
    const product = new Product({ marketPrice: 200, discountPrice: 150 });
    expect(product.discountPercent).toBe(25);
  });

  it('should round to the nearest whole number', () => {
    const product = new Product({ marketPrice: 99, discountPrice: 66 });
    // (99-66)/99 = 33.33% -> rounds to 33
    expect(product.discountPercent).toBe(33);
  });

  it('should return 0 when there is no discount', () => {
    const product = new Product({ marketPrice: 100, discountPrice: 100 });
    expect(product.discountPercent).toBe(0);
  });

  it('should return 0 when marketPrice is 0 to avoid division by zero', () => {
    const product = new Product({ marketPrice: 0, discountPrice: 0 });
    expect(product.discountPercent).toBe(0);
  });

  it('should include the virtual when serialized to JSON', () => {
    const product = new Product({ marketPrice: 100, discountPrice: 75 });
    const json = product.toJSON();
    expect(json.discountPercent).toBe(25);
  });
});