package app.sociva.community;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;

/**
 * Creates the incoming-order channel at process start.
 * Channel sound is fixed after the first create, so this id is orders_incoming_v3.
 */
public final class OrderAlertChannels {
    public static final String CHANNEL_ID = "orders_incoming_v3";
    public static final String LEGACY_CHANNEL_ID = "orders_incoming_v2";

    private OrderAlertChannels() {}

    public static void ensure(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context == null) {
            return;
        }
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        ensureChannel(manager, context, CHANNEL_ID, "Incoming Orders");
        // Live FCM still targets v2 for unstamped tokens. Creating it natively
        // means a killed process can still resolve the channel before JS boots.
        // Existing installs keep their current v2 sound; Android will not reset it.
        ensureChannel(manager, context, LEGACY_CHANNEL_ID, "Incoming Orders (previous)");
    }

    private static void ensureChannel(
        NotificationManager manager,
        Context context,
        String id,
        String name
    ) {
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        NotificationChannel channel = new NotificationChannel(
            id,
            name,
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("High-priority ringing alerts for new seller orders");
        channel.setSound(
            Uri.parse("android.resource://" + context.getPackageName() + "/raw/gate_bell"),
            attrs
        );
        channel.enableVibration(true);
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(channel);
    }
}
