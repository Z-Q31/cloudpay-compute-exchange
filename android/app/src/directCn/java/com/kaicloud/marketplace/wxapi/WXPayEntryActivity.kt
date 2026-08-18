package com.kaicloud.marketplace.wxapi

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import com.kaicloud.marketplace.payments.KaiWechatResult
import com.tencent.mm.opensdk.constants.ConstantsAPI
import com.tencent.mm.opensdk.modelbase.BaseReq
import com.tencent.mm.opensdk.modelbase.BaseResp
import com.tencent.mm.opensdk.openapi.IWXAPIEventHandler
import com.tencent.mm.opensdk.openapi.WXAPIFactory

class WXPayEntryActivity : Activity(), IWXAPIEventHandler {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    WXAPIFactory.createWXAPI(this, wechatAppId()).handleIntent(intent, this)
  }

  override fun onNewIntent(nextIntent: Intent) {
    super.onNewIntent(nextIntent)
    intent = nextIntent
    WXAPIFactory.createWXAPI(this, wechatAppId()).handleIntent(nextIntent, this)
  }

  override fun onReq(request: BaseReq?) = Unit

  override fun onResp(response: BaseResp?) {
    if (response?.type == ConstantsAPI.COMMAND_PAY_BY_WX) {
      val result = com.facebook.react.bridge.Arguments.createMap()
      result.putInt("errCode", response.errCode)
      result.putString("errStr", response.errStr ?: "")
      KaiWechatResult.pending?.resolve(result)
      KaiWechatResult.pending = null
    }
    finish()
  }

  private fun wechatAppId() = getSharedPreferences("kai_payments", 0).getString("wechat_app_id", null)
}
