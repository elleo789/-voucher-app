package com.voucherapp;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.content.FileProvider;

import com.getcapacitor.BridgeActivity;
import com.voucherapp.plugins.MikroTikPlugin;

import java.io.File;
import java.io.FileOutputStream;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        registerPlugin(MikroTikPlugin.class);
        addJavascriptBridge();
    }

    private void addJavascriptBridge() {
        try {
            getBridge().getWebView().addJavascriptInterface(
                new MikroTikJSBridge(this), "AndroidBridge"
            );
        } catch (Exception e) {
            getBridge().getWebView().post(() -> {
                try {
                    getBridge().getWebView().addJavascriptInterface(
                        new MikroTikJSBridge(MainActivity.this), "AndroidBridge"
                    );
                } catch (Exception ignored) {}
            });
        }
    }

    private static class MikroTikJSBridge {
        private Context context;

        MikroTikJSBridge(Context context) {
            this.context = context;
        }

        @JavascriptInterface
        public String mikroTikExecute(String ip, String password, String action, String commands) {
            try {
                String result;
                MikroTikPlugin.RouterOSSession session = new MikroTikPlugin.RouterOSSession(ip, 8728);
                session.login(password);

                switch (action) {
                    case "profiles":
                        result = getProfilesJson(session);
                        break;
                    case "execute":
                        result = executeCommandsJson(session, commands);
                        break;
                    default:
                        return "{\"ok\":false,\"error\":\"Accion desconocida: " + action + "\"}";
                }

                session.close();
                return result;
            } catch (Exception e) {
                return "{\"ok\":false,\"error\":\"" + escapeJson(e.getMessage()) + "\"}";
            }
        }

        @JavascriptInterface
        public void shareFile(String base64Data, String filename, String mimeType) {
            try {
                // Decode base64
                byte[] data = Base64.decode(base64Data, Base64.DEFAULT);

                // Write to temp file
                File cacheDir = new File(context.getCacheDir(), "shared");
                cacheDir.mkdirs();
                File file = new File(cacheDir, filename);
                FileOutputStream fos = new FileOutputStream(file);
                fos.write(data);
                fos.close();

                // Create share intent with FileProvider
                Uri uri = FileProvider.getUriForFile(
                    context,
                    context.getPackageName() + ".fileprovider",
                    file
                );

                Intent intent = new Intent(Intent.ACTION_SEND);
                intent.setType(mimeType);
                intent.putExtra(Intent.EXTRA_STREAM, uri);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

                context.startActivity(Intent.createChooser(intent, "Compartir vouchers"));
            } catch (Exception e) {
                // Ignore share errors
            }
        }

        private String getProfilesJson(MikroTikPlugin.RouterOSSession session) throws Exception {
            java.util.List<java.util.Map<String, String>> profiles = session.getProfiles();
            StringBuilder sb = new StringBuilder();
            sb.append("{\"ok\":true,\"result\":\"");
            int count = 0;
            for (java.util.Map<String, String> p : profiles) {
                count++;
                String name = p.getOrDefault("name", "?");
                String tl = p.getOrDefault("timelimit", "?");
                String val = p.getOrDefault("validez", "?");
                sb.append(escapeJson(name)).append(",")
                  .append(escapeJson(tl)).append(",")
                  .append(escapeJson(val)).append("\\n");
            }
            if (count == 0) {
                sb.append("sin%20perfiles");
            }
            sb.append("\"}");
            return sb.toString();
        }

        private String executeCommandsJson(MikroTikPlugin.RouterOSSession session, String commands) throws Exception {
            String[] cmds = commands.split(";");
            StringBuilder result = new StringBuilder();
            for (String cmd : cmds) {
                cmd = cmd.trim();
                if (cmd.isEmpty()) continue;
                String resp = session.execute(cmd);
                if (resp != null && !resp.isEmpty()) {
                    result.append(resp).append("\n");
                }
            }
            return "{\"ok\":true,\"result\":\"" + escapeJson(result.toString().trim()) + "\"}";
        }

        private String escapeJson(String s) {
            if (s == null) return "";
            return s.replace("\\", "\\\\")
                    .replace("\"", "\\\"")
                    .replace("\n", "\\n")
                    .replace("\r", "\\r")
                    .replace("\t", "\\t");
        }
    }
}
