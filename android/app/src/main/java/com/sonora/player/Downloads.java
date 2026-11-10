package com.sonora.player;

import android.content.Context;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import okhttp3.Request;
import okhttp3.Response;

/** Músicas baixadas para ouvir sem internet. Ficam na pasta privada do app. */
public final class Downloads {
    public interface Progress { void on(String id, double fraction); }

    private static final Object lock = new Object();
    private static final long CHUNK = 1L << 20; // 1 MB por pedaço (o YouTube limita downloads sem Range)

    private Downloads() {}

    static File dir(Context c) {
        File d = new File(c.getFilesDir(), "downloads");
        if (!d.exists()) d.mkdirs();
        return d;
    }
    public static File audioFile(Context c, String id) { return new File(dir(c), safe(id) + ".audio"); }
    public static File thumbFile(Context c, String id) { return new File(dir(c), safe(id) + ".jpg"); }
    private static File index(Context c) { return new File(dir(c), "index.json"); }
    private static String safe(String id) { return id.replaceAll("[^A-Za-z0-9_-]", "_"); }

    static JSONArray readIndex(Context c) {
        try {
            File f = index(c);
            if (!f.exists()) return new JSONArray();
            return new JSONArray(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8));
        } catch (Exception e) { return new JSONArray(); }
    }
    private static void writeIndex(Context c, JSONArray arr) throws IOException {
        File tmp = new File(dir(c), "index.json.tmp");
        Files.write(tmp.toPath(), arr.toString().getBytes(StandardCharsets.UTF_8));
        if (!tmp.renameTo(index(c))) throw new IOException("falha ao salvar índice");
    }

    public static JSArray list(Context c) {
        JSArray out = new JSArray();
        JSONArray arr = readIndex(c);
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o != null && audioFile(c, o.optString("id")).exists()) {
                try { out.put(JSObject.fromJSONObject(o)); } catch (Exception ignored) {}
            }
        }
        return out;
    }

    public static boolean has(Context c, String id) { return audioFile(c, id).exists(); }

    /** Baixa o áudio (e a capa) de uma música. Bloqueante: chame fora da thread principal. */
    public static void download(Context c, JSObject track, Progress progress) throws Exception {
        String id = track.getString("id");
        File out = audioFile(c, id);
        if (out.exists()) { progress.on(id, 1); return; }

        String[] a = YtExtractor.resolveAudio(id);
        File part = new File(dir(c), safe(id) + ".part");
        long total = -1, done = 0;
        try (FileOutputStream fos = new FileOutputStream(part)) {
            while (total < 0 || done < total) {
                long end = done + CHUNK - 1;
                Request req = new Request.Builder().url(a[0])
                        .header("User-Agent", a[1])
                        .header("Range", "bytes=" + done + "-" + end).build();
                try (Response res = YtExtractor.client().newCall(req).execute()) {
                    if (res.code() == 403) { YtExtractor.invalidate(id); throw new IOException("Link expirado, tente de novo"); }
                    if (!res.isSuccessful() || res.body() == null) throw new IOException("HTTP " + res.code());
                    String cr = res.header("Content-Range"); // bytes 0-1048575/3456789
                    if (cr != null && cr.contains("/")) total = Long.parseLong(cr.substring(cr.lastIndexOf('/') + 1).trim());
                    else if (total < 0) total = res.body().contentLength();
                    try (InputStream in = res.body().byteStream()) {
                        byte[] buf = new byte[64 * 1024];
                        int n; long got = 0;
                        while ((n = in.read(buf)) > 0) { fos.write(buf, 0, n); got += n; }
                        if (got == 0) break;
                        done += got;
                    }
                }
                if (total > 0) progress.on(id, Math.min(0.99, (double) done / total));
            }
        }
        if (!part.renameTo(out)) throw new IOException("falha ao salvar arquivo");

        // capa para a notificação/tela de bloqueio funcionarem sem internet
        try {
            Request req = new Request.Builder().url(track.getString("thumbnail", YtExtractor.thumbFor(id))).build();
            try (Response res = YtExtractor.client().newCall(req).execute()) {
                if (res.isSuccessful() && res.body() != null) Files.write(thumbFile(c, id).toPath(), res.body().bytes());
            }
        } catch (Exception ignored) {}

        synchronized (lock) {
            JSONArray arr = readIndex(c);
            JSONObject o = new JSONObject();
            o.put("id", id);
            o.put("title", track.getString("title", ""));
            o.put("author", track.getString("author", ""));
            o.put("duration", track.optInt("duration", 0));
            o.put("thumbnail", track.getString("thumbnail", YtExtractor.thumbFor(id)));
            o.put("size", out.length());
            o.put("savedAt", System.currentTimeMillis());
            arr.put(o);
            writeIndex(c, arr);
        }
        progress.on(id, 1);
    }

    public static void remove(Context c, String id) throws Exception {
        audioFile(c, id).delete();
        thumbFile(c, id).delete();
        new File(dir(c), safe(id) + ".part").delete();
        synchronized (lock) {
            JSONArray arr = readIndex(c), keep = new JSONArray();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o != null && !id.equals(o.optString("id"))) keep.put(o);
            }
            writeIndex(c, keep);
        }
    }

    public static long totalBytes(Context c) {
        long t = 0;
        File[] fs = dir(c).listFiles();
        if (fs != null) for (File f : fs) t += f.length();
        return t;
    }
}
