//! Measurement spike: parakeet-unified-en-0.6b buffered streaming on ONNX Runtime via parakeet-rs.
//!
//! Prints one `key=value` line per measurement so bench scripts can grep them.
//! All times are milliseconds since `main` started unless suffixed `_ms` as a duration.

use ort::ep::cuda::ConvAlgorithmSearch;
use ort::session::builder::GraphOptimizationLevel;
use parakeet_rs::{ExecutionConfig, ParakeetUnified, UnifiedStreamingConfig};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;

struct Options {
    model_dir: String,
    audio: Option<String>,
    provider: String,
    decoder_provider: String,
    chunk_frames: usize,
    right_frames: usize,
    feed_samples: usize,
    conv_search: String,
    opt_level: String,
    save_optimized: Option<String>,
    threads: usize,
    realtime: bool,
    quiet: bool,
    nc1d: Option<bool>,
    nhwc: Option<bool>,
    max_workspace: Option<bool>,
}

fn parse() -> Options {
    let mut o = Options {
        model_dir: String::new(),
        audio: None,
        provider: "cuda".into(),
        decoder_provider: "same".into(),
        chunk_frames: 7,
        right_frames: 7,
        feed_samples: 1600,
        conv_search: "default".into(),
        opt_level: "3".into(),
        save_optimized: None,
        threads: 4,
        realtime: false,
        quiet: false,
        nc1d: None,
        nhwc: None,
        max_workspace: None,
    };
    let mut args = std::env::args().skip(1);
    while let Some(key) = args.next() {
        let mut value = || args.next().unwrap_or_else(|| panic!("missing value for {key}"));
        match key.as_str() {
            "--model-dir" => o.model_dir = value(),
            "--audio" => o.audio = Some(value()),
            "--provider" => o.provider = value(),
            "--decoder-provider" => o.decoder_provider = value(),
            "--chunk-frames" => o.chunk_frames = value().parse().unwrap(),
            "--right-frames" => o.right_frames = value().parse().unwrap(),
            "--feed-ms" => o.feed_samples = value().parse::<usize>().unwrap() * 16,
            "--conv-search" => o.conv_search = value(),
            "--opt-level" => o.opt_level = value(),
            "--save-optimized" => o.save_optimized = Some(value()),
            "--threads" => o.threads = value().parse().unwrap(),
            "--realtime" => o.realtime = true,
            "--quiet" => o.quiet = true,
            "--nc1d" => o.nc1d = Some(value() == "1"),
            "--nhwc" => o.nhwc = Some(value() == "1"),
            "--max-workspace" => o.max_workspace = Some(value() == "1"),
            other => panic!("unknown argument {other}"),
        }
    }
    assert!(!o.model_dir.is_empty(), "--model-dir is required");
    o
}

fn read_wav(path: &str) -> Vec<f32> {
    let mut reader = hound::WavReader::open(path).expect("open wav");
    let spec = reader.spec();
    assert_eq!(spec.sample_rate, 16000, "expected 16 kHz");
    assert_eq!(spec.channels, 1, "expected mono");
    match spec.sample_format {
        hound::SampleFormat::Float => reader.samples::<f32>().map(|s| s.unwrap()).collect(),
        hound::SampleFormat::Int => reader.samples::<i16>().map(|s| s.unwrap() as f32 / 32768.0).collect(),
    }
}

fn main() {
    let start = Instant::now();
    let ms = move || start.elapsed().as_secs_f64() * 1000.0;
    let o = parse();

    // parakeet-rs builds the encoder session first, then the decoder, calling this closure for each.
    // Record when each call happens to split the load time, and use the call index to give the two
    // sessions different options.
    let calls = Arc::new(AtomicUsize::new(0));
    let stamps = Arc::new([AtomicU64::new(0), AtomicU64::new(0)]);
    let (provider, decoder_provider) = (
        o.provider.clone(),
        if o.decoder_provider == "same" { o.provider.clone() } else { o.decoder_provider.clone() },
    );
    let (conv_search, opt_level, save_optimized) = (o.conv_search.clone(), o.opt_level.clone(), o.save_optimized.clone());
    let (calls_in, stamps_in) = (calls.clone(), stamps.clone());
    let (nc1d, nhwc, max_workspace) = (o.nc1d, o.nhwc, o.max_workspace);
    let config = ExecutionConfig::new().with_intra_threads(o.threads).with_custom_configure(move |builder| {
        let index = calls_in.fetch_add(1, Ordering::SeqCst);
        stamps_in[index.min(1)].store(start.elapsed().as_micros() as u64, Ordering::SeqCst);
        let level = match opt_level.as_str() {
            "0" => GraphOptimizationLevel::Disable,
            "1" => GraphOptimizationLevel::Level1,
            "2" => GraphOptimizationLevel::Level2,
            _ => GraphOptimizationLevel::Level3,
        };
        let mut builder = builder.with_optimization_level(level)?;
        if let Ok(prefix) = std::env::var("SPIKE_PROFILE") {
            // ORT writes <prefix>-<encoder|decoder>_<timestamp>.json; see scripts/profile-summary.py.
            builder = builder.with_profiling(format!("{prefix}-{}", if index == 0 { "encoder" } else { "decoder" }))?;
        }
        if let (0, Some(directory)) = (index, save_optimized.as_ref()) {
            // Keep the 2.4 GB of weights in an external file next to the optimised graph.
            builder = builder
                .with_config_entry("session.optimized_model_external_initializers_file_name", "encoder.onnx.data")?
                .with_config_entry("session.optimized_model_external_initializers_min_size_in_bytes", "1024")?
                .with_optimized_model_path(format!("{directory}/encoder.onnx"))?;
        }
        let wanted = if index == 0 { &provider } else { &decoder_provider };
        if wanted == "cuda" {
            let search = match conv_search.as_str() {
                "exhaustive" => ConvAlgorithmSearch::Exhaustive,
                "heuristic" => ConvAlgorithmSearch::Heuristic,
                _ => ConvAlgorithmSearch::Default,
            };
            let mut cuda = ort::ep::CUDA::default().with_conv_algorithm_search(search);
            if let Some(enable) = nc1d {
                cuda = cuda.with_conv1d_pad_to_nc1d(enable);
            }
            if let Some(enable) = nhwc {
                cuda = cuda.with_prefer_nhwc(enable);
            }
            if let Some(enable) = max_workspace {
                cuda = cuda.with_conv_max_workspace(enable);
            }
            builder = builder.with_execution_providers([cuda.build().error_on_failure()])?;
        }
        Ok(builder)
    });

    let streaming = UnifiedStreamingConfig {
        left_context_secs: 5.6,
        chunk_secs: o.chunk_frames as f32 * 0.08,
        right_context_secs: o.right_frames as f32 * 0.08,
    };
    let before_load = ms();
    let mut model = ParakeetUnified::from_pretrained_with_streaming_config(&o.model_dir, Some(config), streaming)
        .expect("load model");
    let loaded = ms();
    let encoder_start = stamps[0].load(Ordering::SeqCst) as f64 / 1000.0;
    let decoder_start = stamps[1].load(Ordering::SeqCst) as f64 / 1000.0;
    println!("startup_before_load_ms={before_load:.0}");
    println!("encoder_session_ms={:.0}", decoder_start - encoder_start);
    println!("decoder_session_ms={:.0}", loaded - decoder_start);
    println!("loaded_at_ms={loaded:.0}");

    // Same warm-up as server.py: one full [left|chunk|right] window of silence, then reset. After this
    // the process can transcribe, so this is the cold-start number that matters.
    let chunk = streaming.chunk_samples();
    let right = streaming.right_context_samples();
    let warm_start = ms();
    let silence = vec![0.0f32; streaming.total_window_samples()];
    model.transcribe_chunk(&silence[..chunk + right]).expect("warmup");
    let first_window = ms();
    if std::env::var("SPIKE_FULL_WARMUP").is_ok() {
        // server.py warms a whole 5.6 s window; that walks through every growing window shape.
        model.transcribe_chunk(&silence[chunk + right..]).expect("warmup");
    }
    model.flush().expect("warmup flush");
    model.reset();
    println!("first_window_ms={:.0}", first_window - warm_start);
    println!("warmup_ms={:.0}", ms() - warm_start);
    println!("ready_at_ms={:.0}", ms());
    // Monotonic stamp (/proc/uptime, 10 ms resolution) so coldstart.sh can measure from before exec().
    let uptime = std::fs::read_to_string("/proc/uptime").unwrap_or_default();
    println!("ready_uptime_s={}", uptime.split(' ').next().unwrap_or(""));

    let Some(audio_path) = o.audio.as_ref() else { return };
    let audio = read_wav(audio_path);
    println!("audio_seconds={:.2}", audio.len() as f64 / 16000.0);

    // Feed in client-frame-sized pieces. A piece triggers inference only when it completes a chunk,
    // exactly like the WebSocket server would see it.
    let stream_start = Instant::now();
    let mut received = 0usize;
    let mut next_chunk_start = 0usize;
    let mut times = Vec::new();
    let mut previous = String::new();
    for piece in audio.chunks(o.feed_samples) {
        if o.realtime {
            let due = std::time::Duration::from_secs_f64((received + piece.len()) as f64 / 16000.0);
            std::thread::sleep(due.saturating_sub(stream_start.elapsed()));
        }
        received += piece.len();
        let call = Instant::now();
        model.transcribe_chunk(piece).expect("transcribe");
        let took = call.elapsed().as_secs_f64() * 1000.0;
        let mut ran = 0;
        while received >= next_chunk_start + chunk + right {
            next_chunk_start += chunk;
            ran += 1;
        }
        if ran > 0 {
            times.push(took / ran as f64);
            let partial = model.get_transcript();
            if !o.quiet && partial != previous {
                println!("partial@{:.2}s [{took:.1}ms] {partial}", received as f64 / 16000.0);
            }
            previous = partial;
        }
    }
    // server.py appends 400 ms of silence before the final flush.
    let call = Instant::now();
    model.transcribe_chunk(&vec![0.0f32; 6400]).expect("tail");
    model.flush().expect("flush");
    println!("finish_ms={:.1}", call.elapsed().as_secs_f64() * 1000.0);
    println!("final={}", model.get_transcript());

    let mut sorted = times.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mean = times.iter().sum::<f64>() / times.len() as f64;
    println!("chunks={}", times.len());
    println!("chunk_first_ms={:.1}", times[0]);
    println!("chunk_mean_ms={mean:.1}");
    println!("chunk_median_ms={:.1}", sorted[sorted.len() / 2]);
    println!("chunk_max_ms={:.1}", sorted[sorted.len() - 1]);
    println!("chunk_times_ms={}", times.iter().map(|t| format!("{t:.0}")).collect::<Vec<_>>().join(","));
    // Second pass over the same audio: all window shapes are now cached by cuDNN.
    model.reset();
    let mut second = Vec::new();
    let mut received = 0usize;
    let mut next_chunk_start = 0usize;
    for piece in audio.chunks(o.feed_samples) {
        received += piece.len();
        let call = Instant::now();
        model.transcribe_chunk(piece).expect("transcribe");
        let took = call.elapsed().as_secs_f64() * 1000.0;
        let mut ran = 0;
        while received >= next_chunk_start + chunk + right {
            next_chunk_start += chunk;
            ran += 1;
        }
        if ran > 0 {
            second.push(took / ran as f64);
        }
    }
    second.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!("second_pass_chunk_median_ms={:.1}", second[second.len() / 2]);
    println!("second_pass_chunk_max_ms={:.1}", second[second.len() - 1]);
    if let Ok(status) = std::fs::read_to_string("/proc/self/status") {
        for line in status.lines().filter(|l| l.starts_with("VmRSS") || l.starts_with("VmHWM")) {
            println!("{}", line.replace(":\t", "=").replace(' ', ""));
        }
    }
    if o.provider == "cuda" {
        // Leave the process alive briefly so a wrapper can sample nvidia-smi per-process memory.
        if let Ok(hold) = std::env::var("SPIKE_HOLD_MS") {
            println!("holding");
            std::thread::sleep(std::time::Duration::from_millis(hold.parse().unwrap_or(0)));
        }
    }
}
