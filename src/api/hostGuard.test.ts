import { describe, expect, it } from 'vitest';
import { isAllowedHost } from './hostGuard.ts';

describe('isAllowedHost', () => {
  it('allows localhost with and without a port', () => {
    expect(isAllowedHost('localhost:7777')).toBe(true);
    expect(isAllowedHost('localhost')).toBe(true);
    expect(isAllowedHost('LOCALHOST:7777')).toBe(true);
  });

  it('allows loopback IPs', () => {
    expect(isAllowedHost('127.0.0.1:7777')).toBe(true);
    expect(isAllowedHost('127.0.0.1')).toBe(true);
    expect(isAllowedHost('[::1]:7777')).toBe(true);
    expect(isAllowedHost('[::1]')).toBe(true);
  });

  it('allows the Vite dev server port (hostname is what matters)', () => {
    expect(isAllowedHost('localhost:5173')).toBe(true);
  });

  it('rejects external domains, including ones that resolve to 127.0.0.1', () => {
    expect(isAllowedHost('evil.example.com')).toBe(false);
    expect(isAllowedHost('evil.example.com:7777')).toBe(false);
    expect(isAllowedHost('localhost.evil.example.com')).toBe(false);
    expect(isAllowedHost('127.0.0.1.evil.example.com')).toBe(false);
  });

  it('rejects a missing or empty Host header', () => {
    expect(isAllowedHost(undefined)).toBe(false);
    expect(isAllowedHost('')).toBe(false);
  });

  it('rejects non-loopback IPs', () => {
    expect(isAllowedHost('192.168.1.10:7777')).toBe(false);
    expect(isAllowedHost('0.0.0.0:7777')).toBe(false);
  });
});
