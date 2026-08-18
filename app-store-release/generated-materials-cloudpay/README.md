# CloudPay 华为应用市场申报材料包

版本：V1.0  
编制日期：2026-08-14  
申报主体：上海申比芯人工智能科技有限公司  
应用名称：CloudPay  
Android 包名：`com.kaicloud.marketplace`

## 1. 使用说明

本目录汇总《材料准备(1).rtf》中目前能够通过现有资料生成的文案、制度、审核说明和填报底稿。文件分为三类：

- **可直接使用**：核对联系人、网址等少量字段后，可复制到华为 AppGallery Connect 或作为附件提交。
- **签署后使用**：协议、规则和声明须经公司法务/负责人审核，加盖公章或在线发布后才生效。
- **填充外部编号后使用**：备案号、软著登记号、域名证书、签名证书信息等必须从相应机关或服务商取得，不得自行编造。

本材料包不是许可证、备案回执、支付牌照、软件著作权证书或法律意见书。

## 2. 已生成材料

| 编号 | 文件 | 用途 | 当前状态 |
|---|---|---|---|
| 01 | `01_APP_SUBMISSION_PROFILE.md` | 企业与 App 固定信息底表 | 核对后使用 |
| 02 | `02_STORE_LISTING_COPY.md` | 华为应用市场商店文案 | 可直接复制 |
| 03 | `03_HUAWEI_REVIEW_NOTE.md` | 审核备注、功能路径和业务说明 | 补审核账号后提交 |
| 04 | `04_APP_FILING_INFORMATION_FORM.md` | APP 备案填报底稿 | 补域名/签名/负责人资料 |
| 05 | `05_EDI_BUSINESS_MODEL_AND_INQUIRY.md` | EDI 业务说明和主管部门咨询稿 | 核对后发送咨询 |
| 06 | `06_PLATFORM_FUND_FLOW_AND_PAYMENT_BOUNDARY.md` | 资金路径及支付边界说明 | 必须与真实资金流一致 |
| 07 | `07_USER_AGREEMENT_DRAFT.md` | 用户服务协议 | 法务审核、发布后使用 |
| 08 | `08_PRIVACY_POLICY_DRAFT.md` | 隐私政策 | 补联系方式和实际清单 |
| 09 | `09_ACCOUNT_DELETION_POLICY.md` | 账号注销说明 | 接口上线后使用 |
| 10 | `10_SUPPLIER_ONBOARDING_AGREEMENT_DRAFT.md` | 企业供应商入驻协议 | 法务审核、签署后使用 |
| 11 | `11_ENTERPRISE_BUYER_SERVICE_AGREEMENT_DRAFT.md` | 企业采购方服务协议 | 法务审核、签署后使用 |
| 12 | `12_PLATFORM_SERVICE_FEE_RULES_DRAFT.md` | 平台服务费规则 | 填真实费率后发布 |
| 13 | `13_TRANSACTION_REFUND_DISPUTE_RULES_DRAFT.md` | 交易、退款、争议规则 | 法务审核后发布 |
| 14 | `14_CAPACITY_LEDGER_DEPOSIT_WITHDRAWAL_RULES_DRAFT.md` | 容量存入、锁定、取出规则 | 系统实现后发布 |
| 15 | `15_RESOURCE_VERIFICATION_RULES_DRAFT.md` | GPU/Token/柜月验真与卡时审计 | 技术参数确认后发布 |
| 16 | `16_PRODUCT_NEWS_CONTENT_REVIEW_RULES_DRAFT.md` | 商品与算力资讯审核制度 | 管理后台执行 |
| 17 | `17_CUSTOMER_SERVICE_COMPLAINT_RULES_DRAFT.md` | 客服、投诉和争议响应制度 | 补电话邮箱后发布 |
| 18 | `18_DATA_SDK_PERMISSION_INVENTORY.md` | 数据、权限和 SDK 清单 | 每次发版更新 |
| 19 | `19_REVIEW_ACCOUNT_AND_TEST_GUIDE.md` | 华为审核账号和测试步骤 | 创建账号后提交 |
| 20 | `20_AGC_APPLICATION_RECORD_FORM.md` | AppGallery Connect 填报记录表 | 上传前填写 |
| 21 | `21_RELEASE_SIGNING_BUILD_CHECKLIST.md` | 签名、构建与发布检查 | 发版逐项执行 |
| 22 | `22_HUAWEI_PAYMENT_IAP_CLARIFICATION_REQUEST.md` | 华为支付/IAP 适用范围咨询稿 | 有疑问时提交工单 |
| 23 | `23_EXTERNAL_MATERIALS_HANDOFF_CHECKLIST.md` | 仍需外部取得的材料清单 | 按责任人推进 |

## 3. 现有附件索引

- App 图标：`../../gitee-pod/assets/images/icon.png`
- 1024×500 宣传图：`../assets/feature-graphic-1024x500.png`
- 安卓手机截图：`../assets/android-01-market-1080x1920.png` 至 `../assets/android-06-assessment-1080x1920.png`
- iOS 手机截图：`../assets/ios-01-market-1290x2796.png` 至 `../assets/ios-06-assessment-1290x2796.png`
- 平板截图：`../assets/tablet-01-operations-2732x2048.png`、`../assets/tablet-02-kline-2732x2048.png`
- 全部素材索引：`../assets/ASSET_INDEX.md`
- 软件著作权申请信息底稿：`../../gitee-pod/copyright-materials/CLOUDPAY_SOFTWARE_COPYRIGHT_APPLICATION_INFORMATION.md`
- 软件说明书：`../../gitee-pod/copyright-materials/CLOUDPAY_SOFTWARE_MANUAL.md`
- 软件说明书 PDF：`../../gitee-pod/output/pdf/CloudPay_V1.0_软件说明书.pdf`
- 源程序鉴别材料 PDF：`../../gitee-pod/output/pdf/CloudPay_V1.0_源程序鉴别材料.pdf`
- 签名与发布说明：`../../gitee-pod/docs/HUAWEI_RELEASE_IDENTITY_AND_SIGNING.md`

## 4. 使用前必须确认的红线

1. 若实际资金由 CloudPay 或平台运营主体集中收取后再结算给供应商，不得使用“买方向供应商对公直付”的说明。
2. 不得将测试环境、Mock 支付、测试验证码或本地地址描述为已正式上线能力。
3. 不得伪造 APP 备案号、ICP备案号、EDI 许可证、支付业务许可证、软著登记证书、域名证书或应用签名信息。
4. 隐私政策、SDK 清单和权限用途必须与最终安装包实际行为一致。
5. 提交审核前须使用正式签名包完成真实设备测试、账号注销测试和支付/订单异常流程测试。

## 5. 重要外部依据

- 华为 AppGallery 应用分发：<https://developer.huawei.com/consumer/cn/appgallery/devstart/>
- 华为应用审核指南：<https://developer.huawei.com/consumer/cn/doc/App/50000>
- 工信部电信业务分类目录：<https://www.miit.gov.cn/zwgk/zcwj/wjfb/tg/art/2020/art_e98406cd89844f7e92ea1bcf3b5301e0.html>
- 《非银行支付机构监督管理条例》：<https://www.beijing.gov.cn/zhengce/zhengcefagui/qtwj/202402/t20240207_3559189.html>
- 《中华人民共和国个人信息保护法》：<https://www.npc.gov.cn/npc/c2/c30834/202108/t20210820_313088.html>
