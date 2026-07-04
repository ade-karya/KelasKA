import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kelaska.app',
  appName: 'KelasKA',
  webDir: '../out', // Points to Next.js static output directory if built statically
  bundledWebRuntime: false,
  server: {
    // In production, Capacitor wraps the remote Web LMS URL to access database, AI endpoints, and streaming
    url: 'http://10.0.2.2:3000', 
    cleartext: true,
    allowNavigation: [
      'kelaska.com',
      '*.kelaska.com',
      'accounts.google.com',
      '10.0.2.2:3000'
    ]
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"]
    }
  }
};

export default config;
