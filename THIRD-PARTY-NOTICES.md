# Third-party notices

Platter itself is proprietary (see `LICENSE`). It bundles and links the
components below under their own terms. Where a component is licensed under the
LGPL, that license grants recipients rights this program's own license does not
— in particular the right to obtain that component's source and to relink the
application against a modified version of it.

## Bundled at runtime (inside `Platter.app/Contents/Frameworks`)

Copied in and install-name-rewritten by `bundle-dylibs.sh`.

| Component | License | Notes |
|---|---|---|
| libgpod | LGPL-2.1-or-later | The iPod database library. Loaded as a shared object. |
| GLib / GObject / GIO | LGPL-2.1-or-later | libgpod's dependency chain, from Homebrew. |
| gdk-pixbuf | LGPL-2.1-or-later | Cover-art decode and scaling. |
| libintl, libffi, PCRE2, zlib, and the remaining transitive chain | LGPL-2.1-or-later / BSD / zlib | Pulled in by the above; see each project for exact terms. |

**LGPL relinking.** These are shipped as separate dynamic libraries, not
statically linked. A recipient may replace any of them in
`Platter.app/Contents/Frameworks` with their own build of the same library and
run the result, which is how this distribution satisfies LGPL-2.1 §6. Source for
each is available from its upstream project; on request the copyright holder
will supply the exact versions bundled in a given release.

## Bundled as sidecar executables (`Platter.app/Contents/MacOS`)

| Component | License | Notes |
|---|---|---|
| ffmpeg / ffprobe | LGPL-2.1-or-later **when built per `docs/ffmpeg-build.md`** | Audio conversion and probing. Invoked as separate processes. |

> **Release blocker.** The binaries staged by `stage-ffmpeg.sh` on a development
> machine may be Homebrew's ffmpeg, which is built `--enable-gpl
> --enable-version3` and is therefore **GPLv3**. A build containing that binary
> must not be distributed under this LICENSE. Build the LGPL configuration in
> `docs/ffmpeg-build.md` before shipping; `stage-ffmpeg.sh` refuses a GPL build
> unless `ALLOW_GPL_FFMPEG=1` is set, which is for local development only.

## Statically linked into the application binary

Rust crates from `src-tauri/Cargo.toml` and their transitive dependencies —
principally Tauri, tokio, serde, and `lofty` — are permissively licensed
(MIT or Apache-2.0). Frontend dependencies from `package.json` — React,
`@base-ui/react`, `@tanstack/react-virtual`, Tailwind CSS, `lucide-react` —
are MIT or ISC.

Generate the current, exact inventory with:

```sh
cargo install cargo-about   # once
cargo about generate --output-file licenses.html   # in src-tauri/
npx license-checker --production --summary          # at the repo root
```

## Not bundled

`diskutil` and `open` are macOS system tools invoked as subprocesses; no code
from them is distributed with Platter.
