package com.sonora.player;

import android.content.ComponentName;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.MoreExecutors;

import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/** Ponte entre a interface (React) e a parte nativa: busca no YouTube, tocador e downloads. */
@UnstableApi
@CapacitorPlugin(name = "Sonora")
public class SonoraPlugin extends Plugin {
    private final ExecutorService net = Executors.newFixedThreadPool(4);
    private final ExecutorService dl = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private ListenableFuture<MediaController> controllerFuture;
    private MediaController controller;
    private final List<Runnable> pending = new ArrayList<>();

    @Override
    public void load() {
        YtExtractor.init(getContext());
        SessionToken token = new SessionToken(getContext(), new ComponentName(getContext(), PlaybackService.class));
        controllerFuture = new MediaController.Builder(getContext(), token).buildAsync();
        controllerFuture.addListener(() -> {
            try {
                controller = controllerFuture.get();
                controller.addListener(new Player.Listener() {
                    @Override public void onEvents(@NonNull Player player, @NonNull Player.Events events) { emitState(); }
                });
                for (Runnable r : pending) r.run();
                pending.clear();
                emitState();
            } catch (Exception e) {
                android.util.Log.e("Sonora", "Falha ao conectar ao tocador", e);
            }
        }, MoreExecutors.directExecutor());
    }

    @Override
    protected void handleOnDestroy() {
        if (controllerFuture != null) MediaController.releaseFuture(controllerFuture);
        net.shutdown();
    }

    /** Executa com o controlador pronto, sempre na thread principal. */
    private void withPlayer(PluginCall call, java.util.function.Consumer<MediaController> fn) {
        main.post(() -> {
            Runnable r = () -> {
                try { fn.accept(controller); if (call != null) call.resolve(); }
                catch (Exception e) { if (call != null) call.reject(e.getMessage()); }
            };
            if (controller != null) r.run(); else pending.add(r);
        });
    }

    private JSObject state() {
        JSObject o = new JSObject();
        if (controller == null) { o.put("ready", false); return o; }
        MediaController c = controller;
        o.put("ready", true);
        o.put("playing", c.isPlaying());
        o.put("playWhenReady", c.getPlayWhenReady());
        o.put("buffering", c.getPlaybackState() == Player.STATE_BUFFERING);
        o.put("index", c.getCurrentMediaItemIndex());
        o.put("count", c.getMediaItemCount());
        MediaItem cur = c.getCurrentMediaItem();
        o.put("mediaId", cur != null ? cur.mediaId : null);
        o.put("position", Math.max(0, c.getCurrentPosition()) / 1000.0);
        long d = c.getDuration();
        o.put("duration", d > 0 ? d / 1000.0 : 0);
        o.put("shuffle", c.getShuffleModeEnabled());
        o.put("repeat", c.getRepeatMode() == Player.REPEAT_MODE_ONE);
        o.put("volume", c.getVolume());
        if (c.getPlayerError() != null) o.put("error", c.getPlayerError().getMessage());
        return o;
    }

    private void emitState() { notifyListeners("state", state()); }

    private MediaItem toItem(JSONObject t) {
        String id = t.optString("id");
        String thumb = t.optString("thumbnail", "");
        File localThumb = Downloads.thumbFile(getContext(), id);
        Uri art = localThumb.exists() ? Uri.fromFile(localThumb) : (thumb.isEmpty() ? null : Uri.parse(thumb));
        Uri uri = Uri.parse("sonora://yt/" + id);
        MediaMetadata md = new MediaMetadata.Builder()
                .setTitle(t.optString("title"))
                .setArtist(t.optString("author"))
                .setAlbumTitle("Sonora")
                .setArtworkUri(art)
                .build();
        return new MediaItem.Builder()
                .setMediaId(id)
                .setUri(uri)
                .setMediaMetadata(md)
                .setRequestMetadata(new MediaItem.RequestMetadata.Builder().setMediaUri(uri).build())
                .build();
    }

    // ---------------- YouTube ----------------
    @PluginMethod
    public void search(PluginCall call) {
        String q = call.getString("query", "");
        int limit = call.getInt("limit", 25);
        boolean withPlaylists = Boolean.TRUE.equals(call.getBoolean("playlists", false));
        String pq = call.getString("playlistQuery", q);
        net.submit(() -> {
            try {
                Future<JSArray> pl = withPlaylists ? net.submit(() -> YtExtractor.searchPlaylists(pq, 6)) : null;
                JSObject r = new JSObject();
                r.put("tracks", YtExtractor.searchTracks(q, limit));
                if (pl != null) { try { r.put("playlists", pl.get()); } catch (Exception e) { r.put("playlists", new JSArray()); } }
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Falha na busca: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void playlist(PluginCall call) {
        String id = call.getString("id");
        net.submit(() -> {
            try { call.resolve(YtExtractor.getPlaylist(id)); }
            catch (Exception e) { call.reject("Não foi possível abrir a playlist: " + e.getMessage()); }
        });
    }

    // ---------------- Tocador ----------------
    @PluginMethod
    public void setQueue(PluginCall call) {
        JSArray items = call.getArray("items");
        int index = call.getInt("index", 0);
        double start = call.getDouble("position", 0.0);
        List<MediaItem> list = new ArrayList<>();
        try { for (int i = 0; i < items.length(); i++) list.add(toItem(items.getJSONObject(i))); }
        catch (Exception e) { call.reject("Fila inválida"); return; }
        withPlayer(call, c -> {
            c.setMediaItems(list, Math.max(0, Math.min(index, list.size() - 1)), (long) (start * 1000));
            c.prepare();
            c.play();
        });
    }

    @PluginMethod public void play(PluginCall call) { withPlayer(call, c -> { if (c.getPlaybackState() == Player.STATE_IDLE) c.prepare(); c.play(); }); }
    @PluginMethod public void pause(PluginCall call) { withPlayer(call, Player::pause); }
    @PluginMethod public void next(PluginCall call) { withPlayer(call, c -> { if (c.hasNextMediaItem()) c.seekToNextMediaItem(); }); }
    @PluginMethod public void previous(PluginCall call) { withPlayer(call, Player::seekToPrevious); }
    @PluginMethod public void skipTo(PluginCall call) { int i = call.getInt("index", 0); withPlayer(call, c -> { c.seekToDefaultPosition(i); c.play(); }); }
    @PluginMethod public void seek(PluginCall call) { double s = call.getDouble("position", 0.0); withPlayer(call, c -> c.seekTo((long) (s * 1000))); }
    @PluginMethod public void setShuffle(PluginCall call) { boolean v = Boolean.TRUE.equals(call.getBoolean("enabled", false)); withPlayer(call, c -> c.setShuffleModeEnabled(v)); }
    @PluginMethod public void setRepeat(PluginCall call) { boolean v = Boolean.TRUE.equals(call.getBoolean("enabled", false)); withPlayer(call, c -> c.setRepeatMode(v ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF)); }
    @PluginMethod public void setVolume(PluginCall call) { float v = call.getFloat("volume", 1f); withPlayer(call, c -> c.setVolume(v)); }

    @PluginMethod
    public void getState(PluginCall call) { main.post(() -> call.resolve(state())); }

    /** Fila atual do tocador nativo — usada para restaurar a interface quando o app é reaberto. */
    @PluginMethod
    public void getQueue(PluginCall call) {
        withPlayerResult(call, c -> {
            JSArray items = new JSArray();
            for (int i = 0; i < c.getMediaItemCount(); i++) {
                MediaItem it = c.getMediaItemAt(i);
                JSObject o = new JSObject();
                o.put("id", it.mediaId);
                o.put("title", it.mediaMetadata.title == null ? "" : it.mediaMetadata.title.toString());
                o.put("author", it.mediaMetadata.artist == null ? "" : it.mediaMetadata.artist.toString());
                o.put("thumbnail", YtExtractor.thumbFor(it.mediaId));
                o.put("duration", 0);
                items.put(o);
            }
            JSObject r = new JSObject();
            r.put("items", items);
            r.put("index", c.getCurrentMediaItemIndex());
            return r;
        });
    }

    private void withPlayerResult(PluginCall call, java.util.function.Function<MediaController, JSObject> fn) {
        main.post(() -> {
            Runnable r = () -> {
                try { call.resolve(fn.apply(controller)); } catch (Exception e) { call.reject(e.getMessage()); }
            };
            if (controller != null) r.run(); else pending.add(r);
        });
    }

    // ---------------- Qualidade ----------------
    @PluginMethod
    public void getSettings(PluginCall call) {
        JSObject o = new JSObject();
        o.put("quality", YtExtractor.getQuality());
        o.put("downloadsBytes", Downloads.totalBytes(getContext()));
        call.resolve(o);
    }
    @PluginMethod
    public void setQuality(PluginCall call) {
        YtExtractor.setQuality(call.getString("quality", "normal"));
        call.resolve();
    }

    // ---------------- Downloads ----------------
    @PluginMethod
    public void listDownloads(PluginCall call) {
        JSObject o = new JSObject();
        o.put("tracks", Downloads.list(getContext()));
        o.put("bytes", Downloads.totalBytes(getContext()));
        call.resolve(o);
    }

    @PluginMethod
    public void download(PluginCall call) {
        JSArray items = call.getArray("items");
        call.resolve(); // o progresso chega pelo evento "download"
        dl.submit(() -> {
            for (int i = 0; i < items.length(); i++) {
                JSObject t;
                try { t = JSObject.fromJSONObject(items.getJSONObject(i)); } catch (Exception e) { continue; }
                String id = t.getString("id");
                try {
                    Downloads.download(getContext(), t, (tid, f) -> {
                        JSObject ev = new JSObject();
                        ev.put("id", tid); ev.put("progress", f); ev.put("status", f >= 1 ? "done" : "downloading");
                        notifyListeners("download", ev);
                    });
                } catch (Exception e) {
                    JSObject ev = new JSObject();
                    ev.put("id", id); ev.put("status", "error"); ev.put("error", e.getMessage());
                    notifyListeners("download", ev);
                }
            }
        });
    }

    @PluginMethod
    public void removeDownload(PluginCall call) {
        try { Downloads.remove(getContext(), call.getString("id")); call.resolve(); }
        catch (Exception e) { call.reject(e.getMessage()); }
    }
}
