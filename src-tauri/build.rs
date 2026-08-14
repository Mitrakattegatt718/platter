use std::env;
use std::path::PathBuf;

/// Compiles the libgpod C bridge (bridging/GpodHelpers.c) — plain C with no
/// Swift anywhere. libgpod is expected at ~/.local (it left homebrew-core);
/// its GLib dependency chain comes from Homebrew. Override with
/// LIBGPOD_PREFIX / BREW_PREFIX.
fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let bridging = manifest.join("bridging");
    let helpers_c = bridging.join("GpodHelpers.c");

    let home = env::var("HOME").unwrap_or_default();
    let libgpod_prefix =
        env::var("LIBGPOD_PREFIX").unwrap_or_else(|_| format!("{home}/.local"));
    let brew_prefix = env::var("BREW_PREFIX").unwrap_or_else(|_| "/opt/homebrew".into());

    let mut pkg_path = format!(
        "{libgpod_prefix}/lib/pkgconfig:{brew_prefix}/lib/pkgconfig:{brew_prefix}/share/pkgconfig"
    );
    if let Ok(existing) = env::var("PKG_CONFIG_PATH") {
        pkg_path = format!("{pkg_path}:{existing}");
    }
    env::set_var("PKG_CONFIG_PATH", &pkg_path);

    let mut build = cc::Build::new();
    build
        .file(&helpers_c)
        .include(&bridging)
        .flag_if_supported("-Wno-nullability-completeness");

    // probe_library also emits the cargo:rustc-link-* lines for the final link.
    for lib in ["libgpod-1.0", "glib-2.0", "gobject-2.0", "gdk-pixbuf-2.0"] {
        let probed = pkg_config::probe_library(lib)
            .unwrap_or_else(|e| panic!("pkg-config failed for {lib}: {e}"));
        for inc in probed.include_paths {
            build.include(inc);
        }
    }
    build.compile("gpodhelpers");

    println!("cargo:rerun-if-changed={}", helpers_c.display());
    println!(
        "cargo:rerun-if-changed={}",
        bridging.join("GpodBridge.h").display()
    );
    // Both feed the pkg-config search path above, so a build that does not
    // re-run on their change silently keeps linking against the old prefix.
    println!("cargo:rerun-if-env-changed=LIBGPOD_PREFIX");
    println!("cargo:rerun-if-env-changed=BREW_PREFIX");
    println!("cargo:rerun-if-env-changed=PKG_CONFIG_PATH");

    tauri_build::build()
}
