export default {
  expo: {
    name: 'Library Reader',
    slug: 'library-reader',
    owner: 'ronylicha',
    version: '0.6.0',
    // follow device orientation: Fold cover/inner transitions, tablets and
    // landscape phones are first-class layouts (reader reflows via foliate)
    orientation: 'default',
    icon: './assets/icon.png',
    splash: { image: './assets/splash-icon.png', backgroundColor: '#17263d', resizeMode: 'contain' },
    scheme: 'lmr',
    userInterfaceStyle: 'automatic',
    ios: {
      bundleIdentifier: 'com.librarymanager.reader',
      supportsTablet: true,
      // OAuth callback https://library-manager.com/mobile/callback arrives via
      // Universal Links (the association file lives on the server side)
      associatedDomains: ['applinks:library-manager.com'],
    },
    android: {
      package: 'com.librarymanager.reader',
      // Google Play versionCode: app version without dots (0.6.0 -> 060)
      versionCode: 60,
      adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#17263d' },
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: [{ scheme: 'https', host: 'library-manager.com', pathPrefix: '/mobile/callback' }],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
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
