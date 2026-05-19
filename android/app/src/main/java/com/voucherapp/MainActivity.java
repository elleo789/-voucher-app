package com.voucherapp;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.voucherapp.plugins.MikroTikPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        registerPlugin(MikroTikPlugin.class);
    }
}
