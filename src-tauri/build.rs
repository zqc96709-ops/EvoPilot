fn main() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let commit = std::process::Command::new("git").args(["rev-parse", "--short=12", "HEAD"]).current_dir(root).output().ok().filter(|value| value.status.success()).map(|value| String::from_utf8_lossy(&value.stdout).trim().to_string()).unwrap_or_else(|| "unknown".into());
    let dirty = std::process::Command::new("git").args(["status", "--porcelain"]).current_dir(root).output().ok().map(|value| !value.stdout.is_empty()).unwrap_or(false);
    let build_time = std::process::Command::new("date").args(["-u", "+%Y-%m-%dT%H:%M:%SZ"]).output().ok().map(|value| String::from_utf8_lossy(&value.stdout).trim().to_string()).unwrap_or_else(|| "unknown".into());
    println!("cargo:rustc-env=JASON_GIT_COMMIT={}{}", commit, if dirty { "+dirty" } else { "" });
    println!("cargo:rustc-env=JASON_BUILD_TIME={build_time}");
    // `.git/HEAD` normally only contains a branch reference, so watching it alone
    // can leave a packaged binary with the previous commit's provenance. The
    // reflog and index change when the current checkout or staged state changes.
    println!("cargo:rerun-if-changed=../.git/logs/HEAD");
    println!("cargo:rerun-if-changed=../.git/index");
    tauri_build::build()
}
