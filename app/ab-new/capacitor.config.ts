import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.abnew.app',
  appName: 'AB-new',
  webDir: 'dist',
  backgroundColor: '#020617',
  plugins: {
    CapacitorHttp: { enabled: true },
    LocalNotifications: {
      smallIcon: 'ic_launcher',
      iconColor: '#38bdf8',
    },
  },
};

export default config;
