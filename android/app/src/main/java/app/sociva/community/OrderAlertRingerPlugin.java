package app.sociva.community;

import android.app.NotificationManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor bridge for order-alert ringing without WebView MediaSession.
 */
@CapacitorPlugin(name = "OrderAlertRinger")
public class OrderAlertRingerPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        String orderId = call.getString("orderId", "");
        if (orderId == null || orderId.trim().isEmpty()) {
            call.reject("orderId required");
            return;
        }
        OrderAlertRinger.start(getContext(), orderId.trim());
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("active", OrderAlertRinger.activeCount());
        call.resolve(ret);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        String orderId = call.getString("orderId", "");
        if (orderId == null || orderId.trim().isEmpty()) {
            call.reject("orderId required");
            return;
        }
        String id = orderId.trim();
        OrderAlertRinger.stop(id);
        cancelNotification(id);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("active", OrderAlertRinger.activeCount());
        call.resolve(ret);
    }

    @PluginMethod
    public void stopAll(PluginCall call) {
        OrderAlertRinger.stopAll();
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("active", 0);
        call.resolve(ret);
    }

    @PluginMethod
    public void activeCount(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("count", OrderAlertRinger.activeCount());
        call.resolve(ret);
    }

    private void cancelNotification(String orderId) {
        NotificationManager manager =
            (NotificationManager) getContext().getSystemService(NotificationManager.class);
        if (manager == null) return;
        manager.cancel(OrderAlertMessagingService.notificationId(orderId, null));
        // LocalNotifications use a different hash; cancel common bucket too.
        manager.cancel(OrderAlertMessagingService.notificationId(orderId, "0"));
    }
}
