package com.sonora.player;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import org.schabi.newpipe.extractor.Image;
import org.schabi.newpipe.extractor.InfoItem;
import org.schabi.newpipe.extractor.ListExtractor;
import org.schabi.newpipe.extractor.NewPipe;
import org.schabi.newpipe.extractor.Page;
import org.schabi.newpipe.extractor.ServiceList;
import org.schabi.newpipe.extractor.localization.ContentCountry;
import org.schabi.newpipe.extractor.localization.Localization;
import org.schabi.newpipe.extractor.playlist.PlaylistInfo;
import org.schabi.newpipe.extractor.playlist.PlaylistInfoItem;
import org.schabi.newpipe.extractor.search.SearchInfo;
import org.schabi.newpipe.extractor.services.youtube.linkHandler.YoutubePlaylistLinkHandlerFactory;
import org.schabi.newpipe.extractor.services.youtube.linkHandler.YoutubeSearchQueryHandlerFactory;
import org.schabi.newpipe.extractor.services.youtube.linkHandler.YoutubeStreamLinkHandlerFactory;
import org.schabi.newpipe.extractor.stream.AudioStream;
import org.schabi.newpipe.extractor.stream.DeliveryMethod;
import org.schabi.newpipe.extractor.stream.StreamInfo;
import org.schabi.newpipe.extractor.stream.StreamInfoItem;
import org.schabi.newpipe.extractor.stream.StreamType;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;

/** Tudo que fala com o YouTube: busca, playlists e endereço do áudio. Roda direto no celular. */
public final class YtExtractor {
    private static OkHttpClient client;
    private static SharedPreferences prefs;
    private static volatile boolean ready = false;

    /** Endereços de áudio já resolvidos (expiram em algumas horas). */
    private static final Map<String, String[]> audioCache = new ConcurrentHashMap<>();

    private YtExtractor() {}

    public static synchronized void init(Context ctx) {
        if (ready) return;
        client = new OkHttpClient.Builder()
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .retryOnConnectionFailure(true)
                .build();
        prefs = ctx.getApplicationContext().getSharedPreferences("sonora", Context.MODE_PRIVATE);
        NewPipe.init(new NewPipeDownloader(client), new Localization("pt", "BR"), new ContentCountry("BR"));
        ready = true;
    }

    public static OkHttpClient client() { return client; }

    // ---------------- Qualidade ----------------
    /** low ≈ 50–70 kbps (economiza dados), normal ≈ 128 kbps, high = melhor disponível */
    public static String getQuality() { return prefs.getString("quality", "normal"); }
    public static void setQuality(String q) {
        prefs.edit().putString("quality", q).apply();
        audioCache.clear();
    }

    // ---------------- IDs ----------------
    public static String videoId(String url) {
        try { return YoutubeStreamLinkHandlerFactory.getInstance().getId(url); } catch (Exception e) { return null; }
    }
    public static String playlistId(String url) {
        try { return YoutubePlaylistLinkHandlerFactory.getInstance().getId(url); } catch (Exception e) { return null; }
    }
    public static String thumbFor(String id) { return "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg"; }

    private static String bestImage(List<Image> images) {
        if (images == null || images.isEmpty()) return null;
        Image best = Collections.max(images, Comparator.comparingInt(Image::getHeight));
        return best.getUrl();
    }

    // ---------------- Conversões para JSON ----------------
    static JSObject track(StreamInfoItem it) {
        String id = videoId(it.getUrl());
        if (id == null) return null;
        JSObject o = new JSObject();
        o.put("id", id);
        o.put("title", it.getName());
        o.put("author", it.getUploaderName() == null ? "" : it.getUploaderName());
        o.put("duration", Math.max(0, it.getDuration()));
        o.put("thumbnail", thumbFor(id));
        return o;
    }

    static JSObject playlist(PlaylistInfoItem it) {
        String id = playlistId(it.getUrl());
        if (id == null || id.startsWith("RD")) return null; // mixes automáticos não abrem
        JSObject o = new JSObject();
        boolean album = id.startsWith("OLAK5uy_") || it.getName().matches("(?i)^(album|álbum)\\s*[-–:].*");
        o.put("listId", id);
        o.put("kind", album ? "album" : "playlist");
        o.put("title", it.getName().replaceFirst("(?i)^(album|álbum)\\s*[-–:]\\s*", ""));
        String up = it.getUploaderName();
        o.put("author", up == null || up.matches("(?i).*(subscribers|inscritos).*") ? "" : up);
        o.put("count", Math.max(0, it.getStreamCount()));
        o.put("thumbnail", bestImage(it.getThumbnails()));
        return o;
    }

    // ---------------- Busca ----------------
    public static JSArray searchTracks(String query, int limit) throws Exception {
        SearchInfo info = SearchInfo.getInfo(ServiceList.YouTube,
                ServiceList.YouTube.getSearchQHFactory().fromQuery(query,
                        Collections.singletonList(YoutubeSearchQueryHandlerFactory.VIDEOS), ""));
        JSArray out = new JSArray();
        for (InfoItem it : info.getRelatedItems()) {
            if (!(it instanceof StreamInfoItem)) continue;
            StreamInfoItem s = (StreamInfoItem) it;
            if (s.getStreamType() == StreamType.LIVE_STREAM) continue;
            JSObject o = track(s);
            if (o != null) out.put(o);
            if (out.length() >= limit) break;
        }
        return out;
    }

    public static JSArray searchPlaylists(String query, int limit) throws Exception {
        SearchInfo info = SearchInfo.getInfo(ServiceList.YouTube,
                ServiceList.YouTube.getSearchQHFactory().fromQuery(query,
                        Collections.singletonList(YoutubeSearchQueryHandlerFactory.PLAYLISTS), ""));
        JSArray out = new JSArray();
        for (InfoItem it : info.getRelatedItems()) {
            if (!(it instanceof PlaylistInfoItem)) continue;
            JSObject o = playlist((PlaylistInfoItem) it);
            if (o != null) out.put(o);
            if (out.length() >= limit) break;
        }
        return out;
    }

    // ---------------- Playlist ----------------
    public static JSObject getPlaylist(String id) throws Exception {
        String url = "https://www.youtube.com/playlist?list=" + id;
        PlaylistInfo info = PlaylistInfo.getInfo(ServiceList.YouTube, url);
        JSArray tracks = new JSArray();
        List<StreamInfoItem> items = new ArrayList<>(info.getRelatedItems());
        Page next = info.getNextPage();
        while (next != null && items.size() < 300) {
            ListExtractor.InfoItemsPage<StreamInfoItem> page = PlaylistInfo.getMoreItems(ServiceList.YouTube, url, next);
            items.addAll(page.getItems());
            next = page.hasNextPage() ? page.getNextPage() : null;
        }
        for (StreamInfoItem s : items) {
            JSObject o = track(s);
            if (o != null && !o.getString("title", "").matches("(?i)^\\[(private|deleted|privado|excluído).*")) tracks.put(o);
        }
        JSObject o = new JSObject();
        String name = info.getName() == null ? "" : info.getName();
        o.put("listId", id);
        o.put("kind", id.startsWith("OLAK5uy_") ? "album" : "playlist");
        o.put("title", name.replaceFirst("(?i)^(album|álbum)\\s*[-–:]\\s*", ""));
        o.put("author", info.getUploaderName() == null ? "" : info.getUploaderName());
        o.put("thumbnail", tracks.length() > 0 ? tracks.getJSONObject(0).getString("thumbnail") : bestImage(info.getThumbnails()));
        o.put("tracks", tracks);
        return o;
    }

    // ---------------- Áudio ----------------
    /** Retorna {url, userAgent} do melhor áudio para a qualidade escolhida. Usa cache até expirar. */
    public static String[] resolveAudio(String id) throws IOException {
        String[] hit = audioCache.get(id);
        if (hit != null && Long.parseLong(hit[2]) > System.currentTimeMillis()) return hit;
        try {
            StreamInfo info = StreamInfo.getInfo(ServiceList.YouTube, "https://www.youtube.com/watch?v=" + id);
            List<AudioStream> list = new ArrayList<>();
            for (AudioStream a : info.getAudioStreams()) {
                if (a.getDeliveryMethod() == DeliveryMethod.PROGRESSIVE_HTTP && a.isUrl()) list.add(a);
            }
            if (list.isEmpty()) throw new IOException("Nenhum áudio disponível para este vídeo");
            // prefere a faixa de áudio original (sem dublagem)
            List<AudioStream> original = new ArrayList<>();
            for (AudioStream a : list) {
                if (a.getAudioTrackType() == null || a.getAudioTrackType().name().equals("ORIGINAL")) original.add(a);
            }
            if (!original.isEmpty()) list = original;
            list.sort(Comparator.comparingInt(AudioStream::getAverageBitrate));
            AudioStream pick;
            switch (getQuality()) {
                case "low": pick = list.get(0); break;
                case "high": pick = list.get(list.size() - 1); break;
                default: {
                    pick = list.get(0);
                    for (AudioStream a : list) if (Math.abs(a.getAverageBitrate() - 128) < Math.abs(pick.getAverageBitrate() - 128)) pick = a;
                }
            }
            String url = pick.getContent();
            long expire = System.currentTimeMillis() + 4L * 3600_000L;
            try {
                String e = Uri.parse(url).getQueryParameter("expire");
                if (e != null) expire = Long.parseLong(e) * 1000L - 10 * 60_000L;
            } catch (Exception ignored) {}
            String[] res = new String[]{url, userAgentFor(url), String.valueOf(expire)};
            audioCache.put(id, res);
            return res;
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            throw new IOException("Não foi possível obter o áudio: " + e.getMessage(), e);
        }
    }

    public static void invalidate(String id) { audioCache.remove(id); }

    /** Os links do YouTube exigem o User-Agent do "cliente" que os gerou (Android, iOS ou web). */
    static String userAgentFor(String url) {
        String c = null;
        try { c = Uri.parse(url).getQueryParameter("c"); } catch (Exception ignored) {}
        if (c == null) return NewPipeDownloader.USER_AGENT;
        switch (c) {
            case "ANDROID":
            case "ANDROID_MUSIC":
            case "ANDROID_VR":
                return "com.google.android.youtube/19.28.35 (Linux; U; Android 14; pt_BR) gzip";
            case "IOS":
                return "com.google.ios.youtube/19.28.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X; pt_BR)";
            default:
                return NewPipeDownloader.USER_AGENT;
        }
    }
}
