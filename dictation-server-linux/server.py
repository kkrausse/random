"""Loopback streaming dictation service, protocol v1 (../dictation-server/docs/protocol.md).

Linux/NVIDIA port of the Swift service: transcribe.cpp (ggml) on its Vulkan
backend running parakeet-unified-en-0.6b in buffered streaming mode, called
through the library's C ABI with ctypes. Recording and decoder semantics mirror
Recording.swift and Decoder.swift.
"""

import ctypes
import json
import math
import os
import re
import sys
import time
import uuid
from array import array
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

MODEL = "parakeet-unified-en-0.6b"
WEIGHTS = f"{MODEL}-F16.gguf"
# The C ABI is only stable within a release; setup.sh downloads exactly this one.
LIBRARY_VERSION = "0.3.1"
CACHE = Path(__file__).parent / ".cache"
FRAME_LIMIT = 6_400
QUEUE_LIMIT = 128_000
SECONDS_LIMIT = 300
OUTGOING_LIMIT = 255_488
AUDIO_FORMAT = {"sampleRate": 16000, "channels": 1, "format": "f32le"}
# Latency ms -> (chunk ms, right ms). Left context is always 5.6 s, as in training.
# The model's shorter settings (480, 320 ms) run but lose punctuation and
# capitalisation, and transcribe.cpp rejects NeMo's 560 ms (70, 2, 5).
LATENCIES = {2080: (1040, 1040), 1120: (560, 560)}
LEFT_MS = 5600
UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


class ProtocolFailure(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def log(message):
    print(message, file=sys.stderr, flush=True)


# --- Model -----------------------------------------------------------------
# transcribe.h and transcribe/parakeet.h at v0.3.1. Every struct with a size
# query is checked against the loaded library, so a mismatched release fails at
# load instead of corrupting memory.

class Ext(ctypes.Structure):
    _fields_ = [("size", ctypes.c_uint64), ("kind", ctypes.c_uint32)]


class BufferedStreamExt(ctypes.Structure):
    _fields_ = [("ext", Ext), ("left_ms", ctypes.c_int32), ("chunk_ms", ctypes.c_int32), ("right_ms", ctypes.c_int32)]


class BackendInitParams(ctypes.Structure):
    _fields_ = [("struct_size", ctypes.c_uint64), ("artifact_dir", ctypes.c_char_p), ("allowed_backends", ctypes.c_uint32)]


class ModelLoadParams(ctypes.Structure):
    _fields_ = [("struct_size", ctypes.c_uint64), ("backend", ctypes.c_int), ("device", ctypes.c_void_p)]


class SessionParams(ctypes.Structure):
    _fields_ = [("struct_size", ctypes.c_uint64), ("n_threads", ctypes.c_int), ("kv_type", ctypes.c_int),
                ("n_ctx", ctypes.c_int32)]


class StreamParams(ctypes.Structure):
    _fields_ = [("struct_size", ctypes.c_uint64), ("family", ctypes.POINTER(Ext)), ("commit_policy", ctypes.c_int),
                ("stable_prefix_agreement_n", ctypes.c_uint32)]


class StreamUpdate(ctypes.Structure):
    _fields_ = [("struct_size", ctypes.c_uint64), ("result_changed", ctypes.c_bool), ("is_final", ctypes.c_bool),
                ("revision", ctypes.c_int32), ("input_received_ms", ctypes.c_int64),
                ("audio_committed_ms", ctypes.c_int64), ("buffered_ms", ctypes.c_int64),
                ("committed_changed", ctypes.c_bool), ("tentative_changed", ctypes.c_bool)]


# transcribe_abi_struct ids.
ABI_STRUCTS = {ModelLoadParams: 0, SessionParams: 1, StreamParams: 3, StreamUpdate: 9, Ext: 12, BackendInitParams: 15}
BACKEND_VULKAN = 3
BACKEND_MASK_CPU = 1
BACKEND_MASK_VULKAN = 4


def load_library(directory):
    path = directory / "libtranscribe.so"
    if not path.is_file():
        raise FileNotFoundError(f"No transcribe.cpp {LIBRARY_VERSION} in {directory}; run setup.sh")
    lib = ctypes.CDLL(str(path))
    lib.transcribe_version.restype = ctypes.c_char_p
    lib.transcribe_status_string.restype = ctypes.c_char_p
    lib.transcribe_model_backend.restype = ctypes.c_char_p
    lib.transcribe_model_backend.argtypes = [ctypes.c_void_p]
    lib.transcribe_full_text.restype = ctypes.c_char_p
    lib.transcribe_full_text.argtypes = [ctypes.c_void_p]
    lib.transcribe_abi_struct_size.restype = ctypes.c_size_t
    lib.transcribe_init_backends_ex.argtypes = [ctypes.POINTER(BackendInitParams)]
    lib.transcribe_model_load_file.argtypes = [ctypes.c_char_p, ctypes.POINTER(ModelLoadParams),
                                               ctypes.POINTER(ctypes.c_void_p)]
    lib.transcribe_session_init.argtypes = [ctypes.c_void_p, ctypes.POINTER(SessionParams),
                                            ctypes.POINTER(ctypes.c_void_p)]
    lib.transcribe_stream_begin.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(StreamParams)]
    lib.transcribe_stream_feed.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int,
                                           ctypes.POINTER(StreamUpdate)]
    lib.transcribe_stream_finalize.argtypes = [ctypes.c_void_p, ctypes.POINTER(StreamUpdate)]
    lib.transcribe_stream_reset.argtypes = [ctypes.c_void_p]
    lib.transcribe_stream_reset.restype = None
    version = lib.transcribe_version().decode()
    if version != LIBRARY_VERSION:
        raise RuntimeError(f"transcribe.cpp {version} in {directory}, expected {LIBRARY_VERSION}")
    for struct, which in ABI_STRUCTS.items():
        if lib.transcribe_abi_struct_size(which) != ctypes.sizeof(struct):
            raise RuntimeError(f"transcribe.cpp ABI mismatch in {struct.__name__}")
    return lib


def check(engine, status, what):
    if status != 0:
        raise RuntimeError(f"{what}: {engine.lib.transcribe_status_string(status).decode()}")


def load_engine(library, directory, latency_ms):
    """Runs on the single inference thread, like every other library call."""
    weights = directory / WEIGHTS
    if not weights.is_file():
        raise FileNotFoundError(f"No {WEIGHTS} in {directory}; run setup.sh")
    lib = load_library(library)
    chunk_ms, right_ms = LATENCIES[latency_ms]
    engine = SimpleNamespace(lib=lib, session=ctypes.c_void_p(), chunk_ms=chunk_ms, right_ms=right_ms, backend="")
    # Register only Vulkan (plus the CPU module ggml needs): probing other backends costs start-up time.
    init = BackendInitParams()
    lib.transcribe_backend_init_params_init(ctypes.byref(init))
    init.artifact_dir = str(library).encode()
    init.allowed_backends = BACKEND_MASK_CPU | BACKEND_MASK_VULKAN
    check(engine, lib.transcribe_init_backends_ex(ctypes.byref(init)), "init_backends")
    # An explicit backend request fails rather than falling back to the CPU.
    load = ModelLoadParams()
    lib.transcribe_model_load_params_init(ctypes.byref(load))
    load.backend = BACKEND_VULKAN
    model = ctypes.c_void_p()
    check(engine, lib.transcribe_model_load_file(str(weights).encode(), ctypes.byref(load), ctypes.byref(model)),
          "model_load_file")
    engine.backend = lib.transcribe_model_backend(model).decode()
    params = SessionParams()
    lib.transcribe_session_params_init(ctypes.byref(params))
    check(engine, lib.transcribe_session_init(model, ctypes.byref(params), ctypes.byref(engine.session)), "session_init")
    # One window of silence, so the first recording does not pay for first use.
    reset(engine)
    feed(engine, bytes((chunk_ms + right_ms) * 64))
    finish(engine)
    reset(engine)
    return engine


def reset(engine):
    """Drop any stream and begin a fresh one at the configured context."""
    lib = engine.lib
    lib.transcribe_stream_reset(engine.session)
    ext = BufferedStreamExt()
    lib.transcribe_parakeet_buffered_stream_ext_init(ctypes.byref(ext))
    ext.left_ms, ext.chunk_ms, ext.right_ms = LEFT_MS, engine.chunk_ms, engine.right_ms
    params = StreamParams()
    lib.transcribe_stream_params_init(ctypes.byref(params))
    params.family = ctypes.pointer(ext.ext)
    check(engine, lib.transcribe_stream_begin(engine.session, None, ctypes.byref(params)), "stream_begin")


def text(engine):
    return engine.lib.transcribe_full_text(engine.session).decode()


def feed(engine, data):
    """Hand f32le audio to the library, which encodes [left | chunk | right] for every
    complete chunk, decodes only the chunk frames and carries the RNN-T state.
    Returns the cumulative text if it changed."""
    update = StreamUpdate()
    engine.lib.transcribe_stream_update_init(ctypes.byref(update))
    check(engine, engine.lib.transcribe_stream_feed(engine.session, data, len(data) // 4, ctypes.byref(update)),
          "stream_feed")
    return text(engine) if update.result_changed else None


def finish(engine):
    # 400 ms of trailing silence, then flush the remainder as the last chunk.
    feed(engine, bytes(25_600))
    check(engine, engine.lib.transcribe_stream_finalize(engine.session, None), "stream_finalize")
    return text(engine)


# --- Decoder ownership -----------------------------------------------------

def make_decoder(options):
    """Start loading at once on the inference thread; the caller imports the
    event loop and WebSocket modules meanwhile."""
    decoder = SimpleNamespace(state="loading", owner=None, engine=None, loaded=None,
                              executor=ThreadPoolExecutor(max_workers=1, thread_name_prefix="inference"))

    def load():
        start = time.monotonic()
        try:
            decoder.engine = load_engine(options.library, options.directory, options.latency)
            decoder.state = "ready"
            log(f"Model loaded in {time.monotonic() - start:.2f}s ({decoder.engine.backend})")
        except Exception as error:
            decoder.state = "error"
            log(f"Model load failed: {type(error).__name__}: {error}")

    decoder.loaded = decoder.executor.submit(load)
    return decoder


def run(decoder, function, *arguments):
    return asyncio.get_running_loop().run_in_executor(decoder.executor, function, decoder.engine, *arguments)


async def acquire(decoder, token):
    if decoder.owner is not None:
        raise ProtocolFailure("busy")
    decoder.owner = token  # Reserve before any suspension, including model warmup/reset.
    try:
        await asyncio.shield(asyncio.wrap_future(decoder.loaded))
        if decoder.state != "ready":
            raise ProtocolFailure("unavailable")
        await run(decoder, reset)
    except BaseException:
        decoder.owner = None
        raise


async def release(decoder, token):
    if decoder.owner is not token:
        return
    try:
        if decoder.engine:
            await run(decoder, reset)
    except Exception:
        decoder.state = "error"
    decoder.owner = None  # Do not lend a decoder with outstanding inference/reset.


# --- Recording -------------------------------------------------------------

def validate_start(value):
    def number(key, expected):
        return type(value.get(key)) in (int, float) and value[key] == expected
    if not (value.get("type") == "start" and number("version", 1) and isinstance(value.get("recordingId"), str)
            and UUID_PATTERN.match(value["recordingId"]) and number("sampleRate", 16000) and number("channels", 1)
            and value.get("format") == "f32le"):
        raise ProtocolFailure("invalid_start")
    return value["recordingId"]


def decode_audio(data):
    # Any NaN or infinity survives a sum; finite float32 samples cannot overflow a double.
    if not math.isfinite(sum(array("f", data))):
        raise ProtocolFailure("invalid_audio")
    return data


async def record(socket, decoder):
    """One WebSocket is one recording. The reader enqueues synchronously; a
    single worker orders all inference; a single writer orders all events."""
    token = object()
    commands = asyncio.Queue()
    outbox = asyncio.Queue()
    r = SimpleNamespace(state="new", id="", sequence=0, queued=0, total=0, processed=0, outgoing=0, partial="",
                        close_code=1000)

    def cancel():
        if r.state == "closed":
            return
        r.state = "closed"
        timer.cancel()
        commands.put_nowait(None)
        outbox.put_nowait(None)

    def emit(kind, **extra):
        if r.state == "closed":
            return
        data = json.dumps({"type": kind, "recordingId": r.id, "sequence": r.sequence, **extra}, ensure_ascii=False)
        r.sequence += 1
        size = len(data.encode())
        if r.outgoing + size > OUTGOING_LIMIT:
            # No room to enqueue another cumulative transcript. Close rather than
            # accumulating unbounded writes for a client that stopped reading.
            outbox.put_nowait(json.dumps({"type": "error", "recordingId": r.id, "sequence": r.sequence,
                                          "code": "overload", "message": "Transcript output queue overloaded"}))
            r.close_code = 1011
            cancel()
            return
        r.outgoing += size
        outbox.put_nowait(data)

    def fail(code):
        emit("error", code=code, message=code.replace("_", " "))
        cancel()

    def on_text(message):
        try:
            try:
                value = json.loads(message) if len(message.encode()) <= 4096 else None
            except ValueError:
                value = None
            if not isinstance(value, dict):
                raise ProtocolFailure("invalid_control")
            if r.state == "new":
                r.id = validate_start(value)
                r.state = "loading"
                emit("loading")
                commands.put_nowait(("start", None))
            elif value.get("recordingId") == r.id and value.get("type") == "cancel":
                cancel()
            elif value.get("recordingId") == r.id and value.get("type") == "stop" and r.state == "ready":
                r.state = "finishing"
                commands.put_nowait(("stop", None))
            else:
                raise ProtocolFailure("invalid_state")
        except ProtocolFailure as failure:
            fail(failure.code)

    def on_audio(data):
        if r.state != "ready":
            return fail("invalid_state")
        if not data or len(data) > FRAME_LIMIT or len(data) % 4:
            return fail("invalid_audio")
        if r.queued + len(data) > QUEUE_LIMIT:
            return fail("overload")
        r.total += len(data)
        if r.total > SECONDS_LIMIT * 64_000:
            return fail("duration_limit")
        r.queued += len(data)
        commands.put_nowait(("audio", data))

    async def work():
        try:
            while (command := await commands.get()) is not None and r.state != "closed":
                kind, data = command
                if kind == "start":
                    await acquire(decoder, token)
                    if r.state == "loading":
                        r.state = "ready"
                        emit("ready")
                elif kind == "audio":
                    partial = await run(decoder, feed, decode_audio(data))
                    r.queued -= len(data)
                    r.processed += len(data)
                    if r.state in ("ready", "finishing"):
                        if partial is not None and partial != r.partial:
                            r.partial = partial
                            emit("partial", text=partial)
                        emit("ack", bytes=r.processed)
                else:
                    final = await run(decoder, finish)
                    # Release before done so a subsequent recording can immediately acquire.
                    await release(decoder, token)
                    emit("final", text=final)
                    emit("done")
                    cancel()
        except ProtocolFailure as failure:
            fail(failure.code)
        except Exception as error:
            log(f"Inference failed: {type(error).__name__}")
            fail("inference_failed")
        await release(decoder, token)

    async def write():
        try:
            while (data := await outbox.get()) is not None:
                await socket.send(data)
                r.outgoing -= len(data.encode())
            await socket.close(r.close_code)
        except ConnectionClosed:
            cancel()

    timer = asyncio.get_running_loop().call_later(600, fail, "duration_limit")
    tasks = [asyncio.create_task(work()), asyncio.create_task(write())]
    try:
        async for message in socket:
            if r.state == "closed":
                break
            on_text(message) if isinstance(message, str) else on_audio(message)
    except ConnectionClosed:
        pass
    finally:
        cancel()
        # In-flight inference finishes and the decoder resets before this returns.
        await asyncio.gather(*tasks)


# --- Server ----------------------------------------------------------------

def parse_arguments(arguments):
    options = {"--latency-ms": os.environ.get("DICTATION_LATENCY_MS", "1120"),
               "--idle-minutes": os.environ.get("DICTATION_IDLE_MINUTES", "10")}
    arguments = list(arguments)
    while arguments:
        key = arguments.pop(0)
        if key not in ("--host", "--port", "--model-dir", "--instance-id", "--parent-pid", "--latency-ms",
                       "--idle-minutes", "--warm-up") or not arguments:
            raise SystemExit("invalid_arguments")
        options[key] = arguments.pop(0)
    host = options.get("--host", "127.0.0.1")
    port = options.get("--port", "9876")
    if host not in ("127.0.0.1", "::1", "localhost") or not port.isdecimal() or not 1 <= int(port) <= 65535:
        raise SystemExit("invalid_address")
    latency = options["--latency-ms"]
    if not latency.isdecimal() or int(latency) not in LATENCIES:
        raise SystemExit(f"invalid_latency: choose one of {sorted(LATENCIES)}")
    try:
        idle = float(options["--idle-minutes"])
    except ValueError:
        idle = -1
    if not 0 <= idle < math.inf:
        raise SystemExit("invalid_idle_minutes: minutes without a recording before exiting, 0 to stay resident")
    directory = Path(options.get("--model-dir") or CACHE / "models").expanduser()
    parent = options.get("--parent-pid")
    return SimpleNamespace(host=host, port=int(port), latency=int(latency), idle=idle * 60, directory=directory,
                           library=CACHE / f"transcribe-native-{LIBRARY_VERSION}", warm_up=options.get("--warm-up"),
                           instance=options.get("--instance-id") or str(uuid.uuid4()).upper(),
                           parent=int(parent) if parent and parent.isdecimal() else None)


def warm_up(options, path):
    """setup.sh: transcribe one f32le file so the driver compiles and caches every
    Vulkan pipeline now, not during the first recording."""
    decoder = make_decoder(options)
    decoder.loaded.result()
    if decoder.state != "ready":
        raise SystemExit(1)
    audio = Path(path).read_bytes()
    start = time.monotonic()
    reset(decoder.engine)
    for offset in range(0, len(audio) - len(audio) % 4, 5120):
        feed(decoder.engine, audio[offset:offset + 5120])
    log(f"Warm-up: {len(audio) / 64000:.1f}s of audio in {time.monotonic() - start:.2f}s: {finish(decoder.engine)}")


async def watch_parent(parent):
    while True:
        await asyncio.sleep(1)
        try:
            os.kill(parent, 0)
        except OSError:
            os._exit(0)
        if os.getppid() != parent:
            os._exit(0)


async def exit_when_idle(server, activity, seconds):
    """Leave once no recording has been open for `seconds`, which is what returns the
    GPU memory. Exit status 0 tells a supervisor this was not a failure; it starts a
    new process on the next request."""
    while activity.open or time.monotonic() - activity.last < seconds:
        await asyncio.sleep(min(1, seconds))
    # Stop listening first: a start that raced with this is refused and retried
    # against a fresh process, never accepted by one that is about to vanish.
    server.close(close_connections=False)
    await asyncio.sleep(0.1)
    while activity.open:
        await asyncio.sleep(0.1)
    log(f"No recording for {seconds / 60:g} min; exiting to release the GPU")
    os._exit(0)


async def main(options, decoder):
    model_id = f"{MODEL}-F16-transcribe.cpp-vulkan-streaming-{options.latency}ms"
    activity = SimpleNamespace(open=0, last=time.monotonic())

    def respond(status, body):
        data = json.dumps(body).encode()
        headers = Headers({"content-type": "application/json", "content-length": str(len(data)), "connection": "close"})
        return Response(status, "OK" if status == 200 else "Not Found", headers, data)

    def http(connection, request):
        path = request.path.split("?")[0]
        if path == "/healthz":
            return respond(200, {"instanceId": options.instance, "version": "1", "status": "alive"})
        if path == "/v1/status":
            return respond(200, {
                "version": 1, "modelId": model_id, "state": decoder.state if decoder.owner is None else "busy",
                "audio": AUDIO_FORMAT,
                "limits": {"frameBytes": FRAME_LIMIT, "queueBytes": QUEUE_LIMIT, "seconds": SECONDS_LIMIT}})
        if path != "/v1/stream":
            return respond(404, {"error": "not found"})

    async def stream(socket):
        activity.open += 1
        try:
            await record(socket, decoder)
        finally:
            activity.open -= 1
            activity.last = time.monotonic()

    async with serve(stream, options.host, options.port, process_request=http,
                     max_size=FRAME_LIMIT, compression=None, ping_interval=None, server_header=None) as server:
        log(f"Listening on {options.host}:{options.port} ({model_id})")
        watchers = [watch_parent(options.parent)] if options.parent else []
        if options.idle:
            watchers.append(exit_when_idle(server, activity, options.idle))
        await asyncio.gather(asyncio.Future(), *watchers)


if __name__ == "__main__":
    options = parse_arguments(sys.argv[1:])
    if options.warm_up:
        warm_up(options, options.warm_up)
        os._exit(0)
    decoder = make_decoder(options)
    # Deliberately after the load has started: these imports take about as long as
    # backend initialisation, and the model is the long pole.
    import asyncio
    from websockets.asyncio.server import serve
    from websockets.datastructures import Headers
    from websockets.exceptions import ConnectionClosed
    from websockets.http11 import Response
    asyncio.run(main(options, decoder))
