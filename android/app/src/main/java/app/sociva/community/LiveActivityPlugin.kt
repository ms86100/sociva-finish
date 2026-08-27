package app.sociva.community

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * Capacitor bridge for Android foreground-service "live delivery" notifications.
 */
@CapacitorPlugin(
    name = "LiveActivity",
    permissions = [
        Permission(
            strings = [Manifest.permission.ACCESS_BACKGROUND_LOCATION],
            alias = "backgroundLocation"
        )
    ]
)
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
        // Prefer ACTION_STOP via startService so onStartCommand clears the FGS cleanly.
        // stopService() alone often skips ACTION_STOP and can leave OEMs in a bad state.
        try {
            val intent = Intent(context, LiveDeliveryService::class.java).apply {
                action = LiveDeliveryService.ACTION_STOP
            }
            context.startService(intent)
        } catch (_: Exception) {
            try {
                val intent = Intent(context, LiveDeliveryService::class.java).apply {
                    action = LiveDeliveryService.ACTION_STOP
                }
                context.stopService(intent)
            } catch (_: Exception) {
                // ignore
            }
        }
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

    /**
     * Two-step Android background location:
     * 1) Foreground (fine) must already be granted
     * 2) Then request ACCESS_BACKGROUND_LOCATION, or open app location settings
     *    (Android 11+ often will not show a second in-app dialog).
     */
    @PluginMethod
    fun requestBackgroundLocation(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.resolve(statusResult("granted", "pre_q"))
            return
        }

        val fineGranted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
                || ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        if (!fineGranted) {
            call.resolve(statusResult("needs_foreground_first", "fine_missing"))
            return
        }

        val bgGranted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_BACKGROUND_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        if (bgGranted) {
            call.resolve(statusResult("granted", "already"))
            return
        }

        // Android 11+: system usually requires Settings → Location → Allow all the time
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            openAppLocationSettings()
            call.resolve(statusResult("opened_settings", "android_11_plus"))
            return
        }

        requestPermissionForAlias("backgroundLocation", call, "backgroundLocationPermsCallback")
    }

    @PermissionCallback
    private fun backgroundLocationPermsCallback(call: PluginCall) {
        val bgGranted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_BACKGROUND_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        if (bgGranted) {
            call.resolve(statusResult("granted", "dialog"))
        } else {
            openAppLocationSettings()
            call.resolve(statusResult("opened_settings", "denied_or_limited"))
        }
    }

    @PluginMethod
    fun openAppLocationSettings(call: PluginCall) {
        openAppLocationSettings()
        call.resolve(statusResult("opened_settings", "manual"))
    }

    private fun openAppLocationSettings() {
        try {
            val intent = Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", context.packageName, null)
            )
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        } catch (_: Exception) {
            try {
                val intent = Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
            } catch (_: Exception) {
                // ignore
            }
        }
    }

    private fun statusResult(status: String, detail: String): JSObject {
        val ret = JSObject()
        ret.put("status", status)
        ret.put("detail", detail)
        return ret
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
