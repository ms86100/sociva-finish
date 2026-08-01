/**
 * LiveActivityPlugin.kt
 *
 * Reference Capacitor plugin bridge for Android.
 * Copy into your Android Studio project and register in MainActivity.
 *
 * Registration (MainActivity.java / .kt):
 *   registerPlugin(LiveActivityPlugin::class.java)
 */

package app.sociva.community

import android.content.Intent
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "LiveActivity")
class LiveActivityPlugin : Plugin() {

    @PluginMethod
    fun startLiveActivity(call: PluginCall) {
        sendServiceIntent(call, LiveDeliveryService.ACTION_START)
        val ret = com.getcapacitor.JSObject()
        ret.put("activityId", call.getString("entity_id") ?: "android")
        call.resolve(ret)
    }

    @PluginMethod
    fun updateLiveActivity(call: PluginCall) {
        sendServiceIntent(call, LiveDeliveryService.ACTION_UPDATE)
        call.resolve()
    }

    @PluginMethod
    fun endLiveActivity(call: PluginCall) {
        val intent = Intent(context, LiveDeliveryService::class.java).apply {
            action = LiveDeliveryService.ACTION_STOP
        }
        context.stopService(intent)
        call.resolve()
    }

    private fun sendServiceIntent(call: PluginCall, action: String) {
        val intent = Intent(context, LiveDeliveryService::class.java).apply {
            this.action = action
            putExtra("entity_type", call.getString("entity_type", "order"))
            putExtra("entity_id", call.getString("entity_id", ""))
            putExtra("workflow_status", call.getString("workflow_status", ""))
            putExtra("eta_minutes", call.getInt("eta_minutes", -1))
            putExtra("driver_distance", call.getDouble("driver_distance", -1.0))
            putExtra("driver_name", call.getString("driver_name", ""))
            putExtra("vehicle_type", call.getString("vehicle_type", ""))
            putExtra("progress_stage", call.getString("progress_stage", ""))
        }

        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
    }
}
