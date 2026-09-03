package app.sociva.community;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LiveActivityPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
