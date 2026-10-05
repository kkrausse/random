"""Loopback streaming dictation service, protocol v1 (../dictation-server/docs/protocol.md).

Linux/NVIDIA port of the Swift service: NeMo + PyTorch CUDA running
nvidia/parakeet-unified-en-0.6b in buffered streaming mode. Recording and
decoder semantics mirror Recording.swift and Decoder.swift.
"""

import asyncio
import json
import math
import os
import re
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import numpy as np
from websockets.asyncio.server import serve
from websockets.datastructures import Headers
from websockets.exceptions import ConnectionClosed
from websockets.http11 import Response

MODEL = "parakeet-unified-en-0.6b"
FRAME_LIMIT = 6_400
QUEUE_LIMIT = 128_000
SECONDS_LIMIT = 300
OUTGOING_LIMIT = 255_488
AUDIO_FORMAT = {"sampleRate": 16000, "channels": 1, "format": "f32le"}
# Model-card contexts in 80 ms encoder frames: latency ms -> (chunk, right).
# Left context is always 70 frames (5.6 s), as in training.
LATENCIES = {2080: (13, 13), 1120: (7, 7), 560: (2, 5), 320: (1, 3), 240: (1, 2), 160: (1, 1)}
LEFT_FRAMES = 70
FRAME_SAMPLES = 1280
UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


class ProtocolFailure(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def log(message):
    print(message, file=sys.stderr, flush=True)


# --- Model -----------------------------------------------------------------
# Everything below runs on the single inference thread. Heavy imports stay
# inside so /healthz answers while torch and NeMo are still loading.

def load_engine(directory, latency_ms):
    import torch
    from nemo.collections.asr.models import ASRModel
    from nemo.collections.asr.parts.submodules.rnnt_decoding import RNNTDecodingConfig
    from nemo.collections.asr.parts.utils.rnnt_utils import batched_hyps_to_hypotheses
    from nemo.collections.asr.parts.utils.streaming_utils import ContextSize, StreamingBatchedAudioBuffer
    from nemo.core.connectors.save_restore_connector import SaveRestoreConnector
    from nemo.utils import logging as nemo_logging
    from omegaconf import OmegaConf, open_dict

    nemo_logging.setLevel(nemo_logging.ERROR)
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is not available")
    # Explicit local-only load from the extracted checkpoint: a missing
    # directory fails rather than downloading.
    if not (directory / "model_config.yaml").is_file() or not (directory / "model_weights.ckpt").is_file():
        raise FileNotFoundError(f"No extracted {MODEL} checkpoint in {directory}; run setup.sh")
    torch.set_grad_enabled(False)
    torch.set_float32_matmul_precision("high")
    device = torch.device("cuda")
    connector = SaveRestoreConnector()
    connector.model_extracted_dir = str(directory)
    # Restore on CPU first: restoring straight to CUDA briefly holds two copies of the weights.
    model = ASRModel.restore_from(str(directory), map_location="cpu", save_restore_connector=connector).to(device)
    model.freeze()
    model.eval()
    model.preprocessor.featurizer.dither = 0.0
    model.preprocessor.featurizer.pad_to = 0
    # Stateful chunked decoding needs greedy label-looping, as in NeMo's
    # speech_to_text_streaming_infer_rnnt.py reference script.
    decoding = OmegaConf.structured(RNNTDecodingConfig())
    with open_dict(decoding):
        decoding.strategy = "greedy_batch"
        decoding.greedy.loop_labels = True
        decoding.greedy.preserve_alignments = False
        decoding.fused_batch_size = -1
    model.change_decoding_strategy(decoding)
    chunk, right = LATENCIES[latency_ms]
    model.encoder.set_default_att_context_size(att_context_size=[LEFT_FRAMES, chunk, right])
    engine = SimpleNamespace(
        torch=torch, model=model, device=device, to_hypotheses=batched_hyps_to_hypotheses,
        computer=model.decoding.decoding.decoding_computer, new_buffer=StreamingBatchedAudioBuffer,
        context=ContextSize(left=LEFT_FRAMES * FRAME_SAMPLES, chunk=chunk * FRAME_SAMPLES, right=right * FRAME_SAMPLES),
        stream=None)
    # Warm cuDNN and the decoder so the first recording is not the slow one.
    reset(engine)
    feed(engine, np.zeros(engine.context.total(), dtype=np.float32))
    finish(engine)
    reset(engine)
    return engine


def reset(engine):
    engine.stream = SimpleNamespace(
        buffer=engine.new_buffer(batch_size=1, context_samples=engine.context, dtype=engine.torch.float32, device=engine.device),
        pending=np.zeros(0, dtype=np.float32), state=None, hyps=None,
        need=engine.context.chunk + engine.context.right)


def step(engine, samples, last):
    """Encode [left | chunk | right], decode only the chunk frames, carry RNN-T state."""
    torch, stream = engine.torch, engine.stream
    is_last = torch.tensor([last], device=engine.device)
    stream.buffer.add_audio_batch_(
        torch.from_numpy(samples).to(engine.device)[None],
        audio_lengths=torch.tensor([len(samples)], device=engine.device),
        is_last_chunk=last, is_last_chunk_batch=is_last)
    encoded, encoded_length = engine.model(
        input_signal=stream.buffer.samples, input_signal_length=stream.buffer.context_size_batch.total())
    left = stream.buffer.context_size.subsample(factor=FRAME_SAMPLES).left
    context = stream.buffer.context_size_batch.subsample(factor=FRAME_SAMPLES)
    length = torch.where(is_last, encoded_length - context.left, context.chunk)
    hyps, stream.state = engine.computer(
        x=encoded.transpose(1, 2)[:, left:], out_len=length, prev_batched_state=stream.state)
    if stream.hyps is None:
        stream.hyps = hyps
    else:
        stream.hyps.merge_(hyps)
    stream.need = engine.context.chunk


def text(engine):
    if engine.stream.hyps is None:
        return ""
    hypothesis = engine.to_hypotheses(engine.stream.hyps, batch_size=1)[0]
    return engine.model.tokenizer.ids_to_text(hypothesis.y_sequence.tolist())


def feed(engine, samples):
    """Buffer audio and run every complete chunk. Returns the cumulative text if any ran."""
    stream = engine.stream
    stream.pending = np.concatenate((stream.pending, samples))
    ran = False
    with engine.torch.inference_mode():
        while len(stream.pending) >= stream.need:
            piece, stream.pending = stream.pending[:stream.need], stream.pending[stream.need:]
            step(engine, piece, False)
            ran = True
        return text(engine) if ran else None


def finish(engine):
    # 400 ms of trailing silence, then flush the remainder as the last chunk.
    stream = engine.stream
    stream.pending = np.concatenate((stream.pending, np.zeros(6400, dtype=np.float32)))
    with engine.torch.inference_mode():
        while len(stream.pending) > stream.need:
            piece, stream.pending = stream.pending[:stream.need], stream.pending[stream.need:]
            step(engine, piece, False)
        step(engine, stream.pending, True)
        return text(engine)


# --- Decoder ownership -----------------------------------------------------

def make_decoder(directory, latency_ms):
    loop = asyncio.get_running_loop()
    decoder = SimpleNamespace(state="loading", owner=None, engine=None, loaded=loop.create_future(),
                              executor=ThreadPoolExecutor(max_workers=1, thread_name_prefix="inference"))

    def loaded(future):
        try:
            decoder.engine = future.result()
            decoder.state = "ready"
        except Exception as error:
            decoder.state = "error"
            log(f"Model load failed: {type(error).__name__}: {error}")
        decoder.loaded.set_result(None)

    def load():
        start = time.monotonic()
        engine = load_engine(directory, latency_ms)
        log(f"Model loaded in {time.monotonic() - start:.1f}s")
        return engine

    loop.run_in_executor(decoder.executor, load).add_done_callback(loaded)
    return decoder


def run(decoder, function, *arguments):
    return asyncio.get_running_loop().run_in_executor(decoder.executor, function, decoder.engine, *arguments)


async def acquire(decoder, token):
    if decoder.owner is not None:
        raise ProtocolFailure("busy")
    decoder.owner = token  # Reserve before any suspension, including model warmup/reset.
    try:
        await asyncio.shield(decoder.loaded)
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
    samples = np.frombuffer(data, dtype="<f4")
    if not np.isfinite(samples).all():
        raise ProtocolFailure("invalid_audio")
    return samples


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
    options = {"--latency-ms": os.environ.get("DICTATION_LATENCY_MS", "1120")}
    arguments = list(arguments)
    while arguments:
        key = arguments.pop(0)
        if key not in ("--host", "--port", "--model-dir", "--instance-id", "--parent-pid", "--latency-ms") or not arguments:
            raise SystemExit("invalid_arguments")
        options[key] = arguments.pop(0)
    host = options.get("--host", "127.0.0.1")
    port = options.get("--port", "9876")
    if host not in ("127.0.0.1", "::1", "localhost") or not port.isdecimal() or not 1 <= int(port) <= 65535:
        raise SystemExit("invalid_address")
    latency = options["--latency-ms"]
    if not latency.isdecimal() or int(latency) not in LATENCIES:
        raise SystemExit(f"invalid_latency: choose one of {sorted(LATENCIES)}")
    directory = Path(options.get("--model-dir") or Path(__file__).parent / ".cache" / "models" / MODEL).expanduser()
    parent = options.get("--parent-pid")
    return SimpleNamespace(host=host, port=int(port), latency=int(latency), directory=directory,
                           instance=options.get("--instance-id") or str(uuid.uuid4()).upper(),
                           parent=int(parent) if parent and parent.isdecimal() else None)


async def watch_parent(parent):
    while True:
        await asyncio.sleep(1)
        try:
            os.kill(parent, 0)
        except OSError:
            os._exit(0)
        if os.getppid() != parent:
            os._exit(0)


async def main():
    options = parse_arguments(sys.argv[1:])
    decoder = make_decoder(options.directory, options.latency)
    model_id = f"{MODEL}-streaming-{options.latency}ms"

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

    async with serve(lambda socket: record(socket, decoder), options.host, options.port, process_request=http,
                     max_size=FRAME_LIMIT, compression=None, ping_interval=None, server_header=None):
        log(f"Listening on {options.host}:{options.port} ({model_id})")
        await (watch_parent(options.parent) if options.parent else asyncio.Future())


if __name__ == "__main__":
    asyncio.run(main())
