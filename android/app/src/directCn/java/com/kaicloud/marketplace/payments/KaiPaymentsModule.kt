package com.kaicloud.marketplace.payments

import com.alipay.sdk.app.PayTask
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.tencent.mm.opensdk.modelpay.PayReq
import com.tencent.mm.opensdk.openapi.WXAPIFactory
import org.json.JSONObject
import java.util.concurrent.Executors

class KaiPaymentsModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  private val executor = Executors.newSingleThreadExecutor()

  override fun getName() = "KaiPayments"

  @ReactMethod
  fun payAlipay(orderInfo: String, promise: Promise) {
    if (orderInfo.isBlank() || orderInfo.length > 32_768) {
      promise.reject("PAYMENT_PAYLOAD_INVALID", "支付宝订单信息无效。")
      return
    }
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("PAYMENT_ACTIVITY_UNAVAILABLE", "当前页面无法唤起支付宝。")
      return
    }
    executor.execute {
      try {
        val result = PayTask(activity).payV2(orderInfo, true)
        val output = Arguments.createMap()
        output.putString("resultStatus", result["resultStatus"] ?: "")
        output.putString("memo", result["memo"] ?: "")
        output.putString("result", result["result"] ?: "")
        promise.resolve(output)
      } catch (error: Exception) {
        promise.reject("ALIPAY_LAUNCH_FAILED", "支付宝没有成功打开。", error)
      }
    }
  }

  @ReactMethod
  fun payWechat(checkoutPayload: String, promise: Promise) {
    try {
      val payload = JSONObject(checkoutPayload)
      val appId = payload.getString("appId")
      val api = WXAPIFactory.createWXAPI(reactContext, appId, true)
      if (!api.isWXAppInstalled) {
        promise.reject("WECHAT_NOT_INSTALLED", "请先安装微信。")
        return
      }
      reactContext.getSharedPreferences("kai_payments", 0).edit().putString("wechat_app_id", appId).apply()
      api.registerApp(appId)
      val request = PayReq().apply {
        this.appId = appId
        partnerId = payload.getString("partnerId")
        prepayId = payload.getString("prepayId")
        packageValue = payload.optString("package", "Sign=WXPay")
        nonceStr = payload.getString("nonceStr")
        timeStamp = payload.getString("timestamp")
        sign = payload.getString("sign")
      }
      KaiWechatResult.pending = promise
      if (!api.sendReq(request)) {
        KaiWechatResult.pending = null
        promise.reject("WECHAT_LAUNCH_FAILED", "微信支付没有成功打开。")
      }
    } catch (error: Exception) {
      KaiWechatResult.pending = null
      promise.reject("PAYMENT_PAYLOAD_INVALID", "微信支付参数无效。", error)
    }
  }

  override fun invalidate() {
    executor.shutdownNow()
    super.invalidate()
  }
}

object KaiWechatResult {
  @Volatile var pending: Promise? = null
}
