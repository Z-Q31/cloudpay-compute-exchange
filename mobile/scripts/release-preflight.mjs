const required = ['KAI_APP_SERVER_URL'];
const missing = required.filter(name => !process.env[name]);
if (missing.length) {
  console.error(`缺少发布配置：${missing.join(', ')}`);
  console.error('示例：KAI_APP_SERVER_URL=https://your-domain.example');
  process.exit(1);
}
const url = new URL(process.env.KAI_APP_SERVER_URL);
if (url.protocol !== 'https:') {
  console.error('正式 App 只允许 HTTPS 服务地址。');
  process.exit(1);
}
if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)) {
  console.error('正式 App 不能指向本地或内网地址。');
  process.exit(1);
}
console.log(`App 服务地址通过检查：${url.origin}`);
