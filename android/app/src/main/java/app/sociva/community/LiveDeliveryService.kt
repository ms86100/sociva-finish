package app.sociva.community

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Foreground service that shows an ongoing notification for active deliveries.
 */
class LiveDeliveryService : Service() {

    companion object {
        const val CHANNEL_ID = "sociva_live_delivery"
        const val NOTIFICATION_ID = 9001
        const val ACTION_START = "START"
        const val ACTION_UPDATE = "UPDATE"
        const val ACTION_STOP = "STOP"
        private const val PREFS_NAME = "sociva_live_delivery_prefs"
        private const val KEY_ACTIVE_ENTITY = "active_entity_id"

        fun getActiveEntityId(context: Context): String? {
            return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getString(KEY_ACTIVE_ENTITY, null)
        }
    }

    private val prefs by lazy {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START, ACTION_UPDATE -> handleStartOrUpdate(intent)
            ACTION_STOP -> {
                prefs.edit().remove(KEY_ACTIVE_ENTITY).apply()
                ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    @Synchronized
    private fun handleStartOrUpdate(intent: Intent) {
        val entityId = intent.getStringExtra("entity_id") ?: ""
        val status = intent.getStringExtra("workflow_status") ?: "Update"
        val eta = intent.getIntExtra("eta_minutes", -1)
        val distance = intent.getDoubleExtra("driver_distance", -1.0)
        val driverName = intent.getStringExtra("driver_name") ?: ""
        val stage = intent.getStringExtra("progress_stage") ?: ""

        val currentEntity = prefs.getString(KEY_ACTIVE_ENTITY, null)
        if (intent.action == ACTION_START && currentEntity != null && currentEntity != entityId) {
            return
        }

        prefs.edit().putString(KEY_ACTIVE_ENTITY, entityId).apply()

        val notification = buildNotification(statusTitle(status), buildBody(eta, distance, driverName, stage))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(title: String, body: String): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body.ifBlank { "Tracking your order" })
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Live Delivery Tracking",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows real-time delivery progress"
                setShowBadge(false)
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun statusTitle(status: String): String = when (status) {
        "accepted" -> "Order Accepted"
        "preparing" -> "Preparing Your Order"
        "ready" -> "Ready for Pickup"
        "picked_up" -> "Order Picked Up"
        "en_route" -> "Order On the Way"
        "confirmed" -> "Booking Confirmed"
        else -> "Order Update"
    }

    private fun buildBody(eta: Int, distance: Double, name: String, stage: String): String {
        val parts = mutableListOf<String>()
        if (eta > 0) parts.add("ETA $eta min")
        if (distance > 0) parts.add("%.1f km away".format(distance))
        if (name.isNotBlank()) parts.add(name)
        if (stage.isNotBlank()) parts.add(stage)
        return parts.joinToString(" · ")
    }
}
