use serde_json::{json, Value};
use std::time::Duration;
use crate::provider_http;

const API_BASE: &str = "https://api.apify.com/v2";
const ACTOR: &str = "apify~website-content-crawler";

pub struct ApifyCapture {
    pub canonical: Value,
    pub raw: Value,
    pub endpoint: String,
    pub status_code: u16,
}

fn text(value: &Value) -> Option<String> {
    match value {
        Value::String(value) if !value.trim().is_empty() => Some(value.trim().to_string()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn find_value(value: &Value, keys: &[&str]) -> Option<Value> {
    match value {
        Value::Object(object) => {
            for key in keys {
                if let Some(found) = object.get(*key) {
                    if !found.is_null() {
                        return Some(found.clone());
                    }
                }
            }
            object.values().find_map(|child| find_value(child, keys))
        }
        Value::Array(values) => values.iter().find_map(|child| find_value(child, keys)),
        _ => None,
    }
}

fn find_text(value: &Value, keys: &[&str]) -> String {
    find_value(value, keys)
        .as_ref()
        .and_then(text)
        .unwrap_or_default()
}

fn client() -> Result<reqwest::blocking::Client, String> {
    provider_http::client(Duration::from_secs(75), None)
        .map_err(|error| format!("Apify HTTP 客户端初始化失败：{error}"))
}

fn response_error(status: reqwest::StatusCode, body: &str) -> String {
    let detail = body.chars().take(300).collect::<String>();
    format!("Apify 返回 HTTP {}：{}", status.as_u16(), detail)
}

pub fn test_token(token: &str) -> Result<Value, String> {
    let started = std::time::Instant::now();
    let response = client()?
        .get(format!("{API_BASE}/users/me"))
        .bearer_auth(token)
        .header("Accept", "application/json")
        .send()
        .map_err(|error| format!("Apify 连通性请求失败：{error}"))?;
    let status = response.status();
    let body = response.text().map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(response_error(status, &body));
    }
    let value: Value =
        serde_json::from_str(&body).map_err(|error| format!("Apify 响应不是有效 JSON：{error}"))?;
    let data = value.get("data").cloned().unwrap_or_default();
    Ok(json!({
        "id": data.get("id").cloned().unwrap_or(Value::Null),
        "username": data.get("username").cloned().unwrap_or(Value::Null),
        "latencyMs": started.elapsed().as_millis(),
    }))
}

pub fn capture(token: &str, url: &str) -> Result<ApifyCapture, String> {
    if url.trim().is_empty() {
        return Err("Apify 采集需要公开链接".into());
    }
    let endpoint = format!("{API_BASE}/acts/{ACTOR}/runs?waitForFinish=60");
    let run_response = client()?
        .post(&endpoint)
        .bearer_auth(token)
        .header("Accept", "application/json")
        .json(&json!({
            "startUrls": [{"url": url}],
            "maxCrawlPages": 1,
            "maxCrawlDepth": 0,
            "saveMarkdown": true
        }))
        .send()
        .map_err(|error| format!("Apify Actor 启动失败：{error}"))?;
    let status_code = run_response.status().as_u16();
    let status = run_response.status();
    let run_body = run_response.text().map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(response_error(status, &run_body));
    }
    let run: Value = serde_json::from_str(&run_body)
        .map_err(|error| format!("Apify Actor 响应不是有效 JSON：{error}"))?;
    let run_data = run.get("data").cloned().unwrap_or_default();
    let dataset_id = run_data
        .get("defaultDatasetId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or("Apify Actor 未返回 dataset ID".to_string())?;
    let dataset_endpoint =
        format!("{API_BASE}/datasets/{dataset_id}/items?clean=true&format=json&limit=1");
    let dataset_response = client()?
        .get(&dataset_endpoint)
        .bearer_auth(token)
        .header("Accept", "application/json")
        .send()
        .map_err(|error| format!("Apify Dataset 读取失败：{error}"))?;
    let dataset_status = dataset_response.status();
    let dataset_body = dataset_response.text().map_err(|error| error.to_string())?;
    if !dataset_status.is_success() {
        return Err(response_error(dataset_status, &dataset_body));
    }
    let items: Value = serde_json::from_str(&dataset_body)
        .map_err(|error| format!("Apify Dataset 响应不是有效 JSON：{error}"))?;
    let item = items
        .as_array()
        .and_then(|values| values.first())
        .cloned()
        .unwrap_or_default();
    if item.is_null() || item == json!({}) {
        return Err("Apify 未返回可用网页内容".into());
    }
    let title = find_text(&item, &["title", "name"]);
    let content = find_text(&item, &["markdown", "text", "content", "description"]);
    let canonical_url = find_text(&item, &["url", "canonicalUrl", "webpage_url"]);
    let canonical = json!({
        "title": if title.is_empty() { url } else { &title },
        "description": content.chars().take(2000).collect::<String>(),
        "content": content,
        "webpage_url": if canonical_url.is_empty() { url } else { &canonical_url },
        "canonicalUrl": if canonical_url.is_empty() { url } else { &canonical_url },
        "author": find_text(&item, &["author", "authorName"]),
        "publishedAt": find_text(&item, &["publishedAt", "datePublished"]),
        "coverUrl": find_text(&item, &["image", "imageUrl", "thumbnail"]),
        "contentType": "ARTICLE",
        "provider": "apify",
        "providerEndpoint": ACTOR,
        "externalId": dataset_id,
        "metrics": {}
    });
    Ok(ApifyCapture {
        canonical,
        raw: json!({"run": run, "items": items}),
        endpoint,
        status_code,
    })
}
