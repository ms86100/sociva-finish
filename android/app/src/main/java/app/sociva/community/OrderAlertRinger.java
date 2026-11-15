package app.sociva.community;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.Nullable;
import java.util.HashSet;
import java.util.Set;

/**
 * Order-alert audio that does not register as media playback.
 * Uses Ringtone + USAGE_NOTIFICATION_RINGTONE (no MediaSession / MediaStyle).
 * Tracks concurrent order ids so acknowledging one order does not silence another.
 */
public final class OrderAlertRinger {
    private static final Object LOCK = new Object();
    private static final Set<String> ACTIVE_ORDERS = new HashSet<>();
    private static final long LOOP_GAP_MS = 1500L;

    @Nullable
    private static Ringtone ringtone;
    @Nullable
    private static Handler loopHandler;
    @Nullable
    private static Runnable loopRunnable;
    private static boolean looping;

    private OrderAlertRinger() {}

    public static void start(Context context, String orderId) {
        if (context == null) return;
        final String id = orderId == null ? "" : orderId.trim();
        if (id.isEmpty()) return;

        synchronized (LOCK) {
            ACTIVE_ORDERS.add(id);
            ensurePlaying(context.getApplicationContext());
        }
    }

    public static void stop(String orderId) {
        final String id = orderId == null ? "" : orderId.trim();
        if (id.isEmpty()) return;
        synchronized (LOCK) {
            ACTIVE_ORDERS.remove(id);
            if (ACTIVE_ORDERS.isEmpty()) {
                stopPlaybackLocked();
            }
        }
    }

    public static void stopAll() {
        synchronized (LOCK) {
            ACTIVE_ORDERS.clear();
            stopPlaybackLocked();
        }
    }

    public static int activeCount() {
        synchronized (LOCK) {
            return ACTIVE_ORDERS.size();
        }
    }

    private static void ensurePlaying(Context context) {
        if (looping && ringtone != null && ringtone.isPlaying()) {
            return;
        }
        stopPlaybackLocked();

        Uri sound = Uri.parse(
            "android.resource://" + context.getPackageName() + "/" + R.raw.gate_bell
        );
        Ringtone next = RingtoneManager.getRingtone(context, sound);
        if (next == null) {
            return;
        }

        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            next.setAudioAttributes(attrs);
            next.setLooping(true);
        } else {
            next.setAudioAttributes(attrs);
        }

        ringtone = next;
        looping = true;
        try {
            next.play();
        } catch (Exception ignored) {
            looping = false;
            ringtone = null;
            return;
        }

        // Pre-P Ringtone has no setLooping; re-trigger after each play.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            if (loopHandler == null) {
                loopHandler = new Handler(Looper.getMainLooper());
            }
            loopRunnable = new Runnable() {
                @Override
                public void run() {
                    synchronized (LOCK) {
                        if (!looping || ACTIVE_ORDERS.isEmpty() || ringtone == null) {
                            return;
                        }
                        try {
                            if (!ringtone.isPlaying()) {
                                ringtone.play();
                            }
                        } catch (Exception ignored) {
                            /* keep trying while orders remain active */
                        }
                        if (loopHandler != null && loopRunnable != null) {
                            loopHandler.postDelayed(loopRunnable, LOOP_GAP_MS);
                        }
                    }
                }
            };
            loopHandler.postDelayed(loopRunnable, LOOP_GAP_MS);
        }
    }

    private static void stopPlaybackLocked() {
        looping = false;
        if (loopHandler != null && loopRunnable != null) {
            loopHandler.removeCallbacks(loopRunnable);
        }
        loopRunnable = null;
        if (ringtone != null) {
            try {
                if (ringtone.isPlaying()) {
                    ringtone.stop();
                }
            } catch (Exception ignored) {
                /* already stopped */
            }
            ringtone = null;
        }
    }
}
