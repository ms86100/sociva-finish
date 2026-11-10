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
        const val ACTION_UPDATE = "UPDATE_COMMUTE"
        const val ACTION_STOP = "STOP_COMMUTE"
        private const val PREFS = "sociva_commute_tracking"
        private const val KEY_RIDE = "ride_id"
        private const val KEY_TOKEN = "access_token"
        private const val KEY_REFRESH = "refresh_token"
        private const val KEY_URL = "supabase_url"
        private const val KEY_ANON = "anon_key"
    }

    private var worker: HandlerThread? = null
    private var locationManager: LocationManager? = null
    private var listener: LocationListener? = null
    private var rideId: String? = null
    private var accessToken: String? = null
    private var refreshToken: String? = null
    private var supabaseUrl: String? = null
    private var anonKey: String? = null
    private var refreshInFlight = false
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
                clearPersisted()
                stopTracking()
                return START_NOT_STICKY
            }
            ACTION_UPDATE -> {
                // Refresh auth token / ride id without tearing down the GPS listener.
                applyExtras(intent)
                persistSession()
                if (listener == null && !rideId.isNullOrBlank() && !accessToken.isNullOrBlank()) {
                    startTracking(intent)
                }
            }
            ACTION_START -> startTracking(intent)
            else -> {
                // OEM sticky restart with a null/empty intent - restore last active ride.
                if (listener == null) {
                    restorePersisted()?.let { startTracking(it) }
                }
            }
        }
        // Sticky so OEMs can restart after brief kills while a ride is active.
        return START_STICKY
    }

    private fun applyExtras(intent: Intent?) {
        if (intent == null) return
        val token = intent.getStringExtra("access_token").orEmpty()
        val refresh = intent.getStringExtra("refresh_token").orEmpty()
        val nextRide = intent.getStringExtra("ride_id").orEmpty()
        val url = intent.getStringExtra("supabase_url").orEmpty().trimEnd('/')
        val key = intent.getStringExtra("anon_key").orEmpty()
        if (token.isNotBlank()) accessToken = token
        if (refresh.isNotBlank()) refreshToken = refresh
        if (nextRide.isNotBlank()) rideId = nextRide
        if (url.isNotBlank()) supabaseUrl = url
        if (key.isNotBlank()) anonKey = key
    }

    private fun persistSession() {
        val ride = rideId ?: return
        val token = accessToken ?: return
        val url = supabaseUrl ?: return
        val key = anonKey ?: return
        val editor = getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_RIDE, ride)
            .putString(KEY_TOKEN, token)
            .putString(KEY_URL, url)
            .putString(KEY_ANON, key)
        val refresh = refreshToken
        if (!refresh.isNullOrBlank()) {
            editor.putString(KEY_REFRESH, refresh)
        }
        editor.apply()
    }

    private fun clearPersisted() {
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }

    private fun restorePersisted(): Intent? {
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val ride = prefs.getString(KEY_RIDE, null).orEmpty()
        val token = prefs.getString(KEY_TOKEN, null).orEmpty()
        val refresh = prefs.getString(KEY_REFRESH, null).orEmpty()
        val url = prefs.getString(KEY_URL, null).orEmpty()
        val key = prefs.getString(KEY_ANON, null).orEmpty()
        if (ride.isBlank() || token.isBlank() || url.isBlank() || key.isBlank()) return null
        return Intent(this, CommuteTrackingService::class.java).apply {
            action = ACTION_START
            putExtra("ride_id", ride)
            putExtra("access_token", token)
            putExtra("refresh_token", refresh)
            putExtra("supabase_url", url)
            putExtra("anon_key", key)
        }
    }

    override fun onDestroy() {
        clearListener()
        accessToken = null
        refreshToken = null
        worker?.quitSafely()
        worker = null
        super.onDestroy()
    }

    private fun startTracking(intent: Intent) {
        val nextRide = intent.getStringExtra("ride_id").orEmpty()
        val token = intent.getStringExtra("access_token").orEmpty()
        val refresh = intent.getStringExtra("refresh_token").orEmpty()
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
        if (refresh.isNotBlank()) refreshToken = refresh
        supabaseUrl = url
        anonKey = key
        persistSession()
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
                if (code == 401) {
                    if (tryRefreshAccessToken(base, key)) {
                        continue
                    }
                    stopTracking()
                    return
                }
                if (errorText.contains("Live location only")) {
                    stopTracking()
                }
                return
            } catch (_: Exception) {
                return
            }
        }
    }

    /** Refresh JWT when FGS outlives the access token; keep GPS alive across expiry. */
    private fun tryRefreshAccessToken(base: String, key: String): Boolean {
        val refresh = refreshToken
        if (refresh.isNullOrBlank() || refreshInFlight) return false
        refreshInFlight = true
        try {
            val body = JSONObject()
                .put("refresh_token", refresh)
                .toString()
            val connection = (URL("$base/auth/v1/token?grant_type=refresh_token").openConnection() as HttpURLConnection)
            connection.requestMethod = "POST"
            connection.connectTimeout = 8000
            connection.readTimeout = 8000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("apikey", key)
            connection.setRequestProperty("Authorization", "Bearer $key")
            connection.outputStream.use { it.write(body.toByteArray()) }
            val code = connection.responseCode
            val responseText = if (code in 200..299) {
                connection.inputStream.bufferedReader().use { it.readText() }
            } else {
                connection.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
            }
            connection.disconnect()
            if (code !in 200..299) return false
            val json = JSONObject(responseText)
            val nextAccess = json.optString("access_token", "")
            val nextRefresh = json.optString("refresh_token", "")
            if (nextAccess.isBlank()) return false
            accessToken = nextAccess
            if (nextRefresh.isNotBlank()) refreshToken = nextRefresh
            persistSession()
            return true
        } catch (_: Exception) {
            return false
        } finally {
            refreshInFlight = false
        }
    }

    private fun stopTracking() {
        clearListener()
        synchronized(pendingBodies) { pendingBodies.clear() }
        accessToken = null
        refreshToken = null
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
