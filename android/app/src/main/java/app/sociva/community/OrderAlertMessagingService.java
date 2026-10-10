package app.sociva.community;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;
import android.os.PowerManager;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/**
 * Posts the seller order alert from the OS when Sociva is backgrounded, swiped away, or the screen is locked.
 * High-priority data messages start this service without the WebView.
 */
public class OrderAlertMessagingService extends MessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        OrderAlertChannels.ensure(this);
        Map<String, String> data = remoteMessage.getData();
        if (shouldPostOsAlert(data)) {
            postOrderAlert(data);
        }
        super.onMessageReceived(remoteMessage);
    }

    private boolean shouldPostOsAlert(Map<String, String> data) {
        if (!isSellerOrderAlert(data)) return false;
        if (!MainActivity.isInForeground()) return true;
        PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
        return power != null && !power.isInteractive();
    }

    static boolean isSellerOrderAlert(Map<String, String> data) {
        if (data == null || data.isEmpty()) return false;
        if (!"true".equals(data.get("high_priority"))) return false;
        String role = data.get("target_role");
        String status = data.get("status");
        String type = data.get("type");
        String reminder = data.get("reminder_type");
        if ("seller_order_status_reminder".equals(type)) return true;
        if ("unacked_order".equals(reminder) || "status_nudge".equals(reminder)) return true;
        if (!"seller".equals(role) || status == null) return false;
        return "placed".equals(status)
            || "preparing".equals(status)
            || "enquired".equals(status)
            || "requested".equals(status)
            || "quoted".equals(status)
            || "payment_verify_pending".equals(status)
            || "refund_requested".equals(status);
    }

    private void postOrderAlert(Map<String, String> data) {
        String title = data.get("title");
        if (title == null || title.isEmpty()) title = "New order";
        String body = data.get("body");
        if (body == null || body.isEmpty()) body = "Tap to review and accept";
        String orderId = data.get("orderId");
        if (orderId == null || orderId.isEmpty()) orderId = data.get("order_id");

        Intent open = new Intent(this, MainActivity.class);
        open.setAction(Intent.ACTION_VIEW);
        open.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (orderId != null && !orderId.isEmpty()) {
            open.setData(Uri.parse("sociva://orders/" + orderId));
            open.putExtra("orderId", orderId);
        }
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent content = PendingIntent.getActivity(this, 0, open, flags);

        Uri sound = Uri.parse("android.resource://" + getPackageName() + "/raw/gate_bell");
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, OrderAlertChannels.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_sociva)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setOnlyAlertOnce(false)
            .setSound(sound)
            .setContentIntent(content);

        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(notificationId(orderId, data.get("reminder_bucket")), builder.build());
        }
    }

    static int notificationId(String orderId, String bucket) {
        String key = (orderId == null ? "order" : orderId) + ":" + (bucket == null ? "0" : bucket);
        int id = key.hashCode() & 0x7fffffff;
        return id == 0 ? 1 : id;
    }
}
