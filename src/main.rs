mod app;
mod config;
mod db;
mod server;
mod telegram;

#[tokio::main]
async fn main() {
    if let Err(error) = server::run().await {
        eprintln!("backend startup failed: {error}");
        std::process::exit(1);
    }
}
