package app.sociva.community

import android.Manifest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * Sociva VoIP Cap plugin for Android.
 * Incoming ring uses high-priority FCM data (voip_incoming) + in-app UI.
 * Telecom/CallStyle full native dialer can land in a follow-up without breaking seller alerts.
 */
@CapacitorPlugin(
    name = "SocivaVoip",
    permissions = [
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "mic"),
    ],
)
class SocivaVoipPlugin : Plugin() {

    private var cachedToken: String? = null

    @PluginMethod
    fun registerVoipToken(call: PluginCall) {
        val token = call.getString("token")
        if (!token.isNullOrBlank()) {
            cachedToken = token
            val event = JSObject()
            event.put("token", token)
            event.put("platform", "android_fcm")
            notifyListeners("voipToken", event)
            val ret = JSObject()
            ret.put("ok", true)
            ret.put("token", token)
            ret.put("platform", "android_fcm")
            call.resolve(ret)
            return
        }
        if (!cachedToken.isNullOrBlank()) {
            val ret = JSObject()
            ret.put("ok", true)
            ret.put("token", cachedToken)
            ret.put("platform", "android_fcm")
            call.resolve(ret)
            return
        }
        val ret = JSObject()
        ret.put("ok", false)
        ret.put("reason", "pass_fcm_token")
        call.resolve(ret)
    }

    @PluginMethod
    fun requestCallPermissions(call: PluginCall) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED
        ) {
            val ret = JSObject()
            ret.put("mic", true)
            ret.put("phoneAccount", false)
            call.resolve(ret)
            return
        }
        requestPermissionForAlias("mic", call, "micPermCallback")
    }

    @PermissionCallback
    private fun micPermCallback(call: PluginCall) {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        val ret = JSObject()
        ret.put("mic", granted)
        ret.put("phoneAccount", false)
        call.resolve(ret)
    }

    @PluginMethod
    fun reportIncomingCall(call: PluginCall) {
        val callId = call.getString("callId") ?: ""
        val callerName = call.getString("callerName") ?: "Sociva"
        val event = JSObject()
        event.put("callId", callId)
        event.put("callerName", callerName)
        event.put("payload", call.getObject("payload") ?: JSObject())
        notifyListeners("incoming", event)
        // Full Telecom ConnectionService is deferred; JS shows in-app answer UI.
        val ret = JSObject()
        ret.put("ok", true)
        ret.put("mode", "in_app")
        call.resolve(ret)
    }

    @PluginMethod
    fun endNativeCall(call: PluginCall) {
        val callId = call.getString("callId") ?: ""
        val event = JSObject()
        event.put("callId", callId)
        notifyListeners("ended", event)
        call.resolve()
    }

    @PluginMethod
    fun setMuted(call: PluginCall) {
        call.resolve()
    }

    @PluginMethod
    fun setSpeaker(call: PluginCall) {
        call.resolve()
    }
}
