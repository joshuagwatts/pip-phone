package com.pip.phone;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "PipUpdate")
public class PipUpdatePlugin extends Plugin {

    @PluginMethod
    public void installApk(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("need url");
            return;
        }

        new Thread(() -> {
            try {
                File out = new File(getContext().getCacheDir(), "Pip-update.apk");
                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(30000);
                conn.setReadTimeout(180000);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("User-Agent", "Pip-Phone-Updater");
                int code = conn.getResponseCode();
                if (code >= 400) {
                    call.reject("download failed — http " + code);
                    return;
                }
                try (InputStream in = conn.getInputStream(); FileOutputStream fos = new FileOutputStream(out)) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) >= 0) {
                        fos.write(buf, 0, n);
                    }
                }

                getActivity().runOnUiThread(() -> {
                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            if (!getContext().getPackageManager().canRequestPackageInstalls()) {
                                Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                                settings.setData(Uri.parse("package:" + getContext().getPackageName()));
                                settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                getContext().startActivity(settings);
                                call.reject("allow installs from Pip in settings, then tap UPDATE again");
                                return;
                            }
                        }

                        Uri uri = FileProvider.getUriForFile(
                            getContext(),
                            getContext().getPackageName() + ".fileprovider",
                            out
                        );
                        Intent intent = new Intent(Intent.ACTION_VIEW);
                        intent.setDataAndType(uri, "application/vnd.android.package-archive");
                        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        getContext().startActivity(intent);
                        call.resolve();
                    } catch (Exception e) {
                        call.reject(e.getMessage() != null ? e.getMessage() : "install failed");
                    }
                });
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "download failed");
            }
        }).start();
    }
}
