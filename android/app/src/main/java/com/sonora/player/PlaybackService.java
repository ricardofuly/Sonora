package com.sonora.player;

import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.ResolvingDataSource;
import androidx.media3.datasource.okhttp.OkHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Serviço de reprodução em primeiro plano.
 * A MediaSession é o que permite controlar a música por: notificação, tela de bloqueio,
 * fones Bluetooth/com fio (play/pause/próxima), Galaxy Fit/Watch e Android Auto.
 * A fila fica aqui (e não no JavaScript), então "próxima" funciona mesmo com o app suspenso.
 */
@UnstableApi
public class PlaybackService extends MediaSessionService {
    private MediaSession session;

    @Override
    public void onCreate() {
        super.onCreate();
        YtExtractor.init(this);

        // Cada requisição usa o User-Agent do cliente que gerou o link do YouTube
        DataSource.Factory http = () -> {
            OkHttpDataSource.Factory f = new OkHttpDataSource.Factory(YtExtractor.client());
            return f.createDataSource();
        };
        DataSource.Factory upstream = new DefaultDataSource.Factory(this, http);

        // "sonora://yt/<id>" vira o arquivo baixado (offline) ou o link real do áudio, na hora de tocar
        DataSource.Factory resolving = new ResolvingDataSource.Factory(upstream, new ResolvingDataSource.Resolver() {
            @NonNull @Override
            public DataSpec resolveDataSpec(@NonNull DataSpec spec) throws java.io.IOException {
                Uri u = spec.uri;
                if (!"sonora".equals(u.getScheme())) return spec;
                String id = u.getLastPathSegment();
                File f = Downloads.audioFile(PlaybackService.this, id);
                if (f.exists()) return spec.withUri(Uri.fromFile(f));
                String[] a = YtExtractor.resolveAudio(id);
                java.util.Map<String, String> headers = new java.util.HashMap<>(spec.httpRequestHeaders);
                headers.put("User-Agent", a[1]);
                return spec.buildUpon().setUri(Uri.parse(a[0])).setHttpRequestHeaders(headers).build();
            }
        });

        // Buffer maior: aguenta melhor quedas rápidas de sinal durante corrida/caminhada
        DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(30_000, 180_000, 2_000, 4_000)
                .build();

        ExoPlayer player = new ExoPlayer.Builder(this)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(resolving))
                .setLoadControl(loadControl)
                .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(C.USAGE_MEDIA)
                        .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                        .build(), /* gerencia foco de áudio: pausa em ligações e outros apps */ true)
                .setHandleAudioBecomingNoisy(true) // pausa se o fone desconectar
                .setWakeMode(C.WAKE_MODE_NETWORK)   // mantém CPU e Wi-Fi/dados ativos com a tela apagada
                .build();

        player.addListener(new androidx.media3.common.Player.Listener() {
            @Override
            public void onPlayerError(@NonNull androidx.media3.common.PlaybackException error) {
                // link expirado ou falha: tenta de novo resolvendo o link outra vez, senão pula
                MediaItem cur = player.getCurrentMediaItem();
                if (cur != null) YtExtractor.invalidate(cur.mediaId);
                if (player.hasNextMediaItem()) { player.seekToNextMediaItem(); player.prepare(); player.play(); }
            }
        });

        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        session = new MediaSession.Builder(this, player)
                .setSessionActivity(pi)
                .setCallback(new MediaSession.Callback() {
                    // O controlador não envia a URI por segurança; reconstruímos a partir do requestMetadata
                    @NonNull @Override
                    public ListenableFuture<List<MediaItem>> onAddMediaItems(@NonNull MediaSession s,
                            @NonNull MediaSession.ControllerInfo c, @NonNull List<MediaItem> items) {
                        List<MediaItem> out = new ArrayList<>();
                        for (MediaItem it : items) {
                            Uri uri = it.requestMetadata.mediaUri != null ? it.requestMetadata.mediaUri
                                    : Uri.parse("sonora://yt/" + it.mediaId);
                            out.add(it.buildUpon().setUri(uri).build());
                        }
                        return Futures.immediateFuture(out);
                    }
                })
                .build();
    }

    @Nullable @Override
    public MediaSession onGetSession(@NonNull MediaSession.ControllerInfo controllerInfo) {
        return session;
    }

    @Override
    public void onTaskRemoved(@Nullable Intent rootIntent) {
        // fechou o app pelos recentes: se não estiver tocando, encerra o serviço
        if (session != null) {
            ExoPlayer p = (ExoPlayer) session.getPlayer();
            if (!p.getPlayWhenReady() || p.getMediaItemCount() == 0) stopSelf();
        }
    }

    @Override
    public void onDestroy() {
        if (session != null) {
            session.getPlayer().release();
            session.release();
            session = null;
        }
        super.onDestroy();
    }
}
