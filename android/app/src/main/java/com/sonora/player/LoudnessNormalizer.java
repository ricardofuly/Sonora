package com.sonora.player;

import androidx.annotation.NonNull;
import androidx.media3.common.C;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.audio.BaseAudioProcessor;
import androidx.media3.common.util.UnstableApi;

import java.nio.ByteBuffer;

/**
 * Normalização de volume: deixa todas as músicas com volume parecido (alvo ≈ -14 LUFS, o mesmo do
 * Spotify/YouTube). Mede a sonoridade percebida (filtro K da norma EBU R128) e ajusta o ganho devagar,
 * para não "bombear"; um limitador evita distorção quando uma música baixa precisa ser aumentada.
 * Funciona para streaming e downloads, porque atua no áudio já decodificado.
 */
@UnstableApi
public final class LoudnessNormalizer extends BaseAudioProcessor {
    private static final double TARGET_LUFS = -14;
    private static final double MAX_BOOST_DB = 10, MAX_CUT_DB = -15;
    private static final double BLOCK_S = 0.1;           // mede em blocos de 100 ms
    private static final double TAU_S = 4, TAU_WARMUP_S = 1;
    private static final double WARMUP_S = 3;            // início da música: adapta mais rápido
    private static final double LIMIT = 0.89;            // ≈ -1 dBFS
    private static final double SILENCE_LUFS = -50;

    private static volatile boolean enabled = true;
    private static volatile boolean newTrack = false;

    public static void setEnabled(boolean v) { enabled = v; }
    public static boolean isEnabled() { return enabled; }
    /** Chamado na troca de música: reaprende o volume mais rápido. */
    public static void onNewTrack() { newTrack = true; }

    private int channels, encoding, blockFrames;
    private double sampleRate;
    // filtros K (2 estágios biquad) por canal
    private double[] sb, sa, hb, ha;
    private double[][] z;
    private double blockEnergy;
    private int blockCount;
    private double energy = Math.pow(10, (TARGET_LUFS + 0.691) / 10); // começa sem ganho
    private double gainDb = 0, curGain = 1, nextGain = 1, limiter = 1, limRelease;
    private double warmupLeft = WARMUP_S;
    private double[] frame;

    @NonNull @Override
    protected AudioFormat onConfigure(@NonNull AudioFormat in) throws UnhandledAudioFormatException {
        if (in.encoding != C.ENCODING_PCM_16BIT && in.encoding != C.ENCODING_PCM_FLOAT)
            throw new UnhandledAudioFormatException(in);
        channels = in.channelCount;
        encoding = in.encoding;
        sampleRate = in.sampleRate;
        blockFrames = Math.max(1, (int) (sampleRate * BLOCK_S));
        frame = new double[channels];
        z = new double[channels][4];
        limRelease = 1 - Math.exp(-1 / (0.15 * sampleRate));
        designKFilter();
        return in;
    }

    private void designKFilter() {
        double fs = sampleRate;
        // estágio 1: shelving de alta frequência
        double f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
        double K = Math.tan(Math.PI * f0 / fs), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
        double a0 = 1 + K / Q + K * K;
        sb = new double[]{(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0};
        sa = new double[]{2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0};
        // estágio 2: passa-altas (RLB)
        f0 = 38.13547087602444; Q = 0.5003270373238773;
        K = Math.tan(Math.PI * f0 / fs);
        a0 = 1 + K / Q + K * K;
        hb = new double[]{1, -2, 1};
        ha = new double[]{2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0};
    }

    private double kWeight(int ch, double x) {
        double[] s = z[ch];
        // Direct Form II transposto
        double y1 = sb[0] * x + s[0];
        s[0] = sb[1] * x - sa[0] * y1 + s[1];
        s[1] = sb[2] * x - sa[1] * y1;
        double y2 = hb[0] * y1 + s[2];
        s[2] = hb[1] * y1 - ha[0] * y2 + s[3];
        s[3] = hb[2] * y1 - ha[1] * y2;
        return y2;
    }

    @Override
    public void queueInput(@NonNull ByteBuffer input) {
        int pos = input.position(), limit = input.limit();
        int size = limit - pos;
        if (size == 0) return;
        ByteBuffer out = replaceOutputBuffer(size);
        boolean on = enabled;

        // desligado e já sem ganho: só copia
        if (!on && curGain == 1 && nextGain == 1 && limiter == 1) {
            out.put(input);
            out.flip();
            return;
        }
        if (newTrack) { newTrack = false; warmupLeft = WARMUP_S; }

        boolean f32 = encoding == C.ENCODING_PCM_FLOAT;
        int bytes = f32 ? 4 : 2;
        int frames = size / (bytes * channels);
        for (int i = 0; i < frames; i++) {
            // ganho interpolado dentro do bloco, sem degraus audíveis
            double g = curGain + (nextGain - curGain) * blockCount / blockFrames;
            double peak = 0;
            for (int c = 0; c < channels; c++) {
                double x = f32 ? input.getFloat() : input.getShort() / 32768.0;
                double k = kWeight(c, x);
                blockEnergy += k * k;
                double y = x * g;
                frame[c] = y;
                double a = Math.abs(y);
                if (a > peak) peak = a;
            }
            // limitador: ataque imediato, recuperação em ~150 ms
            if (on || limiter < 1) {
                if (peak * limiter > LIMIT) limiter = LIMIT / peak;
                else limiter += (1 - limiter) * limRelease;
                if (limiter > 0.99999) limiter = 1;
            }
            for (int c = 0; c < channels; c++) {
                double y = frame[c] * limiter;
                if (f32) out.putFloat((float) y);
                else out.putShort((short) Math.max(-32768, Math.min(32767, Math.round(y * 32768))));
            }
            if (++blockCount >= blockFrames) endBlock(on);
        }
        input.position(limit);
        out.flip();
    }

    private void endBlock(boolean on) {
        double z = blockEnergy / blockFrames; // soma dos canais (pesos 1 para L/R)
        blockEnergy = 0;
        blockCount = 0;
        double blockLufs = -0.691 + 10 * Math.log10(z + 1e-12);
        double est = -0.691 + 10 * Math.log10(energy);
        boolean warm = warmupLeft > 0;
        // ignora silêncio e trechos muito baixos (fade, pausas) para não aumentar o ruído
        // no início da música não usa o gate relativo: ela pode ser bem mais baixa que a anterior
        if (blockLufs > SILENCE_LUFS && (warm || blockLufs > est - 20)) {
            double tau = warm ? TAU_WARMUP_S : TAU_S;
            energy += (1 - Math.exp(-BLOCK_S / tau)) * (z - energy);
            est = -0.691 + 10 * Math.log10(energy);
        }
        if (warm) warmupLeft -= BLOCK_S;

        double desired = on ? Math.max(MAX_CUT_DB, Math.min(MAX_BOOST_DB, TARGET_LUFS - est)) : 0;
        // velocidade máxima de mudança (dB/s): baixar é mais rápido que aumentar
        double up = (warm ? 6 : 1) * BLOCK_S, down = (warm ? 12 : 4) * BLOCK_S;
        if (!on) up = down = 12 * BLOCK_S;
        gainDb += Math.max(-down, Math.min(up, desired - gainDb));
        if (!on && Math.abs(gainDb) < 0.05) gainDb = 0;
        curGain = nextGain;
        nextGain = gainDb == 0 ? 1 : Math.pow(10, gainDb / 20);
    }

    @Override
    protected void onFlush() {
        // seek ou troca de formato: zera os filtros, mantém o volume aprendido
        if (z != null) for (double[] s : z) java.util.Arrays.fill(s, 0);
        blockEnergy = 0;
        blockCount = 0;
        curGain = nextGain;
    }

    @Override
    protected void onReset() {
        gainDb = 0; curGain = nextGain = limiter = 1;
        energy = Math.pow(10, (TARGET_LUFS + 0.691) / 10);
        warmupLeft = WARMUP_S;
    }
}
