// Measurement spike: parakeet-unified-en-0.6b buffered streaming on transcribe.cpp (ggml) through the
// public C ABI, linked against the prebuilt v0.3.1 CUDA release. Same output format as ort-spike.
//
// usage: tcpp-spike --libdir DIR --model X.gguf [--audio X.wav] [--backend cuda|cpu|vulkan]
//                   [--chunk-ms 560] [--right-ms 560] [--feed-ms 100] [--threads N] [--realtime] [--quiet]

#include "transcribe.h"
#include "transcribe/parakeet.h"

#define DR_WAV_IMPLEMENTATION
#include "dr_wav.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static double now_ms(void) {
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return t.tv_sec * 1000.0 + t.tv_nsec / 1e6;
}

static void check(transcribe_status status, const char * what) {
    if (status != TRANSCRIBE_OK) {
        fprintf(stderr, "error: %s: %s\n", what, transcribe_status_string(status));
        exit(1);
    }
}

static int compare(const void * a, const void * b) {
    double d = *(const double *) a - *(const double *) b;
    return d < 0 ? -1 : d > 0;
}

static void begin(struct transcribe_session * session, int chunk_ms, int right_ms) {
    struct transcribe_parakeet_buffered_stream_ext ext;
    transcribe_parakeet_buffered_stream_ext_init(&ext);
    ext.left_ms  = 5600;
    ext.chunk_ms = chunk_ms;
    ext.right_ms = right_ms;
    struct transcribe_stream_params params;
    transcribe_stream_params_init(&params);
    params.family = &ext.ext;
    check(transcribe_stream_begin(session, NULL, &params), "stream_begin");
}

// Feeds `pcm` in `feed` sized pieces; records the duration of every feed that changed the result.
// With `realtime`, each piece is delivered when a microphone would have produced it.
static int stream(struct transcribe_session * session, const float * pcm, int n, int feed, double * times, int quiet,
                  int realtime) {
    int    count = 0;
    char * last  = strdup("");
    double begun = now_ms();
    for (int pos = 0; pos < n; pos += feed) {
        int take = pos + feed > n ? n - pos : feed;
        if (realtime) {
            double wait = (pos + take) / 16.0 - (now_ms() - begun);
            if (wait > 0) usleep((useconds_t) (wait * 1000));
        }
        struct transcribe_stream_update update;
        transcribe_stream_update_init(&update);
        double start = now_ms();
        check(transcribe_stream_feed(session, pcm + pos, take, &update), "stream_feed");
        double took = now_ms() - start;
        // A feed that ran the encoder is far above a pure buffering feed (~0.01 ms).
        if (took > 2.0) {
            times[count++] = took;
        }
        const char * text = transcribe_full_text(session);
        if (!quiet && strcmp(text, last) != 0) {
            printf("partial@%.2fs [%.1fms] %s\n", (pos + take) / 16000.0, took, text);
        }
        if (strcmp(text, last) != 0) {
            free(last);
            last = strdup(text);
        }
    }
    free(last);
    return count;
}

int main(int argc, char ** argv) {
    double       start = now_ms();
    const char * libdir = NULL, *model_path = NULL, *audio = NULL, *backend = "cuda";
    int          chunk_ms = 560, right_ms = 560, feed_ms = 100, threads = 0, quiet = 0, realtime = 0;
    for (int i = 1; i < argc; ++i) {
        const char * key = argv[i];
        if (!strcmp(key, "--quiet")) {
            quiet = 1;
            continue;
        }
        if (!strcmp(key, "--realtime")) {
            realtime = 1;
            continue;
        }
        const char * value = i + 1 < argc ? argv[++i] : "";
        if (!strcmp(key, "--libdir")) libdir = value;
        else if (!strcmp(key, "--model")) model_path = value;
        else if (!strcmp(key, "--audio")) audio = value;
        else if (!strcmp(key, "--backend")) backend = value;
        else if (!strcmp(key, "--chunk-ms")) chunk_ms = atoi(value);
        else if (!strcmp(key, "--right-ms")) right_ms = atoi(value);
        else if (!strcmp(key, "--feed-ms")) feed_ms = atoi(value);
        else if (!strcmp(key, "--threads")) threads = atoi(value);
        else {
            fprintf(stderr, "unknown argument %s\n", key);
            return 2;
        }
    }
    if (!libdir || !model_path) {
        fprintf(stderr, "--libdir and --model are required\n");
        return 2;
    }

    // Only register the backend under test: registering Vulkan as well costs driver init time.
    struct transcribe_backend_init_params init;
    transcribe_backend_init_params_init(&init);
    init.artifact_dir     = libdir;
    init.allowed_backends = TRANSCRIBE_BACKEND_MASK_CPU;
    struct transcribe_model_load_params load;
    transcribe_model_load_params_init(&load);
    load.backend = TRANSCRIBE_BACKEND_CPU;
    if (!strcmp(backend, "cuda")) {
        init.allowed_backends |= TRANSCRIBE_BACKEND_MASK_CUDA;
        load.backend = TRANSCRIBE_BACKEND_CUDA;
    } else if (!strcmp(backend, "vulkan")) {
        init.allowed_backends |= TRANSCRIBE_BACKEND_MASK_VULKAN;
        load.backend = TRANSCRIBE_BACKEND_VULKAN;
    }
    check(transcribe_init_backends_ex(&init), "init_backends");
    double backends_done = now_ms();

    struct transcribe_model * model = NULL;
    check(transcribe_model_load_file(model_path, &load, &model), "model_load_file");
    double model_done = now_ms();

    struct transcribe_session_params session_params;
    transcribe_session_params_init(&session_params);
    session_params.n_threads = threads;
    struct transcribe_session * session = NULL;
    check(transcribe_session_init(model, &session_params, &session), "session_init");
    double loaded = now_ms();
    printf("version=%s backend=%s\n", transcribe_version(), transcribe_model_backend(model));
    printf("backend_init_ms=%.0f\n", backends_done - start);
    printf("model_load_ms=%.0f\n", model_done - backends_done);
    printf("session_init_ms=%.0f\n", loaded - model_done);
    printf("loaded_at_ms=%.0f\n", loaded - start);

    // Warm-up, same as server.py: one full [left|chunk|right] window of silence.
    int     window  = (5600 + chunk_ms + right_ms) * 16;
    float * silence = calloc(window, sizeof(float));
    double  warm    = now_ms();
    begin(session, chunk_ms, right_ms);
    check(transcribe_stream_feed(session, silence, (chunk_ms + right_ms) * 16, NULL), "warmup feed");
    printf("first_window_ms=%.0f\n", now_ms() - warm);
    if (getenv("SPIKE_FULL_WARMUP")) {
        // server.py warms a whole 5.6 s window; that walks through every growing window shape.
        check(transcribe_stream_feed(session, silence + (chunk_ms + right_ms) * 16, 5600 * 16, NULL), "warmup feed");
    }
    check(transcribe_stream_finalize(session, NULL), "warmup finalize");
    transcribe_stream_reset(session);
    printf("warmup_ms=%.0f\n", now_ms() - warm);
    printf("ready_at_ms=%.0f\n", now_ms() - start);
    // Monotonic stamp (/proc/uptime, 10 ms resolution) so coldstart.sh can measure from before exec().
    char   uptime[64] = "";
    FILE * up         = fopen("/proc/uptime", "r");
    if (up && fscanf(up, "%63s", uptime) == 1) {
        printf("ready_uptime_s=%s\n", uptime);
    }
    if (up) fclose(up);
    fflush(stdout);
    if (!audio) {
        return 0;
    }

    unsigned int channels = 0, rate = 0;
    drwav_uint64 frames = 0;
    float *      pcm    = drwav_open_file_and_read_pcm_frames_f32(audio, &channels, &rate, &frames, NULL);
    if (!pcm || rate != 16000 || channels != 1) {
        fprintf(stderr, "error: need 16 kHz mono wav\n");
        return 1;
    }
    int n = (int) frames;
    printf("audio_seconds=%.2f\n", n / 16000.0);

    double * times = calloc(n / (feed_ms * 16) + 16, sizeof(double));
    begin(session, chunk_ms, right_ms);
    int    count = stream(session, pcm, n, feed_ms * 16, times, quiet, realtime);
    double fin   = now_ms();
    check(transcribe_stream_finalize(session, NULL), "finalize");
    printf("finish_ms=%.1f\n", now_ms() - fin);
    printf("final=%s\n", transcribe_full_text(session));
    transcribe_print_timings(session);

    double sum = 0;
    printf("chunks=%d\nchunk_first_ms=%.1f\nchunk_times_ms=", count, times[0]);
    for (int i = 0; i < count; ++i) {
        sum += times[i];
        printf("%s%.0f", i ? "," : "", times[i]);
    }
    qsort(times, count, sizeof(double), compare);
    printf("\nchunk_mean_ms=%.1f\nchunk_median_ms=%.1f\nchunk_max_ms=%.1f\n", sum / count, times[count / 2],
           times[count - 1]);

    // Second pass over the same audio with everything warm.
    transcribe_stream_reset(session);
    begin(session, chunk_ms, right_ms);
    count = stream(session, pcm, n, feed_ms * 16, times, 1, 0);
    check(transcribe_stream_finalize(session, NULL), "finalize");
    qsort(times, count, sizeof(double), compare);
    printf("second_pass_chunk_median_ms=%.1f\nsecond_pass_chunk_max_ms=%.1f\n", times[count / 2], times[count - 1]);

    FILE * status = fopen("/proc/self/status", "r");
    char   line[256];
    while (status && fgets(line, sizeof line, status)) {
        if (!strncmp(line, "VmHWM", 5) || !strncmp(line, "VmRSS", 5)) {
            fputs(line, stdout);
        }
    }
    const char * hold = getenv("SPIKE_HOLD_MS");
    if (hold) {
        printf("holding\n");
        fflush(stdout);
        usleep(atoi(hold) * 1000);
    }
    return 0;
}
