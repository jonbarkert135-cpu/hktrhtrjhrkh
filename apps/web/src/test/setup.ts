// jsdom ships no IndexedDB; the local-first stack needs one in every suite (P3).
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
