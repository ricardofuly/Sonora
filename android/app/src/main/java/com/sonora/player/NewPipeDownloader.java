package com.sonora.player;

import androidx.annotation.NonNull;

import org.schabi.newpipe.extractor.downloader.Downloader;
import org.schabi.newpipe.extractor.downloader.Request;
import org.schabi.newpipe.extractor.downloader.Response;
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException;

import java.io.IOException;
import java.util.List;
import java.util.Map;

import okhttp3.OkHttpClient;
import okhttp3.RequestBody;
import okhttp3.ResponseBody;

/** Ponte HTTP (OkHttp) usada pelo NewPipeExtractor para falar com o YouTube. */
public final class NewPipeDownloader extends Downloader {
    public static final String USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0";

    private final OkHttpClient client;

    public NewPipeDownloader(OkHttpClient client) {
        this.client = client;
    }

    @Override
    public Response execute(@NonNull Request request) throws IOException, ReCaptchaException {
        final String method = request.httpMethod();
        final byte[] data = request.dataToSend();
        RequestBody body = null;
        if (data != null) body = RequestBody.create(data);
        else if ("POST".equals(method)) body = RequestBody.create(new byte[0]);

        okhttp3.Request.Builder rb = new okhttp3.Request.Builder()
                .method(method, body)
                .url(request.url())
                .addHeader("User-Agent", USER_AGENT);

        for (Map.Entry<String, List<String>> h : request.headers().entrySet()) {
            rb.removeHeader(h.getKey());
            for (String v : h.getValue()) rb.addHeader(h.getKey(), v);
        }

        try (okhttp3.Response res = client.newCall(rb.build()).execute()) {
            if (res.code() == 429) {
                throw new ReCaptchaException("O YouTube pediu verificação (muitas requisições)", request.url());
            }
            ResponseBody rbody = res.body();
            String text = rbody != null ? rbody.string() : null;
            return new Response(res.code(), res.message(), res.headers().toMultimap(), text,
                    res.request().url().toString());
        }
    }
}
