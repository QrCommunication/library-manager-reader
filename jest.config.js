module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.(ts|tsx)'],
  transformIgnorePatterns: [
    'node_modules/(?:((?:jest-)?react-native|@react-native(-community)?)/.*)!',
    'node_modules/(react-native-webview|foliate-js|fflate|zustand|i18next|react-i18next)/.*',
  ],
};
