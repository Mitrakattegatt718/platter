//! One `statfs` wrapper for every free-space question in the app.
//!
//! Two syscalls used to be in the tree: `statfs` for the open library's
//! capacity and `statvfs` for the volume picker. `statvfs` is the wrong one on
//! Darwin — `fsblkcnt_t` is a `c_uint` there, so `f_blocks`/`f_bavail`
//! truncate above 2^32 blocks (~16 TiB at 4 KiB). Irrelevant for a 160 GB
//! iPod, wrong for the external drive someone points the converter at.
//! `statfs` counts in `u64` and additionally yields the filesystem type (FAT32
//! detection) and the mount root, neither of which `statvfs` reports.

use std::ffi::{CStr, CString};
use std::path::{Path, PathBuf};

pub struct FsInfo {
    pub free_bytes: u64,
    pub total_bytes: u64,
    /// `f_fstypename`, e.g. "apfs", "hfs", "msdos" (which is FAT of some width).
    pub fs_type: String,
    /// `f_mntonname` — the volume the path lives on, resolved by the kernel
    /// rather than guessed from path prefixes.
    pub mount_root: PathBuf,
}

impl FsInfo {
    /// FAT32 brings a 4 GiB per-file ceiling and fat clusters. Darwin reports
    /// every FAT width as "msdos", which is fine here: the iPod Classic is
    /// FAT32 whenever it is Windows-formatted, and the narrower widths carry
    /// the same limit or worse.
    pub fn is_fat(&self) -> bool {
        self.fs_type == "msdos"
    }
}

/// Accepts any path, not just a mount root — a folder the user picked in a
/// save dialog works directly. None when the path can't be stat'd.
pub fn fs_info(path: &Path) -> Option<FsInfo> {
    let c_path = CString::new(path.as_os_str().as_encoded_bytes()).ok()?;
    let mut stat: libc::statfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statfs(c_path.as_ptr(), &mut stat) } != 0 {
        return None;
    }
    let block = stat.f_bsize as u64;
    // Fixed-size char arrays, NUL-terminated by the kernel. from_ptr is sound
    // because a zeroed struct guarantees a terminator even if statfs left the
    // field untouched.
    let take = |buf: &[libc::c_char]| -> String {
        unsafe { CStr::from_ptr(buf.as_ptr()) }
            .to_string_lossy()
            .into_owned()
    };
    Some(FsInfo {
        // f_bavail, not f_bfree: the latter counts blocks reserved for root
        // that an ordinary write can't have.
        free_bytes: stat.f_bavail * block,
        total_bytes: stat.f_blocks * block,
        fs_type: take(&stat.f_fstypename),
        mount_root: PathBuf::from(take(&stat.f_mntonname)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_the_boot_volume_for_an_ordinary_path() {
        let info = fs_info(Path::new("/usr")).expect("statfs on /usr");
        assert!(info.total_bytes > 0);
        assert!(info.free_bytes <= info.total_bytes);
        assert!(!info.fs_type.is_empty());
        // /usr is on the root volume on every supported macOS.
        assert_eq!(info.mount_root, Path::new("/"));
    }

    #[test]
    fn missing_paths_report_nothing_rather_than_zero() {
        // Zero free bytes and "couldn't ask" must never be confused — one
        // blocks a conversion, the other means we don't know.
        assert!(fs_info(Path::new("/nonexistent-platter-probe")).is_none());
    }
}
