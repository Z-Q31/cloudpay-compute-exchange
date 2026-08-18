# KAI Cloud 支付与短信通道配置

本文件只列配置项，不应填写或提交真实密钥。生产密钥应直接写入服务器的受限环境文件，证书应放入仅服务账户可读的目录。

## 撮合平台与首单参数

- `KAI_PLATFORM_MODE=marketplace`：供应商是实际服务提供方，KAI 负责验真、撮合、账本和交易流程。
- `KAI_SEED_CATALOG=false`：生产环境不展示演示供应商或虚构库存。
- `KAI_ORDER_RESERVATION_MINUTES=30`：待支付容量预留到期后自动释放。
- `KAI_SETTLEMENT_HOLD_HOURS=72`：采购方验收后的结算观察期。
- `KAI_PLATFORM_FEE_BPS=500`：平台服务费，单位为万分之一；`500` 表示 5%。
- `KAI_METERING_TOLERANCE_RATIO=0.02`：双源计量允许差异，`0.02` 表示 2%。
- `KAI_ADMIN_ACCOUNT`、`KAI_ADMIN_PASSWORD`：仅用于首次创建运营管理员。首次登录后必须在运营台修改密码，其他会话会被注销。

平台不得使用普通商户账户代收后再人工转付供应商。支付适配服务必须支持平台型子商户或持牌分账，并返回可核对的分账流水号。

## 短信验证码（阿里云短信）

服务端使用阿里云短信 Python 官方 SDK。需要配置：

- `KAI_SMS_PROVIDER=aliyun`
- `KAI_REQUIRE_SMS=true`
- `KAI_OTP_HASH_SECRET`：至少 32 字节随机值
- `ALIBABA_CLOUD_ACCESS_KEY_ID`：最小权限 RAM 用户的 AccessKey ID
- `ALIBABA_CLOUD_ACCESS_KEY_SECRET`：对应 Secret
- `KAI_SMS_SIGN_NAME`：审核通过的短信签名
- `KAI_SMS_TEMPLATE_CODE`：审核通过的验证码模板编号，如 `SMS_...`

验证码由服务端随机生成，只保存 HMAC 摘要，5 分钟失效，最多尝试 5 次。接口不会向生产前端返回明文验证码。

## 支付通道

KAI 主服务不自行实现支付宝或微信的签名算法，而是连接使用官方 SDK 的支付适配服务。适配服务负责创建收银台、验证支付机构回调，再把标准化且签名的事件送回 KAI。

共同要求：

- `KAI_PUBLIC_BASE_URL=https://实际域名`
- HTTPS 启用后设置 `KAI_COOKIE_SECURE=true`
- 支付适配服务必须使用 HTTPS
- 前端返回页不修改订单状态；只接受适配服务签名通知
- 桌面端与手机端必须显式传递支付场景：支付宝 `web/wap`，微信 `native/h5`
- KAI 到适配器的请求使用 `X-KAI-Gateway-Signature`；适配器响应必须使用 `X-KAI-Adapter-Signature` 对原始响应正文签名
- 创建支付与退款请求必须接受 `Idempotency-Key`，相同键不得重复创建支付机构交易

支付宝：

- `KAI_ALIPAY_MERCHANT_ID`
- `KAI_ALIPAY_ADAPTER_URL`
- `KAI_ALIPAY_CALLBACK_SECRET`
- `KAI_ALIPAY_MARKETPLACE_MODE=enabled`：表示子商户或持牌分账配置已经完成
- 支付宝应用 AppID、应用私钥及支付宝公钥/证书只保存在支付宝适配服务

微信支付：

- `KAI_WECHAT_MERCHANT_ID`
- `KAI_WECHAT_ADAPTER_URL`
- `KAI_WECHAT_CALLBACK_SECRET`
- `KAI_WECHAT_MARKETPLACE_MODE=enabled`：表示子商户或持牌分账配置已经完成
- AppID、商户私钥、证书序列号、APIv3 密钥只保存在微信支付适配服务

服务状态可通过 `GET /api/config/readiness` 检查；响应只展示缺失项，不返回密钥或证书内容。

支付适配服务还需要提供：

- 创建收银台接口；
- 服务端主动查单与日对账；
- `POST /refund` 退款接口；
- 向 `/api/payments/refund-callback/{provider}` 发送签名退款结果；
- 子商户/分账结果与流水查询。

完整外部资料、生产验收和阻断项见 `PAYMENT_AND_LAUNCH_BLOCKERS.md`。
