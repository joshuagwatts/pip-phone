package com.pip.phone;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "VpnBridge")
public class VpnBridgePlugin extends Plugin {
    private boolean vpnActive() {
        ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(android.content.Context.CONNECTIVITY_SERVICE);
        if (cm == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Network net = cm.getActiveNetwork();
            if (net == null) return false;
            NetworkCapabilities caps = cm.getNetworkCapabilities(net);
            return caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN);
        }
        return false;
    }

    @PluginMethod
    public void isActive(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("active", vpnActive());
        call.resolve(ret);
    }

    @PluginMethod
    public void openProton(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        Intent launch = pm.getLaunchIntentForPackage("ch.protonvpn.android");
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(launch);
            call.resolve();
            return;
        }
        Intent market = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=ch.protonvpn.android"));
        market.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(market);
            call.resolve();
        } catch (Exception e) {
            call.reject("Proton VPN not installed");
        }
    }

    @PluginMethod
    public void setKeepAlive(PluginCall call) {
        boolean on = call.getBoolean("on", false);
        Intent svc = new Intent(getContext(), PipKeepAliveService.class);
        if (on) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(svc);
            } else {
                getContext().startService(svc);
            }
        } else {
            getContext().stopService(svc);
        }
        JSObject ret = new JSObject();
        ret.put("on", on);
        call.resolve(ret);
    }
}
