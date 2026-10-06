# Voice reference clips

All four clips are single utterances from **LibriTTS-R**, `dev-clean` subset
(Koizumi et al. 2023, https://www.openslr.org/141/), fetched from the Hugging
Face mirror `mythicinfinity/libritts_r` (config `clean`, split `dev.clean`)
through the datasets-server rows API by `../fetch_refs.py`.

License: **CC BY 4.0** (LibriTTS-R / LibriTTS). The underlying recordings are
LibriVox public-domain audiobook readings.

Clips are unmodified apart from a lossless WAV -> FLAC re-encode (24 kHz mono).

| file | speaker | utterance id | length | median F0 | gender |
|---|---|---|---|---|---|
| `libri84f.flac` | 84 | `84_121550_000096_000000` | 8.7 s | 214 Hz | female |
| `libri8842f.flac` | 8842 | `8842_302203_000002_000005` | 10.9 s | 185 Hz | female |
| `libri174m.flac` | 174 | `174_84280_000003_000008` | 13.0 s | 143 Hz | male |
| `libri3000m.flac` | 3000 | `3000_15664_000005_000002` | 12.4 s | 96 Hz | male |

Gender labels come from the measured pitch (`../inspect_audio.py`) and agree
with the LibriSpeech speaker list as remembered; they were not cross-checked
against `SPEAKERS.txt`.
