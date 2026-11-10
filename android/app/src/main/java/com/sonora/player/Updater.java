package com.sonora.player;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import okhttp3.Request;
import okhttp3.Response;

/**
 * Atualizações do APK:
 *  - Live update: baixa só a interface (zip da pasta dist) e passa a carregá-la no lugar da embutida.
 *  - APK novo: baixa e abre o instalador do Android quando a parte nativa muda.
 */
public final class Updater {
    public interface Progress { void on(double fraction); }

    /** Mesmas chaves que o Capacitor usa para lembrar a pasta da interface entre aberturas do app. */
    static final String CAP_PREFS = "CapWebViewSettings";
    static final String CAP_PATH_KEY = "serverBasePath";
    static final String PREFS = "sonora_updates";

    private Updater() {}

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    public static String versionName(Context c) {
        try { return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName; } catch (Exception e) { return "0"; }
    }
    public static long versionCode(Context c) {
        try {
            PackageInfo p = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode;
        } catch (Exception e) { return 0; }
    }

    /** Versão da interface em uso: a baixada (live update) ou a que veio dentro do APK. */
    public static String bundleVersion(Context c) {
        String v = prefs(c).getString("bundleVersion", null);
        return v != null && activeBundleDir(c) != null ? v : versionName(c);
    }

    public static File activeBundleDir(Context c) {
        String p = c.getSharedPreferences(CAP_PREFS, Context.MODE_PRIVATE).getString(CAP_PATH_KEY, null);
        if (p == null) return null;
        File f = new File(p);
        return new File(f, "index.html").exists() ? f : null;
    }

    /** Compara versões "1.2.10" > "1.2.9". */
    public static int compare(String a, String b) {
        String[] x = (a == null ? "0" : a).split("[.-]"), y = (b == null ? "0" : b).split("[.-]");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int p = i < x.length ? parse(x[i]) : 0, q = i < y.length ? parse(y[i]) : 0;
            if (p != q) return Integer.compare(p, q);
        }
        return 0;
    }
    private static int parse(String s) { try { return Integer.parseInt(s.replaceAll("\\D", "")); } catch (Exception e) { return 0; } }

    /**
     * Ao abrir o app: se a interface baixada for mais antiga (ou igual) que a embutida num APK novo,
     * volta a usar a embutida.
     */
    public static void dropStaleBundle(Context c) {
        String bv = prefs(c).getString("bundleVersion", null);
        if (bv != null && compare(bv, versionName(c)) <= 0) clearBundle(c);
    }

    public static void clearBundle(Context c) {
        c.getSharedPreferences(CAP_PREFS, Context.MODE_PRIVATE).edit().remove(CAP_PATH_KEY).apply();
        prefs(c).edit().remove("bundleVersion").remove("pending").apply();
    }

    static void download(String url, File out, Progress progress) throws IOException {
        Request req = new Request.Builder().url(url).header("User-Agent", "Sonora-Updater").build();
        try (Response res = YtExtractor.client().newCall(req).execute()) {
            if (!res.isSuccessful() || res.body() == null) throw new IOException("HTTP " + res.code());
            long total = res.body().contentLength(), done = 0;
            out.getParentFile().mkdirs();
            try (InputStream in = res.body().byteStream(); FileOutputStream fos = new FileOutputStream(out)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) {
                    fos.write(buf, 0, n);
                    done += n;
                    if (total > 0) progress.on(Math.min(0.99, (double) done / total));
                }
            }
        }
    }

    /** Baixa e descompacta a interface nova. Retorna a pasta pronta (com index.html). */
    public static File downloadBundle(Context c, String url, String version, Progress progress) throws IOException {
        File root = new File(c.getFilesDir(), "bundles");
        File zip = new File(root, version + ".zip");
        File dir = new File(root, version);
        download(url, zip, progress);
        deleteRecursive(dir);
        dir.mkdirs();
        String base = dir.getCanonicalPath() + File.separator;
        try (ZipInputStream zin = new ZipInputStream(new java.io.FileInputStream(zip))) {
            ZipEntry e;
            byte[] buf = new byte[64 * 1024];
            while ((e = zin.getNextEntry()) != null) {
                File f = new File(dir, e.getName());
                if (!f.getCanonicalPath().startsWith(base)) throw new IOException("Arquivo inválido no pacote"); // evita "zip slip"
                if (e.isDirectory()) { f.mkdirs(); continue; }
                f.getParentFile().mkdirs();
                try (FileOutputStream fos = new FileOutputStream(f)) { int n; while ((n = zin.read(buf)) > 0) fos.write(buf, 0, n); }
            }
        }
        zip.delete();
        if (!new File(dir, "index.html").exists()) throw new IOException("Pacote sem index.html");
        return dir;
    }

    /** Remove pacotes antigos, mantendo só o que está em uso. */
    public static void cleanupBundles(Context c) {
        File active = activeBundleDir(c);
        File[] all = new File(c.getFilesDir(), "bundles").listFiles();
        if (all == null) return;
        for (File f : all) if (active == null || !f.getAbsolutePath().equals(active.getAbsolutePath())) deleteRecursive(f);
    }

    static void deleteRecursive(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteRecursive(k);
        f.delete();
    }

    // ---------------- APK ----------------
    public static boolean canInstall(Context c) {
        return Build.VERSION.SDK_INT < 26 || c.getPackageManager().canRequestPackageInstalls();
    }

    public static void openInstallPermission(Context c) {
        if (Build.VERSION.SDK_INT >= 26) {
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + c.getPackageName()))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(i);
        }
    }

    public static File downloadApk(Context c, String url, Progress progress) throws IOException {
        File out = new File(new File(c.getCacheDir(), "updates"), "Sonora-update.apk");
        download(url, out, progress);
        return out;
    }

    public static void launchInstaller(Context c, File apk) {
        Uri uri = FileProvider.getUriForFile(c, c.getPackageName() + ".fileprovider", apk);
        Intent i = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        c.startActivity(i);
    }
}
