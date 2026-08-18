const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.endsWith('/native-payments') || moduleName === './native-payments') {
    const channel = process.env.CLOUDPAY_DISTRIBUTION_CHANNEL?.trim() || 'direct-cn';
    if (channel !== 'direct-cn') {
      return { type: 'sourceFile', filePath: path.resolve(__dirname, 'src/native-payments-disabled.ts') };
    }
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
