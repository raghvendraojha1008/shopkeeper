package com.shopledger.india;

import android.os.Bundle;
import android.webkit.PermissionRequest;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Capacitor's default BridgeWebChromeClient routes onPermissionRequest
        // through its plugin registry.  When no plugin is registered for
        // AUDIO_CAPTURE the request is silently dropped, causing getUserMedia()
        // to throw NotAllowedError even though RECORD_AUDIO is granted.
        //
        // Fix: replace the WebChromeClient with a subclass of
        // BridgeWebChromeClient that grants all WebView resource requests
        // immediately.  The OS-level gate (RECORD_AUDIO + MODIFY_AUDIO_SETTINGS
        // manifest permissions) is already enforced before this point, so
        // granting here does not bypass any security boundary.
        this.bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(this.bridge) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                // Grant the WebView access to requested resources (microphone,
                // camera, etc.) on the UI thread, as required by Android.
                runOnUiThread(() -> request.grant(request.getResources()));
            }
        });
    }
}
