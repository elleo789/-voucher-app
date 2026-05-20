package com.voucherapp;

import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.voucherapp.plugins.MikroTikPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Register Capacitor plugin
        registerPlugin(MikroTikPlugin.class);

        // Add direct JavaScript bridge (bypasses Capacitor plugin system)
        addJavascriptBridge();
    }

    private void addJavascriptBridge() {
        try {
            // Wait for bridge to initialize, then add JS interface
            getBridge().getWebView().addJavascriptInterface(
                new MikroTikJSBridge(), "AndroidBridge"
            );
        } catch (Exception e) {
            // If bridge isn't ready yet, try after a short delay
            getBridge().getWebView().post(() -> {
                try {
                    getBridge().getWebView().addJavascriptInterface(
                        new MikroTikJSBridge(), "AndroidBridge"
                    );
                } catch (Exception ex) {
                    // Ignore
                }
            });
        }
    }

    /**
     * Direct JavaScript-to-Java bridge for MikroTik API.
     * This is called from JavaScript via AndroidBridge.mikroTikExecute(...)
     */
    private static class MikroTikJSBridge {

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

        private String getProfilesJson(MikroTikPlugin.RouterOSSession session) throws Exception {
            java.util.List<java.util.Map<String, String>> profiles = session.getProfiles();
            StringBuilder sb = new StringBuilder();
            sb.append("{\"ok\":true,\"result\":\"");
            int count = 0;
            for (java.util.Map<String, String> p : profiles) {
                if (p.containsKey("__diag__")) continue;
                count++;
                String name = p.getOrDefault("name", "?");
                String tl = p.getOrDefault("timelimit", "?");
                String val = p.getOrDefault("validez", "?");
                sb.append(escapeJson(name)).append(",")
                  .append(escapeJson(tl)).append(",")
                  .append(escapeJson(val)).append("\\n");
            }
            if (count == 0) {
                sb.append("__total__,").append(profiles.size()).append(",0");
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
