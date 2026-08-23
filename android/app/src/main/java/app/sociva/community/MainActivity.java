package app.sociva.community;

import android.animation.AnimatorSet;
import android.animation.ObjectAnimator;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.OvershootInterpolator;
import android.widget.FrameLayout;
import android.widget.TextView;
import com.getcapacitor.BridgeActivity;

/**
 * Intercepts Transistorsoft's harsh "LICENSE VALIDATION FAILURE" toast (black
 * bottom rectangle) and swaps it for a Sociva-branded status pill with soft
 * motion — so launch feels intentional, never like an error.
 */
public class MainActivity extends BridgeActivity {
    private final Handler toastGuard = new Handler(Looper.getMainLooper());
    private View brandedPill;
    private boolean pillShowing = false;
    private long lastPillShownAt = 0L;

    private final Runnable dismissLicenseToasts = new Runnable() {
        @Override
        public void run() {
            if (tryDismissLicenseToast()) {
                showBrandedStatusPill();
            }
            toastGuard.postDelayed(this, 280);
        }
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LiveActivityPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onResume() {
        super.onResume();
        toastGuard.removeCallbacks(dismissLicenseToasts);
        toastGuard.post(dismissLicenseToasts);
        toastGuard.postDelayed(() -> toastGuard.removeCallbacks(dismissLicenseToasts), 10_000);
    }

    @Override
    public void onPause() {
        toastGuard.removeCallbacks(dismissLicenseToasts);
        hideBrandedStatusPill(false);
        super.onPause();
    }

    private boolean tryDismissLicenseToast() {
        boolean found = false;
        try {
            Class<?> wmgClass = Class.forName("android.view.WindowManagerGlobal");
            Object global = wmgClass.getMethod("getInstance").invoke(null);
            java.lang.reflect.Field viewsField = wmgClass.getDeclaredField("mViews");
            viewsField.setAccessible(true);
            Object viewsObj = viewsField.get(global);
            if (!(viewsObj instanceof java.util.ArrayList)) return false;
            @SuppressWarnings("unchecked")
            java.util.ArrayList<View> views = (java.util.ArrayList<View>) viewsObj;
            Object wmg = getSystemService(WINDOW_SERVICE);
            for (int i = views.size() - 1; i >= 0; i--) {
                View root = views.get(i);
                if (root == null) continue;
                String text = collectText(root).toLowerCase();
                if (!(text.contains("license validation") || text.contains("license validation failure"))) {
                    continue;
                }
                found = true;
                root.setVisibility(View.GONE);
                root.setAlpha(0f);
                try {
                    if (wmg instanceof android.view.WindowManager) {
                        ((android.view.WindowManager) wmg).removeViewImmediate(root);
                    }
                } catch (Throwable ignored) { /* already gone */ }
            }
        } catch (Throwable ignored) {
            // OEM / API variance
        }
        return found;
    }

    private void showBrandedStatusPill() {
        if (isFinishing()) return;
        long now = System.currentTimeMillis();
        if (pillShowing || now - lastPillShownAt < 4_000) return;
        lastPillShownAt = now;

        try {
            ViewGroup host = findViewById(android.R.id.content);
            if (host == null) return;

            if (brandedPill == null) {
                brandedPill = LayoutInflater.from(this).inflate(R.layout.sociva_status_pill, host, false);
            }

            TextView title = brandedPill.findViewById(R.id.sociva_status_pill_title);
            TextView subtitle = brandedPill.findViewById(R.id.sociva_status_pill_subtitle);
            View pulse = brandedPill.findViewById(R.id.sociva_status_pill_pulse);
            View card = brandedPill.findViewById(R.id.sociva_status_pill_card);
            if (title != null) title.setText("Sociva is ready");
            if (subtitle != null) subtitle.setText("Setting up a smooth experience for you");

            if (brandedPill.getParent() == null) {
                FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    Gravity.BOTTOM
                );
                int margin = (int) (20 * getResources().getDisplayMetrics().density);
                lp.setMargins(0, 0, 0, margin);
                host.addView(brandedPill, lp);
            }
            pillShowing = true;

            float density = getResources().getDisplayMetrics().density;
            if (card != null) {
                card.setAlpha(0f);
                card.setTranslationY(40f * density);
                card.setScaleX(0.94f);
                card.setScaleY(0.94f);

                ObjectAnimator fade = ObjectAnimator.ofFloat(card, View.ALPHA, 0f, 1f);
                ObjectAnimator slide = ObjectAnimator.ofFloat(card, View.TRANSLATION_Y, 40f * density, 0f);
                ObjectAnimator sx = ObjectAnimator.ofFloat(card, View.SCALE_X, 0.94f, 1f);
                ObjectAnimator sy = ObjectAnimator.ofFloat(card, View.SCALE_Y, 0.94f, 1f);
                AnimatorSet enter = new AnimatorSet();
                enter.playTogether(fade, slide, sx, sy);
                enter.setDuration(520);
                enter.setInterpolator(new OvershootInterpolator(1.08f));
                enter.start();
            }

            if (pulse != null) {
                ObjectAnimator pulseA = ObjectAnimator.ofFloat(pulse, View.ALPHA, 0.3f, 1f, 0.3f);
                pulseA.setDuration(1500);
                pulseA.setRepeatCount(ObjectAnimator.INFINITE);
                pulseA.start();
                pulse.setTag(pulseA);
            }

            toastGuard.postDelayed(() -> hideBrandedStatusPill(true), 2900);
        } catch (Throwable ignored) {
            pillShowing = false;
        }
    }

    private void hideBrandedStatusPill(boolean animated) {
        if (brandedPill == null || brandedPill.getParent() == null) {
            pillShowing = false;
            return;
        }
        View card = brandedPill.findViewById(R.id.sociva_status_pill_card);
        View pulse = brandedPill.findViewById(R.id.sociva_status_pill_pulse);
        if (pulse != null && pulse.getTag() instanceof ObjectAnimator) {
            ((ObjectAnimator) pulse.getTag()).cancel();
        }

        Runnable remove = () -> {
            try {
                ViewGroup parent = (ViewGroup) brandedPill.getParent();
                if (parent != null) parent.removeView(brandedPill);
            } catch (Throwable ignored) { /* noop */ }
            pillShowing = false;
        };

        if (!animated || card == null) {
            remove.run();
            return;
        }

        float density = getResources().getDisplayMetrics().density;
        ObjectAnimator fade = ObjectAnimator.ofFloat(card, View.ALPHA, card.getAlpha(), 0f);
        ObjectAnimator slide = ObjectAnimator.ofFloat(card, View.TRANSLATION_Y, card.getTranslationY(), 24f * density);
        AnimatorSet exit = new AnimatorSet();
        exit.playTogether(fade, slide);
        exit.setDuration(340);
        exit.setInterpolator(new DecelerateInterpolator());
        exit.addListener(new android.animation.AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(android.animation.Animator animation) {
                remove.run();
            }
        });
        exit.start();
    }

    private static String collectText(View view) {
        StringBuilder sb = new StringBuilder();
        if (view instanceof TextView) {
            CharSequence t = ((TextView) view).getText();
            if (t != null) sb.append(t).append(' ');
        }
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                sb.append(collectText(group.getChildAt(i)));
            }
        }
        return sb.toString();
    }
}
