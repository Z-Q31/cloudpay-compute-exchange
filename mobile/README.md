# KAI Cloud Mobile

该工程使用 Capacitor 8 封装现有响应式交易台，并接入系统分享、外部持牌支付收银台、原生安全区域和启动页。CloudPay App 与 `https://cloudpay.kai.com` 使用同一个服务端容量账本和行情接口，网页部署后 App 会读取同一线上版本。

## KAI Identity 统一登录

Android 与 iOS 均已登记 `cloudpay://auth/callback` 原生回跳。App 内先显示专用移动登录页，用户确认 KAI 账户邮箱后才进入受保护的身份验证步骤。登录使用系统浏览器和服务端 Authorization Code + PKCE 流程，KAI Identity 访问令牌及客户端密钥不会进入 App。登录完成后，CloudPay 服务端签发两分钟有效、只能使用一次且与 App 随机绑定码关联的登录票据，App 再用该票据建立自己的 HttpOnly 会话，并在页面更新前二次确认登录状态。

当前移动版本为 `1.2.0`：Android `versionCode 3`，iOS `CURRENT_PROJECT_VERSION 3`。修改原生回跳配置后必须重新签名并发布新安装包，旧版安装包不会自动获得新的 URL Scheme。

发布前必须先准备：

1. 把网站部署到已备案、证书有效的 HTTPS 域名；
2. 设置 `KAI_APP_SERVER_URL=https://你的正式域名`；
3. 在根站点的“账户与合规 → App 发布自检”中把全部阻断项处理为已配置；
4. 运行 `npm install`、`npm run assets` 和 `npx cap add android` / `npx cap add ios`；
5. Android 在 Android Studio 中使用企业签名生成 AAB；iOS 必须在 macOS + Xcode 中使用组织开发者证书归档并上传。

不要把支付密钥、短信密钥、Android keystore 密码、Apple API 私钥或云主账号密码提交进本仓库。
