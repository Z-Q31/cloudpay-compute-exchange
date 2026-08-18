# KAI Cloud App 上架凭证清单

更新时间：2026-08-11。以下凭证应由实际运营企业申请，生产密钥只放在服务器密钥管理或受限环境文件中，不进入 GitHub、聊天记录或 App 安装包。

## 一、所有商店和支付渠道共用

- 营业执照、统一社会信用代码、法定代表人身份证明；
- 授权经办人身份证明、手机号、邮箱和加盖公章的授权书；
- 企业对公银行账户、开户证明、开票信息和实际办公/经营地址；
- App 中文名、英文名、Logo、业务说明、用户协议、隐私政策、注销说明、客服邮箱和客服电话；
- 自有正式域名、有效 HTTPS 证书、ICP备案号和 APP 备案号；
- 包名：Android `com.kaicloud.marketplace`，Bundle ID：iOS `com.kaicloud.marketplace`。首次提交前可以改，但创建商店记录和支付 AppID 后不要再改；
- 手机号、联系人、版权归属和软件著作权材料；国内安卓商店通常还会要求《计算机软件著作权登记证书》或符合其规则的电子版权证书；
- 审核账号：企业采购方、已认证供应商、运营管理员各一个，附登录方式、审核路径、示例订单和不发生真实扣款的说明；
- 商店素材：1024×1024 图标、启动图、手机截图、平板截图（如支持）、功能介绍、关键词、版本说明、隐私标签/数据安全表、内容分级和审核备注。

中国大陆提供互联网 App 服务需先完成 APP 备案并在 App 显著位置展示备案编号。KAI 是撮合交易平台，业务可能落入在线数据处理与交易处理业务范围；是否需要 B21/EDI 等增值电信业务许可应在正式收款前向属地通信管理局或电信专业律师确认并留存书面结论。

## 二、Apple App Store

- 企业/组织 Apple Developer Program 账号；申请人应有代表企业签署协议的权限；
- 企业 D‑U‑N‑S Number、企业法定名称、地址、电话和可公开验证的网站；
- 开启双重认证的 Apple Account、Team ID、App Store Connect 权限；
- App ID/Bundle ID、Distribution Certificate、Provisioning Profile；如采用 App Store Connect API 自动上传，还需 API Key ID、Issuer ID 和 `.p8` 私钥；
- App Store Connect 中的隐私政策 URL、支持 URL、隐私营养标签、年龄分级、出口合规、截图和审核账号；
- 如果 App 允许创建账户，审核时必须能在 App 内发起账户注销；本项目已提供该入口；
- 不要只提交一个无原生价值的网页壳。当前工程已经加入原生分享、外部支付、启动体验、深链处理和发布自检，但最终审核仍要用审核账号展示完整交易和供应商工作流；
- 是否在 App 内使用支付宝/微信，应按 Apple 对本业务“企业服务/现实世界服务”的最终分类执行。不要在未获得 Apple 审核确认前自行规避 IAP 规则。

官方办理入口：

- Apple Developer 注册：<https://developer.apple.com/help/account/membership/program-enrollment>
- D‑U‑N‑S：<https://developer.apple.com/help/account/membership/D-U-N-S/>
- App Review Guidelines：<https://developer.apple.com/app-store/review/guidelines/>

## 三、Google Play

- 组织类型 Google Play Console 开发者账号、Google Payments Profile；
- D‑U‑N‑S Number、组织名称/地址/电话/网站、开发者联系邮箱和电话验证；
- 唯一 Android package name、Play App Signing、上传密钥/keystore 及其离线备份；
- 签名 AAB、版本号、目标 API、64 位兼容信息；
- Data safety 表、隐私政策、内容分级、目标受众、广告声明、App access 审核账号；
- App 内注销入口以及一个在 App 外也能发起注销的公开网页 URL；本项目已提供 `/account-deletion.html`；
- 正式发布轨道、国家/地区、价格（App 本体建议免费）和审核备注。

官方说明：

- 组织账号/D‑U‑N‑S：<https://support.google.com/googleplay/android-developer/answer/13628312?hl=zh-Hans>
- Data safety：<https://support.google.com/googleplay/android-developer/answer/10787469?hl=zh-Hans>
- 账户注销：<https://support.google.com/googleplay/android-developer/answer/13327111?hl=zh-Hans>

## 四、华为及其他国内安卓商店

- 对应开放平台的企业开发者账号和企业实名认证；
- APP 备案、ICP备案、营业执照、授权书、隐私政策和客服信息；
- 软件著作权/电子版权证书；如证书主体与开发者不同，还需授权链；
- APK/AAB、包名、版本、应用签名证书 SHA‑256 指纹和永久保管的 keystore；
- 第三方 SDK 清单、个人信息收集清单、权限用途、首次启动隐私同意和注销路径；
- 测试账号、截图、图标、内容分级和行业资质。

华为官方入口：

- 企业开发者注册与实名认证：<https://developer.huawei.com/consumer/cn/appgallery/devstart/>
- 移动 App 版权证书要求：<https://developer.huawei.com/consumer/cn/doc/App/agc-help-release-app-copyright-0000002278981450>

## 五、支付宝生产支付

- 企业实名认证支付宝账号、商家签约主体和结算对公账户；
- 支付宝开放平台网页/移动应用 AppID，应用名称、Logo、包名/Bundle ID、应用截图和上架信息；
- APP 支付或手机网站支付产品签约；KAI 作为撮合平台还需采用平台型子商户/持牌分账方案，不能普通商户代收后人工转账；
- 应用私钥、应用公钥或应用公钥证书、支付宝公钥/证书、证书序列号；
- HTTPS 异步通知 URL、退款通知 URL、商户 PID/账号、分账接收方和结算规则；
- KAI 支付适配服务所需 `KAI_ALIPAY_MERCHANT_ID`、`KAI_ALIPAY_ADAPTER_URL`、`KAI_ALIPAY_CALLBACK_SECRET` 和 `KAI_ALIPAY_MARKETPLACE_MODE=enabled`。

支付宝官方网页/移动应用流程：<https://open.alipay.com/module/webApp>

## 六、微信支付生产支付

- 微信开放平台企业认证账号和移动应用 AppID；
- 微信支付商户号，APP 支付权限，并把商户号与移动应用 AppID 绑定；
- 商户 API 私钥、商户 API 证书序列号、APIv3 密钥、微信支付公钥和公钥 ID/平台证书；
- HTTPS 支付/退款通知 URL；
- KAI 为撮合平台时应申请服务商/特约商户和分账能力，确定供应商为分账接收方、冻结期、退分账和对账规则；
- KAI 支付适配服务所需 `KAI_WECHAT_MERCHANT_ID`、`KAI_WECHAT_ADAPTER_URL`、`KAI_WECHAT_CALLBACK_SECRET` 和 `KAI_WECHAT_MARKETPLACE_MODE=enabled`。

微信支付官方说明：

- APP 支付接入准备：<https://pay.wechatpay.cn/doc/v3/merchant/4015478291>
- APP 支付权限申请：<https://pay.wechatpay.cn/doc/v3/merchant/4013070174>
- 分账：<https://pay.wechatpay.cn/doc/v3/partner/4012072582>

## 七、短信验证码

- 阿里云企业账号和短信服务开通；
- 审核通过的短信签名、注册验证码模板；
- 仅允许发送短信所需权限的 RAM 用户 AccessKey ID/Secret；
- 服务端随机 `KAI_OTP_HASH_SECRET`，至少 32 字节；
- 环境变量：`KAI_SMS_PROVIDER=aliyun`、`KAI_REQUIRE_SMS=true`、`KAI_SMS_SIGN_NAME`、`KAI_SMS_TEMPLATE_CODE`、`ALIBABA_CLOUD_ACCESS_KEY_ID`、`ALIBABA_CLOUD_ACCESS_KEY_SECRET`。

## 八、签名与密钥保管交接表

以下内容只记录“保管人、位置、到期日、轮换日期”，不要把实际密钥填进本文件：

| 凭证 | 保管人 | 安全位置 | 到期/轮换日 |
| --- | --- | --- | --- |
| TLS 证书与私钥 | 待填写 | 待填写 | 待填写 |
| Android upload keystore | 待填写 | 离线双备份 | 待填写 |
| Apple Distribution/API Key | 待填写 | 待填写 | 待填写 |
| 支付宝应用私钥/证书 | 待填写 | 支付适配服务 | 待填写 |
| 微信商户私钥/APIv3 密钥 | 待填写 | 支付适配服务 | 待填写 |
| 短信 RAM AccessKey | 待填写 | 服务器密钥管理 | 待填写 |
| 数据库备份加密密钥 | 待填写 | 独立密钥管理 | 待填写 |
