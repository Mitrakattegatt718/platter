# Building an LGPL ffmpeg for the bundle

Platter's Convert tab shells out to `ffmpeg` and `ffprobe`. To ship them inside
`Platter.app` — so nobody has to install Homebrew — they have to be staged as
Tauri sidecars by `./stage-ffmpeg.sh`.

**Homebrew's ffmpeg cannot be used for a release.** Verified on 8.1.2, its
configure line contains `--enable-gpl --enable-version3` (it pulls in x264 and
x265), and `ffmpeg -L` prints the GPLv3 text. The moment Platter ships that
binary it becomes a distributor of GPLv3 software: complete corresponding
source to every recipient, no added restrictions, and no Mac App Store.

`stage-ffmpeg.sh` refuses such a build unless `ALLOW_GPL_FFMPEG=1`, which is
for local development only.

## What to build instead

Drop `--enable-gpl`, `--enable-libx264`, `--enable-libx265`. You do **not** also
need to drop `--enable-version3` — the OpenSSL guard short-circuits once `gpl`
is off — but nothing here needs OpenSSL either, so the simplest line omits both.

```sh
./configure \
  --prefix="$PWD/../ffmpeg-lgpl" \
  --enable-shared --disable-static \
  --disable-gpl --disable-nonfree \
  --disable-doc --disable-ffplay \
  --disable-network --disable-protocols --enable-protocol=file,pipe \
  --disable-encoders --disable-decoders --disable-muxers --disable-demuxers \
  --disable-filters --disable-bsfs --disable-parsers \
  --enable-encoder=alac,aac,flac,pcm_s16le,pcm_s16be,mjpeg \
  --enable-decoder=alac,aac,flac,mp3,pcm_s16le,pcm_s16be,pcm_s24le,pcm_s32le,pcm_f32le,ape,tta,wavpack,shorten,dsd_lsbf,dsd_msbf,dsd_lsbf_planar,dsd_msbf_planar,mlp,truehd,wmalossless,mjpeg,png \
  --enable-muxer=ipod,mp4,mp3,aiff,wav,flac,image2 \
  --enable-demuxer=mov,mp3,flac,wav,aiff,ape,tta,wv,dsf,dff,caf,w64,image2,mjpeg \
  --enable-parser=aac,flac,mpegaudio,png,mjpeg \
  --enable-filter=aresample,aformat,anull,lowpass,scale,null \
  --enable-libmp3lame \
  --enable-audiotoolbox \
  --enable-videotoolbox
make -j"$(sysctl -n hw.ncpu)" && make install
```

Then:

```sh
./stage-ffmpeg.sh ../ffmpeg-lgpl/bin
npm run tauri build
./bundle-dylibs.sh
```

### Why each piece is there

- **`libmp3lame`** is LGPL and stays. ffmpeg ships **no** native MP3 encoder, so
  without it the MP3 output option greys out. That is handled at runtime — the
  format list is probed from `ffmpeg -buildconf` — but it is a real loss.
- **`audiotoolbox`** gives `aac_at`, macOS's own AAC encoder, audibly better
  than ffmpeg's native one at the same bitrate. Falls back automatically.
- **`mjpeg` + `scale` + `image2`** are for cover art: `ART_NORM_OPTS` in
  `convert.rs` re-encodes oversized or non-JPEG art to a ≤600 px JPEG.
- **`lowpass`** kills DSD's ultrasonic shaping noise before decimation.
- **`aresample`** is the resample/dither chain. Adding `--enable-libsoxr` is
  optional; `resampler_args()` detects it and falls back to swr without it.
- The GPL loss that is real but irrelevant here: `flac_dsp_gpl.asm`, an x86-only
  FLAC-encode SIMD path. Not used on arm64, and this app only writes FLAC as a
  Mac-side option anyway.

## Notice obligations

LGPL requires shipping the `libav*` libraries as **shared** objects the user
could substitute — which is exactly what `dylibbundler` already produces into
`Contents/Frameworks` — plus the license text and a way to obtain the source.

**These obligations are currently unmet, and not only for ffmpeg.**
`bundle-dylibs.sh` already copies libgpod, GLib, gdk-pixbuf, libplist and
gettext into the app, all LGPL, and the repo ships no license texts at all. A
release needs `LICENSES/` in the repo and `Contents/Resources/Licenses/` in the
bundle before any of this goes out.

## Universal binaries

`stage-ffmpeg.sh` stages one triple, taken from `rustc -vV`. A single `.app`
covering Intel and Apple Silicon needs either a sidecar per triple or a `lipo`'d
`-universal-apple-darwin` file. The current setup is arm64-only.
