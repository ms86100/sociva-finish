package app.sociva.community

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.HandlerThread
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.ArrayDeque

/**
 * Android foreground location service for an active Cleaner City ride.
 * iOS does not get a matching background-location mode (App Store 2.5.4).
 * The access token stays in memory and is cleared when the service stops.
 */
class CommuteTrackingService : Service() {

    companion object {
        const val CHANNEL_ID = "sociva_commute_tracking"
        const val NOTIFICATION_ID = 9002
        const val ACTION_START = "START_COMMUTE"
        const val ACTION_STOP = "STOP_COMMUTE"
    }

    private var worker: HandlerThread? = null
    private var locationManager: LocationManager? = null
    private var listener: LocationListener? = null
    private var rideId: String? = null
    private var accessToken: String? = null
    private var supabaseUrl: String? = null
    private var anonKey: String? = null
    private val pendingBodies = ArrayDeque<String>()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
        val thread = HandlerThread("commute-tracking")
        thread.start()
        worker = thread
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopTracking()
                return START_NOT_STICKY
            }
            ACTION_START -> startTracking(intent)
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        clearListener()
        accessToken = null
        worker?.quitSafely()
        worker = null
        super.onDestroy()
    }

    private fun startTracking(intent: Intent) {
        val nextRide = intent.getStringExtra("ride_id").orEmpty()
        val token = intent.getStringExtra("access_token").orEmpty()
        val url = intent.getStringExtra("supabase_url").orEmpty().trimEnd('/')
        val key = intent.getStringExtra("anon_key").orEmpty()
        if (nextRide.isBlank() || token.isBlank() || url.isBlank() || key.isBlank()) {
            stopTracking()
            return
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED
        ) {
            stopTracking()
            return
        }
        rideId = nextRide
        accessToken = token
        supabaseUrl = url
        anonKey = key
        synchronized(pendingBodies) { pendingBodies.clear() }
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        val manager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        locationManager = manager
        clearListener()
        val next = LocationListener { location -> postLocation(location) }
        listener = next
        val looper = worker?.looper ?: mainLooper
        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            .filter { manager.isProviderEnabled(it) }
        if (providers.isEmpty()) {
            stopTracking()
            return
        }
        providers.forEach { provider ->
            manager.requestLocationUpdates(provider, 10_000L, 0f, next, looper)
        }
    }

    private fun postLocation(location: Location) {
        val ride = rideId ?: return
        val token = accessToken ?: return
        val base = supabaseUrl ?: return
        val key = anonKey ?: return
        val body = JSONObject()
            .put("p_ride_id", ride)
            .put("p_latitude", location.latitude)
            .put("p_longitude", location.longitude)
            .put("p_accuracy_meters", location.accuracy.toDouble())
            .toString()
        synchronized(pendingBodies) {
            pendingBodies.addLast(body)
            while (pendingBodies.size > 20) pendingBodies.removeFirst()
        }
        flushPending(base, key, token)
    }

    private fun flushPending(base: String, key: String, token: String) {
        while (true) {
            val body = synchronized(pendingBodies) { pendingBodies.firstOrNull() } ?: return
            try {
                val connection = (URL("$base/rest/v1/rpc/cleaner_city_upsert_ride_location").openConnection() as HttpURLConnection)
                connection.requestMethod = "POST"
                connection.connectTimeout = 8000
                connection.readTimeout = 8000
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.setRequestProperty("apikey", key)
                connection.setRequestProperty("Authorization", "Bearer $token")
                connection.outputStream.use { it.write(body.toByteArray()) }
                val code = connection.responseCode
                val errorText = if (code >= 400) {
                    connection.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
                } else {
                    ""
                }
                connection.disconnect()
                if (code in 200..299) {
                    synchronized(pendingBodies) { if (pendingBodies.isNotEmpty()) pendingBodies.removeFirst() }
                    continue
                }
                if (code == 401 || errorText.contains("Live location only")) {
                    stopTracking()
                }
                return
            } catch (_: Exception) {
                return
            }
        }
    }

    private fun stopTracking() {
        clearListener()
        synchronized(pendingBodies) { pendingBodies.clear() }
        accessToken = null
        rideId = null
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun clearListener() {
        val current = listener ?: return
        locationManager?.removeUpdates(current)
        listener = null
    }

    private fun buildNotification(): Notification {
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        val pending = PendingIntent.getActivity(
            this,
            2,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Sharing commute location")
            .setContentText("Sociva is sharing this ride while it is active.")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(pending)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Commute location",
                NotificationManager.IMPORTANCE_LOW
            )
            channel.description = "Shown while an active Cleaner City ride is sharing location."
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }
}
