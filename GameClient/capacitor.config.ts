import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'vn.vigo.billiardsparty',
  appName: 'VIGO Bida',
  webDir: 'dist',
  backgroundColor: '#140c26',
  server: { androidScheme: 'https' },
  android: { allowMixedContent: false },
};

export default config;
