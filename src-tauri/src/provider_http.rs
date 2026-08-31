use reqwest::{blocking::Client, Proxy};
use std::{net::{SocketAddr, TcpStream}, str::FromStr, time::Duration};

fn local_proxy_available(proxy: &str) -> bool {
    let host = proxy.trim_start_matches("http://").trim_start_matches("https://");
    let Some(address) = host.split('/').next().and_then(|value| SocketAddr::from_str(value).ok()) else { return false };
    TcpStream::connect_timeout(&address, Duration::from_millis(150)).is_ok()
}

pub fn client(timeout: Duration, user_agent: Option<&str>) -> Result<Client, String> {
    let mut builder = Client::builder().timeout(timeout);
    if let Some(value) = user_agent { builder = builder.user_agent(value); }
    let proxy = std::env::var("JASON_OS_PROVIDER_PROXY").ok().filter(|value| !value.trim().is_empty()).or_else(|| Some("http://127.0.0.1:7897".into()));
    if let Some(proxy) = proxy.filter(|value| local_proxy_available(value)) {
        builder = builder.proxy(Proxy::all(proxy).map_err(|error| error.to_string())?);
    }
    builder.build().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_local_proxy_is_not_treated_as_available() {
        assert!(!local_proxy_available("http://127.0.0.1:1"));
    }
}
