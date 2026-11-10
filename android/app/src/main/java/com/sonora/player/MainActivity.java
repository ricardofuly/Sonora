package com.sonora.player;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SonoraPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
