import '@testing-library/jest-dom';
import {afterAll, afterEach, beforeAll} from 'vitest';
import {server} from './test-utils/msw/server';

const storage = new Map<string, string>();

// Some local test environments do not provide a writable Storage object, but
// the auth provider relies on localStorage for bootstrapping auth state.
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
  },
});

beforeAll(() => server.listen({onUnhandledRequest: 'error'}));

afterEach(() => {
  server.resetHandlers();
  window.localStorage.clear();
});

afterAll(() => server.close());
