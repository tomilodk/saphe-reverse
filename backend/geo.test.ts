// backend/saphe-reverse/backend/geo.test.ts
import { describe, test, expect } from "bun:test";
import { haversineDistance } from "./geo";

describe("haversineDistance", () => {
  test("~111km for 1 degree latitude", () => {
    const d = haversineDistance(56.0, 9.0, 57.0, 9.0);
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112000);
  });

  test("0 for same point", () => {
    expect(haversineDistance(56.0, 9.0, 56.0, 9.0)).toBe(0);
  });

  test("~75km returns approximately 75000m", () => {
    const d = haversineDistance(55.67, 12.56, 56.345, 12.56);
    expect(d).toBeGreaterThan(74000);
    expect(d).toBeLessThan(76000);
  });

  test("handles negative coordinates", () => {
    const d = haversineDistance(-33.87, 151.21, -33.87, 151.21);
    expect(d).toBe(0);
  });
});
