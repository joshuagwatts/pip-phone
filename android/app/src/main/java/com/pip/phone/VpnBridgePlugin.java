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

/**
 * Proton companion: detect system VPN, open Proton, and briefly bind Pip to Wi‑Fi
 * so desktop LAN (192.168.x.x:7420) works while Proton is connected.
 */
@CapacitorPlugin(name = "VpnBridge")
public class VpnBridgePlugin extends Plugin {
    private ConnectivityManager cm() {
        return (ConnectivityManager) getContext().getSystemService(android.content.Context.CONNECTIVITY_SERVICE);
    }

    private boolean vpnActive() {
        ConnectivityManager cm = cm();
        if (cm == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Network net = cm.getActiveNetwork();
            if (net == null) return false;
            NetworkCapabilities caps = cm.getNetworkCapabilities(net);
            return caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN);
        }
        return false;
    }

    /** Prefer Wi‑Fi so LAN HTTP can bypass the VPN tunnel. */
    private Network findWifi(ConnectivityManager cm) {
        if (cm == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return null;
        Network[] nets = cm.getAllNetworks();
        if (nets == null) return null;
        Network fallback = null;
        for (Network n : nets) {
            NetworkCapabilities caps = cm.getNetworkCapabilities(n);
            if (caps == null || !caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) continue;
            if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    || caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)) {
                return n;
            }
            if (fallback == null) fallback = n;
        }
        return fallback;
    }

    @PluginMethod
    public void isActive(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("active", vpnActive());
        call.resolve(ret);
    }

    /**
     * Bind this process to Wi‑Fi so CapacitorHttp / fetch can reach LAN
     * while Proton (or another VPN) is the default route.
     */
    @PluginMethod
    public void bindWifi(PluginCall call) {
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            ret.put("ok", false);
            ret.put("reason", "unsupported");
            call.resolve(ret);
            return;
        }
        ConnectivityManager cm = cm();
        Network wifi = findWifi(cm);
        if (wifi == null) {
            ret.put("ok", false);
            ret.put("reason", "no_wifi");
            call.resolve(ret);
            return;
        }
        boolean ok = cm.bindProcessToNetwork(wifi);
        ret.put("ok", ok);
        ret.put("reason", ok ? "wifi" : "bind_failed");
        call.resolve(ret);
    }

    @PluginMethod
    public void unbindNetwork(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            ConnectivityManager cm = cm();
            if (cm != null) cm.bindProcessToNetwork(null);
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
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
