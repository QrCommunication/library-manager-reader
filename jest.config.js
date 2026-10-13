module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.(ts|tsx)'],
  testTimeout: 20000,
  maxWorkers: 2,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  transformIgnorePatterns: [
    'node_modules/(?:((?:jest-)?react-native|@react-native(-community)?)/.*)!',
    'node_modules/(react-native-webview|foliate-js|fflate|zustand|i18next|react-i18next)/.*',
  ],
};
