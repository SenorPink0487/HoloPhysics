// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

#[tauri::command]
fn app_info() -> serde_json::Value {
    serde_json::json!({
        "name": env!("CARGO_PKG_NAME"),
        "version": env!("CARGO_PKG_VERSION"),
        "description": env!("CARGO_PKG_DESCRIPTION"),
    })
}

#[tauri::command]
fn open_html_report(title: String, html: String) -> Result<String, String> {
    let sanitized_title = title
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>();
    let clean_title = if sanitized_title.is_empty() { "report" } else { &sanitized_title };
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let filename = format!("{}_{}.html", clean_title, timestamp);
    let temp_dir = std::env::temp_dir().join("dawu_reports");
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    let file_path = temp_dir.join(filename);
    std::fs::write(&file_path, html.as_bytes()).map_err(|e| e.to_string())?;
    tauri_plugin_opener::open_path(&file_path, None::<&str>)
        .map_err(|e| e.to_string())?;
    Ok(file_path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![app_info, open_html_report])
        .run(tauri::generate_context!())
        .expect("error while running Quantum Physics Lab");
}
