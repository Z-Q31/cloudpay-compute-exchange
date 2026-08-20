# CloudPay 算力交易平台

CloudPay 是面向企业采购方与企业供应商的算力撮合平台，覆盖 GPU、模型 Token、机柜/柜月等资源的展示、估值、存取、置换、订单、支付回调、计量、验收、结算和供应商返佣流程。

本仓库同时包含：

- `server.py`：CloudPay 服务端、容量账本、交易接口及 KAI Identity 登录回调；
- `outputs/`：响应式网页端，可用于电脑和手机浏览器；
- `mobile/`：基于 Capacitor 的 Android/iOS App 工程；
- `app-store-release/`：应用商店文案、协议、隐私与审核材料；
- `work/`：KAI Identity 客户端登记、部署和验证工具；
- `kai-production.env`：生产环境变量模板，不包含真实密钥。

## 供应商返佣

网页端“供应商返佣”采用成交卡时返还模型，不包含推广伙伴或现金佣金。供应商 GPU 卡时订单完成验收后，平台以成交卡时为基数，按单笔订单金额匹配比例：1–1,000 元返 1%，1,000–10,000 元返 0.8%，10,000–30,000 元返 0.5%，30,000–50,000 元返 0.3%，超过 50,000 元统一返 0.2%。

5 万元及以下自动生成返佣卡时资产并进入供应商算力库；超过 5 万元必须由平台审核后发放。争议或退款会冻结、冲正返佣资产，已使用的卡时进入追偿状态。

## KAI Identity 统一登录

网页与 App 均使用 KAI Identity。网页采用服务端 Authorization Code 流程；App 通过系统浏览器登录，并回跳到 `cloudpay://auth/callback`。客户端密钥和身份访问令牌只保存在服务端，不写入网页或安装包。

需要在 KAI Identity 为 CloudPay 客户端登记以下回调：

- `https://cloudpay.kai.com/api/auth/kai/callback`
- `https://cloudpay.kai.com/api/auth/kai/mobile/callback`

生产环境必须在受限配置中填写 `KAI_IDENTITY_CLIENT_ID` 和 `KAI_IDENTITY_CLIENT_SECRET`，不得把真实密钥提交到仓库。

## 本地运行

1. 安装 Python 3.11 或更高版本。
2. 安装依赖：`python -m pip install -r requirements.txt`。
3. 根据 `kai-production.env` 在本机设置必要环境变量；本地调试可使用独立数据库路径。
4. 运行：`python server.py`。

默认监听地址和端口由 `KAI_HOST`、`KAI_PORT` 控制。生产环境使用 systemd 与 Nginx，示例配置见 `kai-transaction.service` 和 `nginx-kai.conf`。

## App 工程

进入 `mobile/` 后运行：

```text
npm install
npm run preflight
npm run sync
```

Android 使用 Android Studio/Gradle 生成签名 AAB；iOS 必须在 macOS 与 Xcode 中使用企业开发者证书归档。版本、原生回跳和发布注意事项见 `mobile/README.md`。

## 安全约束

- 不提交数据库、运行日志、用户数据、支付密钥、短信密钥或身份客户端密钥；
- 不提交 Android/iOS 签名证书、keystore、描述文件或云主账号凭据；
- 支付成功状态只接受银行或持牌支付机构的服务端签名通知；
- 连接器上报、支付回调和所有写接口必须执行签名、幂等和审计校验。

线上地址：[https://cloudpay.kai.com](https://cloudpay.kai.com)
