use std::env;

fn main() {
    assert_eq!(env::var("CARGO_CFG_TARGET_ENV").as_deref(), Ok("msvc"),
        "Quantum Physics Lab Windows builds must use the MSVC target");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    tauri_build::build()
}
