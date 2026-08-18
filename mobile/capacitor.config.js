const serverUrl = String(process.env.KAI_APP_SERVER_URL || '').trim();

module.exports = {
  appId: process.env.KAI_APP_ID || 'com.kaicloud.marketplace',
  appName: process.env.KAI_APP_NAME || 'CloudPay',
  webDir: 'www',
  bundledWebRuntime: false,
  backgroundColor: '#f3f8f4',
  server: serverUrl ? {
    url: serverUrl,
    cleartext: false,
    allowNavigation: [new URL(serverUrl).hostname]
  } : undefined,
  plugins: {
    SplashScreen: { launchShowDuration: 900, backgroundColor: '#f3f8f4', showSpinner: false },
    StatusBar: { style: 'LIGHT', backgroundColor: '#f3f8f4' }
  },
  ios: { contentInset: 'automatic', allowsLinkPreview: false },
  android: { allowMixedContent: false, captureInput: true }
};
