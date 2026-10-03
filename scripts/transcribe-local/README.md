# Local transcription

Transcribes an audio file with FluidAudio's Parakeet Unified model. The model
and inference stay local; FluidAudio reuses its model cache under
`~/Library/Application Support/FluidAudio/Models/`.

```bash
./transcribe-local path/to/audio.mp3
./transcribe-local path/to/audio.mp3 path/to/transcript.txt
```

The first run compiles the command. If the Parakeet Unified model is not already
cached, FluidAudio downloads it; later runs reuse both the build and model.
