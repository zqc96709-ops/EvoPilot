use serde_json::{json, Value};
use std::time::Duration;
use crate::provider_http;

const BASE: &str = "https://api.scrapecreators.com";
pub struct ScrapeCreatorsCapture {
    pub canonical: Value,
    pub raw: Value,
    pub endpoint: String,
    pub status_code: u16,
}
fn client() -> Result<reqwest::blocking::Client, String> {
    provider_http::client(Duration::from_secs(60), None)
        .map_err(|e| format!("Scrape Creators HTTP 客户端初始化失败：{e}"))
}
fn err(status: reqwest::StatusCode, body: &str) -> String {
    format!(
        "Scrape Creators 返回 HTTP {}：{}",
        status.as_u16(),
        body.chars().take(500).collect::<String>()
    )
}
fn text(v: &Value) -> String {
    match v {
        Value::String(s) => s.trim().to_string(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}
fn find(v: &Value, keys: &[&str]) -> String {
    match v {
        Value::Object(o) => keys
            .iter()
            .find_map(|k| o.get(*k).map(text).filter(|x| !x.is_empty()))
            .or_else(|| {
                o.values().find_map(|x| {
                    let y = find(x, keys);
                    (!y.is_empty()).then_some(y)
                })
            })
            .unwrap_or_default(),
        Value::Array(a) => a
            .iter()
            .find_map(|x| {
                let y = find(x, keys);
                (!y.is_empty()).then_some(y)
            })
            .unwrap_or_default(),
        _ => String::new(),
    }
}
fn endpoint(url: &str) -> Option<&'static str> {
    let x = url.to_lowercase();
    if x.contains("tiktok.com") {
        Some("/v2/tiktok/video")
    } else if x.contains("instagram.com") {
        Some("/v1/instagram/post")
    } else if x.contains("youtube.com") || x.contains("youtu.be") {
        Some("/v1/youtube/video")
    } else if x.contains("facebook.com") {
        Some("/v1/facebook/post")
    } else if x.contains("x.com") || x.contains("twitter.com") {
        Some("/v1/twitter/tweet")
    } else {
        None
    }
}
pub fn test_token(token: &str) -> Result<Value, String> {
    let response = client()?
        .get(format!("{BASE}/v1/account/credit-balance"))
        .header("x-api-key", token)
        .header("Accept", "application/json")
        .send()
        .map_err(|e| format!("Scrape Creators 连通性请求失败：{e}"))?;
    let status = response.status();
    let body = response.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(err(status, &body));
    }
    let value: Value = serde_json::from_str(&body)
        .map_err(|e| format!("Scrape Creators 响应不是有效 JSON：{e}"))?;
    Ok(
        json!({"creditCount":value.get("creditCount").cloned().unwrap_or(Value::Null),"success":true}),
    )
}
pub fn capture(token: &str, url: &str) -> Result<ScrapeCreatorsCapture, String> {
    let path = endpoint(url).ok_or("Scrape Creators 当前未配置该平台的单条链接接口".to_string())?;
    let endpoint = format!("{BASE}{path}");
    let mut request_url = reqwest::Url::parse(&endpoint).map_err(|e| e.to_string())?;
    request_url.query_pairs_mut().append_pair("url", url);
    let response = client()?
        .get(request_url)
        .header("x-api-key", token)
        .header("Accept", "application/json")
        .send()
        .map_err(|e| format!("Scrape Creators 采集请求失败：{e}"))?;
    let status = response.status();
    let code = status.as_u16();
    let body = response.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(err(status, &body));
    }
    let raw: Value = serde_json::from_str(&body)
        .map_err(|e| format!("Scrape Creators 响应不是有效 JSON：{e}"))?;
    let title = find(&raw, &["title", "name", "caption"]);
    let content = find(&raw, &["description", "text", "caption", "transcript"]);
    Ok(ScrapeCreatorsCapture {
        canonical: json!({"title":if title.is_empty(){url}else{&title},"description":content.chars().take(2000).collect::<String>(),"content":content,"webpage_url":url,"canonicalUrl":url,"contentType":"SOCIAL_POST","provider":"scrapecreators","providerEndpoint":path,"metrics":{}}),
        raw,
        endpoint,
        status_code: code,
    })
}
