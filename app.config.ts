export default {
  expo: {
    name: 'Library Reader',
    slug: 'library-reader',
    version: '0.1.0',
    orientation: 'portrait',
    scheme: 'lmr',
    userInterfaceStyle: 'automatic',
    ios: { bundleIdentifier: 'com.librarymanager.reader', supportsTablet: true },
    android: { package: 'com.librarymanager.reader', adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#ffffff' } },
    plugins: ['expo-router'],
    experiments: { typedRoutes: true },
  },
};
