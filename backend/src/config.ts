import { z } from 'zod';
import { isAbsolute } from 'node:path';
import { kaiCreditCommerceCapability } from './commerce/capabilities.js';

const optionalText = z.string().trim().optional().transform((value) => value || undefined);

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().trim().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  PUBLIC_ORIGIN: z.string().url().default('http://127.0.0.1:4100'),
  DATABASE_URL: optionalText,
  DATABASE_SSL: z.enum(['true', 'false']).default('false'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  ACCESS_TOKEN_SECRET: optionalText,
  REFRESH_TOKEN_PEPPER: optionalText,
  OTP_PEPPER: optionalText,
  PII_ENCRYPTION_KEY: optionalText,
  AUDIT_PEPPER: optionalText,
  CURSOR_SECRET: optionalText,
  SMS_PROVIDER: optionalText,
  SMS_ACCESS_KEY_ID: optionalText,
  SMS_ACCESS_KEY_SECRET: optionalText,
  SMS_SIGN_NAME: optionalText,
  SMS_TEMPLATE_CODE: optionalText,
  ALIPAY_APP_ID: optionalText,
  ALIPAY_PRIVATE_KEY: optionalText,
  ALIPAY_PUBLIC_KEY: optionalText,
  ALIPAY_SELLER_ID: optionalText,
  ALIPAY_NOTIFY_URL: optionalText,
  ALIPAY_RETURN_URL: optionalText,
  TOPUP_ALIPAY_NOTIFY_URL: optionalText,
  WECHAT_APP_ID: optionalText,
  WECHAT_MCH_ID: optionalText,
  WECHAT_API_V3_KEY: optionalText,
  WECHAT_PRIVATE_KEY: optionalText,
  WECHAT_MERCHANT_CERT_SERIAL: optionalText,
  WECHAT_PLATFORM_CERT_SERIAL: optionalText,
  WECHAT_NOTIFY_URL: optionalText,
  WECHAT_REFUND_NOTIFY_URL: optionalText,
  TOPUP_WECHAT_NOTIFY_URL: optionalText,
  WECHAT_PLATFORM_CERTIFICATE: optionalText,
  PUSH_PROVIDER: optionalText,
  PUSH_CREDENTIALS_JSON: optionalText,
  OBJECT_STORAGE_PROVIDER: optionalText,
  OBJECT_STORAGE_ENDPOINT: optionalText,
  OBJECT_STORAGE_REGION: optionalText,
  OBJECT_STORAGE_BUCKET: optionalText,
  OBJECT_STORAGE_ACCESS_KEY: optionalText,
  OBJECT_STORAGE_SECRET_KEY: optionalText,
  OBJECT_STORAGE_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false'),
  CLAMAV_HOST: optionalText,
  CLAMAV_PORT: optionalText,
  METRICS_BEARER_TOKEN: optionalText,
  BACKUP_ENCRYPTION_KEY: optionalText,
  BACKUP_KEY_ID: optionalText,
  BACKUP_LOCAL_DIRECTORY: optionalText,
  BACKUP_S3_ENDPOINT: optionalText,
  BACKUP_S3_REGION: optionalText,
  BACKUP_S3_BUCKET: optionalText,
  BACKUP_S3_ACCESS_KEY: optionalText,
  BACKUP_S3_SECRET_KEY: optionalText,
  BACKUP_S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false'),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().min(7).max(3650).default(35),
  LEGAL_ENTITY_NAME: optionalText,
  UNIFIED_SOCIAL_CREDIT_CODE: optionalText,
  SUPPORT_EMAIL: optionalText,
  SUPPORT_PHONE: optionalText,
  PRIVACY_POLICY_URL: optionalText,
  TERMS_URL: optionalText,
  ICP_FILING: optionalText,
  APP_FILING: optionalText,
});

type Capability = Readonly<{ available: boolean; missing: string[] }>;

function capability(environment: Record<string, string | undefined>, keys: string[]): Capability {
  const missing = keys.filter((key) => !environment[key]?.trim());
  return { available: missing.length === 0, missing };
}

function mergeCapability(base: Capability, invalid: string[]): Capability {
  const missing = [...new Set([...base.missing, ...invalid])];
  return { available: missing.length === 0, missing };
}

function pushCapability(environment: Record<string, string | undefined>, parsed: {
  PUSH_PROVIDER: string | undefined; PUSH_CREDENTIALS_JSON: string | undefined;
}): Capability {
  const base = capability(environment, ['PUSH_PROVIDER', 'PUSH_CREDENTIALS_JSON']);
  const invalid: string[] = [];
  if (parsed.PUSH_PROVIDER && parsed.PUSH_PROVIDER !== 'expo') invalid.push('PUSH_PROVIDER(expo)');
  if (parsed.PUSH_CREDENTIALS_JSON) {
    try {
      const credentials = JSON.parse(parsed.PUSH_CREDENTIALS_JSON) as { accessToken?: unknown };
      if (!credentials || typeof credentials !== 'object'
        || typeof credentials.accessToken !== 'string' || credentials.accessToken.trim().length < 32) {
        invalid.push('PUSH_CREDENTIALS_JSON(accessToken>=32 chars)');
      }
    } catch {
      invalid.push('PUSH_CREDENTIALS_JSON(valid JSON)');
    }
  }
  return mergeCapability(base, invalid);
}

function secretCapability(environment: Record<string, string | undefined>): Capability {
  const requirements: Array<[string, number]> = [
    ['ACCESS_TOKEN_SECRET', 64],
    ['REFRESH_TOKEN_PEPPER', 32],
    ['OTP_PEPPER', 32],
    ['AUDIT_PEPPER', 32],
    ['CURSOR_SECRET', 32],
  ];
  const missing = requirements.flatMap(([key, minimum]) => {
    const length = environment[key]?.trim().length ?? 0;
    return length >= minimum ? [] : [`${key}(>=${minimum} chars)`];
  });
  const encryptionKey = environment.PII_ENCRYPTION_KEY?.trim();
  if (!encryptionKey || Buffer.from(encryptionKey, 'base64').length !== 32) {
    missing.push('PII_ENCRYPTION_KEY(base64 32 bytes)');
  }
  return { available: missing.length === 0, missing };
}

export type RuntimeConfig = ReturnType<typeof loadConfig>;

export function loadConfig(input: NodeJS.ProcessEnv | Record<string, string | undefined>) {
  const parsed = environmentSchema.parse(input);
  const environment = { ...input };
  const database = capability(environment, ['DATABASE_URL']);
  const tokenSecurity = secretCapability(environment);
  const publicHttps = new URL(parsed.PUBLIC_ORIGIN).protocol === 'https:';
  const sms = capability(environment, [
    'SMS_PROVIDER', 'SMS_ACCESS_KEY_ID', 'SMS_ACCESS_KEY_SECRET', 'SMS_SIGN_NAME', 'SMS_TEMPLATE_CODE',
  ]);
  const alipay = capability(environment, [
    'ALIPAY_APP_ID', 'ALIPAY_PRIVATE_KEY', 'ALIPAY_PUBLIC_KEY', 'ALIPAY_SELLER_ID', 'TOPUP_ALIPAY_NOTIFY_URL',
  ]);
  const wechatBase = capability(environment, [
    'WECHAT_APP_ID', 'WECHAT_MCH_ID', 'WECHAT_API_V3_KEY', 'WECHAT_PRIVATE_KEY', 'WECHAT_MERCHANT_CERT_SERIAL',
    'WECHAT_PLATFORM_CERT_SERIAL', 'TOPUP_WECHAT_NOTIFY_URL', 'WECHAT_PLATFORM_CERTIFICATE',
  ]);
  const expectedAlipayTopupNotify = new URL('/mobile/v1/credits/topups/alipay/notify', parsed.PUBLIC_ORIGIN).toString();
  const expectedWechatTopupNotify = new URL('/mobile/v1/credits/topups/wechat/notify', parsed.PUBLIC_ORIGIN).toString();
  const alipayTopup = mergeCapability(alipay, parsed.TOPUP_ALIPAY_NOTIFY_URL
    && parsed.TOPUP_ALIPAY_NOTIFY_URL !== expectedAlipayTopupNotify ? ['TOPUP_ALIPAY_NOTIFY_URL(exact public route)'] : []);
  const wechat = mergeCapability(wechatBase, [
    ...(parsed.WECHAT_API_V3_KEY && Buffer.byteLength(parsed.WECHAT_API_V3_KEY) !== 32
      ? ['WECHAT_API_V3_KEY(exactly 32 bytes)'] : []),
    ...(parsed.TOPUP_WECHAT_NOTIFY_URL && parsed.TOPUP_WECHAT_NOTIFY_URL !== expectedWechatTopupNotify
      ? ['TOPUP_WECHAT_NOTIFY_URL(exact public route)'] : []),
  ]);
  const creditCommerce = kaiCreditCommerceCapability({ verifiedTopupProviderAvailable: alipayTopup.available || wechat.available });
  const push = pushCapability(environment, parsed);
  const objectStorageBase = capability(environment, [
    'OBJECT_STORAGE_PROVIDER', 'OBJECT_STORAGE_ENDPOINT', 'OBJECT_STORAGE_REGION', 'OBJECT_STORAGE_BUCKET',
    'OBJECT_STORAGE_ACCESS_KEY', 'OBJECT_STORAGE_SECRET_KEY',
  ]);
  const storageEndpointProtocol = parsed.OBJECT_STORAGE_ENDPOINT
    ? (() => { try { return new URL(parsed.OBJECT_STORAGE_ENDPOINT).protocol; } catch { return 'invalid:'; } })()
    : null;
  const objectStorage = mergeCapability(objectStorageBase, [
    ...(parsed.OBJECT_STORAGE_PROVIDER && parsed.OBJECT_STORAGE_PROVIDER !== 's3' ? ['OBJECT_STORAGE_PROVIDER(s3)'] : []),
    ...(storageEndpointProtocol && storageEndpointProtocol !== 'https:' && parsed.NODE_ENV === 'production' ? ['OBJECT_STORAGE_ENDPOINT(HTTPS)'] : []),
  ]);
  const malwareBase = capability(environment, ['CLAMAV_HOST', 'CLAMAV_PORT']);
  const clamavPort = Number(parsed.CLAMAV_PORT);
  const malwareScanning = mergeCapability(malwareBase,
    parsed.CLAMAV_PORT && (!Number.isInteger(clamavPort) || clamavPort < 1 || clamavPort > 65535)
      ? ['CLAMAV_PORT(1-65535)']
      : []);
  const legal = capability(environment, [
    'LEGAL_ENTITY_NAME', 'UNIFIED_SOCIAL_CREDIT_CODE', 'SUPPORT_EMAIL', 'SUPPORT_PHONE',
    'PRIVACY_POLICY_URL', 'TERMS_URL', 'ICP_FILING', 'APP_FILING',
  ]);
  const metricsBase = capability(environment, ['METRICS_BEARER_TOKEN']);
  const observability = mergeCapability(metricsBase,
    parsed.METRICS_BEARER_TOKEN && parsed.METRICS_BEARER_TOKEN.length < 32
      ? ['METRICS_BEARER_TOKEN(>=32 chars)']
      : []);
  const backupBase = capability(environment, [
    'BACKUP_ENCRYPTION_KEY', 'BACKUP_KEY_ID', 'BACKUP_LOCAL_DIRECTORY', 'BACKUP_S3_ENDPOINT', 'BACKUP_S3_REGION',
    'BACKUP_S3_BUCKET', 'BACKUP_S3_ACCESS_KEY', 'BACKUP_S3_SECRET_KEY',
  ]);
  const backupKey = parsed.BACKUP_ENCRYPTION_KEY?.trim();
  const backupEndpointProtocol = parsed.BACKUP_S3_ENDPOINT
    ? (() => { try { return new URL(parsed.BACKUP_S3_ENDPOINT).protocol; } catch { return 'invalid:'; } })()
    : null;
  const backup = mergeCapability(backupBase, [
    ...(backupKey && Buffer.from(backupKey, 'base64').length !== 32 ? ['BACKUP_ENCRYPTION_KEY(base64 32 bytes)'] : []),
    ...(parsed.BACKUP_KEY_ID && !/^[A-Za-z0-9._-]{4,64}$/u.test(parsed.BACKUP_KEY_ID) ? ['BACKUP_KEY_ID(4-64 safe chars)'] : []),
    ...(parsed.BACKUP_LOCAL_DIRECTORY && !isAbsolute(parsed.BACKUP_LOCAL_DIRECTORY) ? ['BACKUP_LOCAL_DIRECTORY(absolute path)'] : []),
    ...(backupEndpointProtocol && backupEndpointProtocol !== 'https:' && parsed.NODE_ENV === 'production' ? ['BACKUP_S3_ENDPOINT(HTTPS)'] : []),
  ]);
  const coreBlockers = [
    ...database.missing,
    ...tokenSecurity.missing,
    ...(publicHttps || parsed.NODE_ENV !== 'production' ? [] : ['PUBLIC_ORIGIN(HTTPS)']),
  ];
  const serviceBlockers = [
    ...coreBlockers,
    ...sms.missing,
    ...push.missing,
    ...objectStorage.missing,
    ...malwareScanning.missing,
    ...observability.missing,
    ...backup.missing,
    ...legal.missing,
  ];
  const commerceBlockers = [...serviceBlockers, ...creditCommerce.blockers];

  return {
    ...parsed,
    databaseSsl: parsed.DATABASE_SSL === 'true',
    trustedProxy: parsed.TRUST_PROXY_HOPS === 0 ? false : parsed.TRUST_PROXY_HOPS,
    objectStorageForcePathStyle: parsed.OBJECT_STORAGE_FORCE_PATH_STYLE === 'true',
    backupS3ForcePathStyle: parsed.BACKUP_S3_FORCE_PATH_STYLE === 'true',
    readiness: {
      coreReady: coreBlockers.length === 0,
      serviceReady: serviceBlockers.length === 0,
      releaseReady: commerceBlockers.length === 0,
      coreBlockers: [...new Set(coreBlockers)],
      serviceBlockers: [...new Set(serviceBlockers)],
      releaseBlockers: [...new Set(commerceBlockers)],
      capabilities: {
        database, tokenSecurity, sms, alipay: alipayTopup, wechat, push, objectStorage, malwareScanning, observability, backup, legal,
        publicHttps, creditCommerce,
      },
    },
  } as const;
}
