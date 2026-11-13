// Bare React Native (no Expo). `@/` points at src/ so ported screens keep their
// imports; the shared repo-root .env provides ONLY the public values below
// (anything else in .env is never bundled into the app).
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    ['module-resolver', { root: ['./src'], alias: { '@': './src' } }],
    [
      'module:react-native-dotenv',
      {
        moduleName: '@env',
        path: '../.env',
        safe: false,
        allowUndefined: true,
        allowlist: [
          'EXPO_PUBLIC_SUPABASE_URL',
          'EXPO_PUBLIC_SUPABASE_ANON_KEY',
          'EXPO_PUBLIC_ONESIGNAL_APP_ID',
        ],
      },
    ],
  ],
};
