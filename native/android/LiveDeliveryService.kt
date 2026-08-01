/**
 * LiveDeliveryService.kt
 *
 * Reference implementation — copy into your Android Studio project.
 *
 * Foreground service that shows an ongoing notification on the lock screen
 * for active Sociva deliveries / bookings.
 *
 * Notification updates reuse the same ID and setOnlyAlertOnce(true) so
 * the user sees a silent, persistent card that refreshes in place.
 *
 * Safety:
 * - SharedPreferences dedup prevents duplicate services for the same entity
 * - START_NOT_STICKY prevents auto-restart after process death
 */

package app.sociva.community

import android.app.*
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

class LiveDeliveryService : Service() {

    companion object {
        const val CHANNEL_ID = "sociva_live_delivery"
        const val NOTIFICATION_ID = 9001
        const val ACTION_START = "START"
        const val ACTION_UPDATE = "UPDATE"
        const val ACTION_STOP = "STOP"
        private const val PREFS_NAME = "sociva_live_delivery_prefs"
        private const val KEY_ACTIVE_ENTITY = "active_entity_id"
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
            ACTION_START, ACTION_UPDATE -> {
                handleStartOrUpdate(intent)
            }
            ACTION_STOP -> {
                prefs.edit().remove(KEY_ACTIVE_ENTITY).apply()
                stopForeground(STOP_FOREGROUND_REMOVE)
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

        // Dedup: if already tracking a different entity, skip
        val currentEntity = prefs.getString(KEY_ACTIVE_ENTITY, null)
        if (intent.action == ACTION_START && currentEntity != null && currentEntity != entityId) {
            // Already tracking a different entity — don't create duplicate
            return
        }

        // Track active entity
        prefs.edit().putString(KEY_ACTIVE_ENTITY, entityId).apply()

        val title = statusTitle(status)
        val body = buildBody(eta, distance, driverName, stage)

        val notification = buildNotification(title, body)
        startForeground(NOTIFICATION_ID, notification)
    }

    private fun buildNotification(title: String, body: String): Notification {
        // Tap opens the app
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(android.R.drawable.ic_dialog_info) // replace with R.drawable.ic_delivery
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
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun statusTitle(status: String): String = when (status) {
        "accepted"  -> "Order Accepted"
        "preparing" -> "Preparing Your Order"
        "ready"     -> "Ready for Pickup"
        "picked_up" -> "Order Picked Up"
        "en_route"  -> "Order On the Way"
        "confirmed" -> "Booking Confirmed"
        else        -> "Order Update"
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
