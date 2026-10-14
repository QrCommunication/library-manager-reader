export default {
  expo: {
    name: 'Library Reader',
    slug: 'library-reader',
    owner: 'ronylicha',
    version: '0.2.0',
    // follow device orientation: Fold cover/inner transitions, tablets and
    // landscape phones are first-class layouts (reader reflows via foliate)
    orientation: 'default',
    icon: './assets/icon.png',
    splash: { image: './assets/splash-icon.png', backgroundColor: '#17263d', resizeMode: 'contain' },
    scheme: 'lmr',
    userInterfaceStyle: 'automatic',
    ios: { bundleIdentifier: 'com.librarymanager.reader', supportsTablet: true },
    android: {
      package: 'com.librarymanager.reader',
      // Google Play versionCode: app version without dots (0.2.0 -> 020)
      versionCode: 20,
      adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#17263d' },
    },
    plugins: ['expo-router'],
    experiments: { typedRoutes: true },
    extra: {
      eas: {
        projectId: '35e9a773-cf50-4fec-95b3-bec4a785b2af',
      },
    },
  },
};
