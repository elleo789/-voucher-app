package com.voucherapp.plugins;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.*;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

@CapacitorPlugin(name = "MikroTik")
public class MikroTikPlugin extends Plugin {

    @PluginMethod
    public void execute(PluginCall call) {
        String ip = call.getString("ip");
        String password = call.getString("password");
        String action = call.getString("action");
        String commands = call.getString("commands");
        if (commands == null) commands = "";

        if (ip == null || password == null || action == null) {
            call.reject("Faltan parametros requeridos");
            return;
        }

        try {
            String result;
            switch (action) {
                case "profiles":
                    result = getProfiles(ip, password);
                    break;
                case "execute":
                    result = executeCommands(ip, password, commands);
                    break;
                default:
                    call.reject("Accion desconocida: " + action);
                    return;
            }
            JSObject ret = new JSObject();
            ret.put("result", result != null ? result : "");
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("error", e.getMessage());
            ret.put("result", "");
            call.resolve(ret);
        }
    }

    private RouterOSSession connect(String ip, String password) throws Exception {
        RouterOSSession session = new RouterOSSession(ip, 8728);
        session.login(password);
        return session;
    }

    private String getProfiles(String ip, String password) throws Exception {
        RouterOSSession session = connect(ip, password);
        List<Map<String, String>> profiles = session.getProfiles();
        session.close();

        StringBuilder sb = new StringBuilder();
        // First line: diagnostic info (total sentences read)
        sb.append("__total_read__").append("\n");
        for (Map<String, String> p : profiles) {
            String name = p.getOrDefault("name", "?");
            String tl = p.getOrDefault("timelimit", "?");
            String val = p.getOrDefault("validez", "?");
            sb.append(escapeCsvField(name)).append(",")
              .append(escapeCsvField(tl)).append(",")
              .append(escapeCsvField(val)).append("\n");
        }
        return sb.toString().trim();
    }

    private String escapeCsvField(String s) {
        if (s == null) return "?";
        return s.replace(",", "|");
    }

    private String executeCommands(String ip, String password, String commands) throws Exception {
        RouterOSSession session = connect(ip, password);
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
        session.close();
        return result.toString().trim();
    }

    public static class RouterOSSession {
        private Socket socket;
        private DataInputStream in;
        private OutputStream out;

        public RouterOSSession(String host, int port) throws Exception {
            socket = new Socket(host, port);
            socket.setSoTimeout(15000); // 15s timeout
            in = new DataInputStream(socket.getInputStream());
            out = socket.getOutputStream();
        }

        public void login(String password) throws Exception {
            List<String> words = new ArrayList<>();
            words.add("/login");
            sendSentence(words);

            Map<String, String> response = readResponse();
            String challenge = response.get("ret");

            if (challenge != null && !challenge.isEmpty()) {
                String responseHash = md5hex("\u0000" + password + challenge);
                words.clear();
                words.add("/login");
                words.add("=name=admin");
                words.add("=response=00" + responseHash);
                sendSentence(words);

                Map<String, String> loginResp = readResponse();
                if (loginResp.containsKey("!trap") || loginResp.containsKey("!fatal")) {
                    throw new Exception("Error de autenticacion: " + loginResp.get("message"));
                }
            } else {
                words.clear();
                words.add("/login");
                words.add("=name=admin");
                words.add("=password=" + password);
                sendSentence(words);
                Map<String, String> loginResp = readResponse();
                if (loginResp.containsKey("!trap") || loginResp.containsKey("!fatal")) {
                    throw new Exception("Error de autenticacion: " + loginResp.get("message"));
                }
            }
        }

        public List<Map<String, String>> getProfiles() throws Exception {
            // Use /ip/hotspot/user/profile/print to get all profiles
            // Test 1: send bare print with no args to see raw response count
            List<String> words = new ArrayList<>();
            words.add("/ip/hotspot/user/profile/print");
            sendSentence(words);

            List<Map<String, String>> response = readSentences();
            List<Map<String, String>> profiles = new ArrayList<>();

            // Store diagnostic: count of all sentences received
            int totalSentences = response.size();
            int profileCount = 0;
            int trapCount = 0;
            StringBuilder rawNames = new StringBuilder();

            for (Map<String, String> row : response) {
                if (row.containsKey("!trap")) { trapCount++; continue; }
                if (row.containsKey("!fatal")) { continue; }
                if (row.containsKey("!done")) { continue; }
                if (!row.containsKey("name")) continue;

                String name = row.get("name");
                if (name == null || name.equals("default")) continue;
                profileCount++;
                rawNames.append(name).append("|");

                Map<String, String> p = new LinkedHashMap<>();
                p.put("name", name);
                p.put("timelimit", "?");
                p.put("validez", "?");
                profiles.add(p);
            }

            // Diagnostic line
            Map<String, String> diag = new LinkedHashMap<>();
            diag.put("name", "__total__");
            diag.put("timelimit", String.valueOf(totalSentences));
            diag.put("validez", profileCount + "p/" + trapCount + "t/" + rawNames.toString());
            profiles.add(0, diag);

            return profiles;
        }

        public String execute(String command) throws Exception {
            List<String> words = new ArrayList<>();
            String[] parts = command.split("\\s+");
            words.add(parts[0]);
            for (int i = 1; i < parts.length; i++) {
                if (parts[i].contains("=")) {
                    words.add("=" + parts[i]);
                } else {
                    words.add(parts[i]);
                }
            }
            sendSentence(words);

            List<Map<String, String>> response = readSentences();
            StringBuilder result = new StringBuilder();
            for (Map<String, String> row : response) {
                if (row.containsKey("!trap") || row.containsKey("!fatal")) {
                    throw new Exception("Error: " + row.get("message"));
                }
                if (row.containsKey("!re")) {
                    for (Map.Entry<String, String> e : row.entrySet()) {
                        if (!e.getKey().startsWith("!")) {
                            result.append(e.getKey()).append("=").append(e.getValue()).append("\n");
                        }
                    }
                }
            }
            return result.toString().trim();
        }

        public void close() {
            try { if (socket != null) socket.close(); } catch (Exception ignored) {}
        }

        private void sendSentence(List<String> words) throws Exception {
            for (String word : words) {
                writeWord(word);
            }
            writeLength(0);
            out.flush();
        }

        private void writeWord(String word) throws Exception {
            byte[] data = word.getBytes(StandardCharsets.UTF_8);
            writeLength(data.length);
            out.write(data);
        }

        private void writeLength(int length) throws Exception {
            if (length < 128) {
                out.write(length);
            } else if (length < 16384) {
                out.write((length >> 8) | 0x80);
                out.write(length & 0xFF);
            } else if (length < 2097152) {
                out.write((length >> 16) | 0xC0);
                out.write((length >> 8) & 0xFF);
                out.write(length & 0xFF);
            } else if (length < 268435456) {
                out.write((length >> 24) | 0xE0);
                out.write((length >> 16) & 0xFF);
                out.write((length >> 8) & 0xFF);
                out.write(length & 0xFF);
            } else {
                out.write(0xF0);
                out.write((length >> 24) & 0xFF);
                out.write((length >> 16) & 0xFF);
                out.write((length >> 8) & 0xFF);
                out.write(length & 0xFF);
            }
        }

        private String readWord() throws Exception {
            int length = readLength();
            if (length == 0) return "";
            byte[] data = new byte[length];
            in.readFully(data);
            return new String(data, StandardCharsets.UTF_8);
        }

        private int readLength() throws Exception {
            int b = in.readUnsignedByte();
            if (b < 128) return b;
            if (b < 192) {
                return ((b & 0x3F) << 8) | in.readUnsignedByte();
            }
            if (b < 224) {
                return ((b & 0x1F) << 16) | (in.readUnsignedByte() << 8) | in.readUnsignedByte();
            }
            if (b < 240) {
                return ((b & 0x0F) << 24) | (in.readUnsignedByte() << 16) |
                       (in.readUnsignedByte() << 8) | in.readUnsignedByte();
            }
            return (in.readUnsignedByte() << 24) | (in.readUnsignedByte() << 16) |
                   (in.readUnsignedByte() << 8) | in.readUnsignedByte();
        }

        private Map<String, String> readResponse() throws Exception {
            List<Map<String, String>> sentences = readSentences();
            if (!sentences.isEmpty()) return sentences.get(0);
            return new HashMap<>();
        }

        private List<Map<String, String>> readSentences() throws Exception {
            List<Map<String, String>> sentences = new ArrayList<>();

            while (true) {
                // Check if socket is closed
                if (socket.isClosed() || socket.isInputShutdown()) break;

                Map<String, String> sentence = new LinkedHashMap<>();

                while (true) {
                    // Check for timeout
                    try {
                        int avail = in.available();
                    } catch (IOException e) {
                        break;
                    }

                    String word = readWord();
                    if (word.isEmpty()) break; // End of sentence

                    if (word.startsWith("!")) {
                        sentence.put(word, word);
                    } else if (word.startsWith("=")) {
                        int eqPos = word.indexOf('=', 1);
                        if (eqPos > 0) {
                            String key = word.substring(1, eqPos);
                            String value = word.substring(eqPos + 1);
                            sentence.put(key, value);
                        } else {
                            sentence.put(word.substring(1), "");
                        }
                    } else if (word.startsWith(".")) {
                        int eqPos = word.indexOf('=');
                        if (eqPos > 0) {
                            sentence.put(word.substring(0, eqPos), word.substring(eqPos + 1));
                        } else {
                            sentence.put(word, "");
                        }
                    } else {
                        sentence.put("_value", word);
                    }
                }

                if (sentence.isEmpty()) continue;

                boolean isDone = sentence.containsKey("!done");
                boolean isFatal = sentence.containsKey("!fatal");

                sentences.add(sentence);
                if (isDone || isFatal) break;
            }

            return sentences;
        }

        private String md5hex(String input) throws Exception {
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] digest = md.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : digest) {
                sb.append(String.format("%02x", b & 0xff));
            }
            return sb.toString();
        }
    }

    private static String deduceTimelimit(String profileName) {
        if (profileName == null) return "?";
        String upper = profileName.toUpperCase();
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("(\\d+)(HORA|HORAS|DIA|DIAS)").matcher(upper);
        if (m.find()) {
            String num = m.group(1);
            String suffix = m.group(2);
            return suffix.startsWith("H") ? num + "h" : num + "d";
        }
        return "?";
    }
}
