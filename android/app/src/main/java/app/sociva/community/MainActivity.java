package app.sociva.community;

import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static volatile boolean inForeground = false;

    public static boolean isInForeground() {
        return inForeground;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        OrderAlertChannels.ensure(this);
        registerPlugin(LiveActivityPlugin.class);
        registerPlugin(SocivaVoipPlugin.class);
        registerPlugin(OrderAlertRingerPlugin.class);
        super.onCreate(savedInstanceState);
        disableWebViewOverscroll();
    }

    /**
     * Inner-div (#root) scrolling cannot drive native SwipeRefreshLayout.
     * Kill the WebView glow so it does not fight the JS pull-to-refresh gesture.
     */
    private void disableWebViewOverscroll() {
        if (getBridge() == null) return;
        WebView webView = getBridge().getWebView();
        if (webView == null) return;
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
    }

    @Override
    public void onStart() {
        super.onStart();
        disableWebViewOverscroll();
    }

    @Override
    public void onResume() {
        super.onResume();
        inForeground = true;
        disableWebViewOverscroll();
    }

    @Override
    public void onPause() {
        inForeground = false;
        super.onPause();
    }
}
