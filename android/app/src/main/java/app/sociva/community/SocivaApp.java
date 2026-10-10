package app.sociva.community;

import android.app.Application;

/** Creates the order-alert channel as soon as any process starts, including an FCM wake. */
public class SocivaApp extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        OrderAlertChannels.ensure(this);
    }
}
