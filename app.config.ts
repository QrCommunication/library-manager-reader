export default {
  expo: {
    name: 'Library Reader',
    slug: 'library-reader',
    version: '0.1.0',
    // follow device orientation: Fold cover/inner transitions, tablets and
    // landscape phones are first-class layouts (reader reflows via foliate)
    orientation: 'default',
    scheme: 'lmr',
    userInterfaceStyle: 'automatic',
    ios: { bundleIdentifier: 'com.librarymanager.reader', supportsTablet: true },
    android: { package: 'com.librarymanager.reader', adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#ffffff' } },
    plugins: ['expo-router'],
    experiments: { typedRoutes: true },
    extra: {
      eas: {
        projectId: '35e9a773-cf50-4fec-95b3-bec4a785b2af',
      },
    },
  },
};
