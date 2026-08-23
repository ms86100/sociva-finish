package app.sociva.community

import android.content.Intent
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Capacitor bridge for Android foreground-service "live delivery" notifications.
 */
@CapacitorPlugin(name = "LiveActivity")
class LiveActivityPlugin : Plugin() {

    @PluginMethod
    fun startLiveActivity(call: PluginCall) {
        sendServiceIntent(call, LiveDeliveryService.ACTION_START)
        val ret = JSObject()
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

    @PluginMethod
    fun getActiveActivities(call: PluginCall) {
        val entityId = LiveDeliveryService.getActiveEntityId(context)
        val activities = JSArray()
        if (!entityId.isNullOrBlank()) {
            val entry = JSObject()
            entry.put("activityId", entityId)
            entry.put("entityId", entityId)
            activities.put(entry)
        }
        val ret = JSObject()
        ret.put("activities", activities)
        call.resolve(ret)
    }

    @PluginMethod
    fun cleanupStaleActivities(call: PluginCall) {
        val validIds = call.getArray("validEntityIds")
        val activeId = LiveDeliveryService.getActiveEntityId(context)
        if (!activeId.isNullOrBlank()) {
            var keep = false
            if (validIds != null) {
                for (i in 0 until validIds.length()) {
                    if (activeId == validIds.getString(i)) {
                        keep = true
                        break
                    }
                }
            }
            if (!keep) {
                val intent = Intent(context, LiveDeliveryService::class.java).apply {
                    action = LiveDeliveryService.ACTION_STOP
                }
                context.stopService(intent)
            }
        }
        call.resolve()
    }

    @PluginMethod
    fun getNativeBuildFlags(call: PluginCall) {
        val ret = JSObject()
        ret.put("hasTransistorsoftLicense", BuildConfig.HAS_TRANSISTORSOFT_LICENSE)
        ret.put("platform", "android")
        call.resolve(ret)
    }

    private fun sendServiceIntent(call: PluginCall, action: String) {
        val intent = Intent(context, LiveDeliveryService::class.java).apply {
            this.action = action
            putExtra("entity_type", call.getString("entity_type", "order"))
            putExtra("entity_id", call.getString("entity_id", ""))
            putExtra("workflow_status", call.getString("workflow_status", ""))
            putExtra("eta_minutes", call.getInt("eta_minutes", -1) ?: -1)
            putExtra("driver_distance", call.getDouble("driver_distance", -1.0) ?: -1.0)
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
