//! Dev fixture: run the in-app lossless→ALAC conversion pipeline against
//! arbitrary files or folders from the command line, without launching the
//! app. Prints one "READY <path>" / "REJECTED <reason>" line per work item.
//!
//!   cargo run --example convert_check -- ~/Music/some-album [more paths…]
//!
//! Outputs land in $TMPDIR/convert-check (swept on every run).

use podsync_tauri_lib::convert;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        eprintln!("usage: convert_check <path> [path ...]");
        std::process::exit(2);
    }

    let items = convert::scan(&args);
    if items.is_empty() {
        eprintln!("no importable audio found");
        std::process::exit(1);
    }

    let out_dir = std::env::temp_dir().join("convert-check");
    let _ = std::fs::remove_dir_all(&out_dir);
    let total = items.len();
    let results = convert::prepare_batch(
        &items,
        &out_dir,
        &convert::TargetSpec::alac(),
        &convert::ConvertControl::default(),
        &convert::ProgressOnly(&|n, name| {
            eprintln!("[{n}/{total}] {name}");
        }),
    );

    for (item, prepared) in items.iter().zip(&results) {
        match prepared {
            convert::Prepared::Ready(path) => println!("READY\t{}", path.display()),
            convert::Prepared::Rejected(reason) => {
                println!("REJECTED\t{}\t{reason}", item.display())
            }
            convert::Prepared::Cancelled => println!("CANCELLED\t{}", item.display()),
        }
    }
}
