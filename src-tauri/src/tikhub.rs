use serde_json::{json, Value};
use std::time::Duration;
use crate::provider_http;

const BASE: &str = "https://api.tikhub.io";

pub struct TikHubCapture {
    pub canonical: Value,
    pub raw: Value,
    pub endpoint: String,
    pub status_code: u16,
}

fn client() -> Result<reqwest::blocking::Client, String> {
    provider_http::client(Duration::from_secs(60), Some("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36"))
        .map_err(|e| format!("TikHub HTTP 客户端初始化失败：{e}"))
}
fn err(status: reqwest::StatusCode, body: &str) -> String {
    format!(
        "TikHub 返回 HTTP {}：{}",
        status.as_u16(),
        body.chars().take(500).collect::<String>()
    )
}
fn text(value: &Value) -> String {
    match value {
        Value::String(s) => s.trim().to_string(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}
fn find(value: &Value, keys: &[&str]) -> String {
    match value {
        Value::Object(o) => keys
            .iter()
            .find_map(|k| o.get(*k).map(text).filter(|v| !v.is_empty()))
            .or_else(|| {
                o.values().find_map(|v| {
                    let x = find(v, keys);
                    (!x.is_empty()).then_some(x)
                })
            })
            .unwrap_or_default(),
        Value::Array(a) => a
            .iter()
            .find_map(|v| {
                let x = find(v, keys);
                (!x.is_empty()).then_some(x)
            })
            .unwrap_or_default(),
        _ => String::new(),
    }
}
fn id_between(url: &str, marker: &str) -> Option<String> {
    url.split(marker)
        .nth(1)
        .map(|s| {
            s.split(['?', '&', '/', '#'])
                .next()
                .unwrap_or_default()
                .to_string()
        })
        .filter(|s| !s.is_empty())
}

pub fn test_token(token: &str) -> Result<Value, String> {
    let response = client()?
        .get(format!("{BASE}/api/v1/tikhub/user/get_user_info"))
        .bearer_auth(token)
        .header("Accept", "application/json")
        .send()
        .map_err(|e| format!("TikHub 连通性请求失败：{e}"))?;
    let status = response.status();
    let body = response.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(err(status, &body));
    }
    let value: Value =
        serde_json::from_str(&body).map_err(|e| format!("TikHub 响应不是有效 JSON：{e}"))?;
    Ok(json!({"username":find(&value,&["username","email"]),"status":"ok"}))
}

pub struct TikHubSearch {
    pub items: Vec<Value>,
    pub raw: Value,
    pub endpoint: String,
    pub status_code: u16,
}

fn field_text(value: &Value, key: &str) -> String {
    value.get(key).map(text).unwrap_or_default()
}

fn field_i64(value: &Value, key: &str) -> i64 {
    value.get(key).and_then(|item| match item {
        Value::Number(number) => number.as_i64(),
        Value::String(string) => string.parse::<i64>().ok(),
        _ => None,
    }).unwrap_or(0)
}

fn first_url(value: &Value) -> String {
    value.get("url_list")
        .and_then(Value::as_array)
        .and_then(|urls| urls.first())
        .map(text)
        .unwrap_or_default()
}

pub fn search_videos(token: &str, keyword: &str, period_days: i64) -> Result<TikHubSearch, String> {
    let period = match period_days {
        value if value <= 1 => 1,
        value if value <= 7 => 7,
        value if value <= 30 => 30,
        value if value <= 90 => 90,
        _ => 180,
    };
    let endpoint = format!("{BASE}/api/v1/tiktok/app/v3/fetch_general_search_result");
    let mut request_url = reqwest::Url::parse(&endpoint).map_err(|e| e.to_string())?;
    request_url.query_pairs_mut()
        .append_pair("keyword", keyword.trim())
        .append_pair("offset", "0")
        .append_pair("count", "20")
        .append_pair("sort_type", "1")
        .append_pair("publish_time", &period.to_string());
    let response = client()?
        .get(request_url.clone())
        .bearer_auth(token)
        .header("Accept", "application/json")
        .send()
        .map_err(|e| format!("TikHub 关键词搜索请求失败：{e}"))?;
    let status = response.status();
    let status_code = status.as_u16();
    let body = response.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(err(status, &body));
    }
    let raw: Value = serde_json::from_str(&body).map_err(|e| format!("TikHub 响应不是有效 JSON：{e}"))?;
    let code = raw.get("code").and_then(Value::as_i64).unwrap_or(200);
    if ![0, 200, 2000].contains(&code) {
        return Err(format!("TikHub {code}：{}", find(&raw, &["message_zh", "message", "error"])));
    }
    let items = raw.pointer("/data/data").and_then(Value::as_array).into_iter().flatten().filter_map(|item| {
        let aweme = item.get("aweme_info")?;
        let external_id = field_text(aweme, "aweme_id");
        if external_id.is_empty() { return None }
        let author = aweme.get("author").unwrap_or(&Value::Null);
        let username = field_text(author, "unique_id");
        let statistics = aweme.get("statistics").unwrap_or(&Value::Null);
        let cover = aweme.get("video").and_then(|video| video.get("cover")).map(first_url).unwrap_or_default();
        let canonical_url = if username.is_empty() { format!("https://www.tiktok.com/video/{external_id}") } else { format!("https://www.tiktok.com/@{username}/video/{external_id}") };
        Some(json!({
            "platformCode":"tiktok", "externalId":external_id, "contentType":"SOCIAL_POST",
            "title":field_text(aweme, "desc"), "description":field_text(aweme, "desc"), "content":field_text(aweme, "desc"),
            "author":field_text(author, "nickname"), "authorId":field_text(author, "uid"), "publishedAt":field_text(aweme, "create_time"),
            "canonicalUrl":canonical_url, "coverUrl":cover, "provider":"tikhub", "providerEndpoint":"/api/v1/tiktok/app/v3/fetch_general_search_result",
            "metrics":{"views":field_i64(statistics,"play_count"),"likes":field_i64(statistics,"digg_count"),"comments":field_i64(statistics,"comment_count"),"shares":field_i64(statistics,"share_count"),"saves":field_i64(statistics,"collect_count")}
        }))
    }).collect();
    Ok(TikHubSearch { items, raw, endpoint: request_url.into(), status_code })
}

pub fn capture(token: &str, url: &str) -> Result<TikHubCapture, String> {
    let lower = url.to_lowercase();
    let (path, key, value) = if lower.contains("douyin.com") {
        (
            "/api/v1/douyin/web/fetch_one_video_by_share_url",
            "share_url",
            url.to_string(),
        )
    } else if lower.contains("tiktok.com") {
        let id = id_between(url, "/video/").ok_or("无法从 TikTok 链接提取视频 ID".to_string())?;
        ("/api/v1/tiktok/web/fetch_post_detail", "itemId", id)
    } else if lower.contains("x.com") || lower.contains("twitter.com") {
        let id = id_between(url, "/status/").ok_or("无法从 X 链接提取推文 ID".to_string())?;
        ("/api/v1/twitter/web/fetch_tweet_detail", "tweet_id", id)
    } else if lower.contains("xiaohongshu.com") || lower.contains("xhslink.com") {
        let id = id_between(url, "/explore/").ok_or("无法从小红书链接提取笔记 ID".to_string())?;
        (
            "/api/v1/xiaohongshu/web_v3/fetch_note_detail",
            "note_id",
            id,
        )
    } else {
        return Err("TikHub 当前未配置该平台的单条链接接口".into());
    };
    let endpoint = format!("{BASE}{path}");
    let mut request_url = reqwest::Url::parse(&endpoint).map_err(|e| e.to_string())?;
    request_url.query_pairs_mut().append_pair(key, &value);
    let response = client()?
        .get(request_url)
        .bearer_auth(token)
        .header("Accept", "application/json")
        .send()
        .map_err(|e| format!("TikHub 采集请求失败：{e}"))?;
    let status = response.status();
    let code = status.as_u16();
    let body = response.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(err(status, &body));
    }
    let raw: Value =
        serde_json::from_str(&body).map_err(|e| format!("TikHub 响应不是有效 JSON：{e}"))?;
    let title = find(&raw, &["title", "desc", "description", "nickname"]);
    let content = find(&raw, &["content", "desc", "description", "text"]);
    Ok(TikHubCapture {
        canonical: json!({"title":if title.is_empty(){url}else{&title},"description":content.chars().take(2000).collect::<String>(),"content":content,"webpage_url":url,"canonicalUrl":url,"contentType":"SOCIAL_POST","provider":"tikhub","providerEndpoint":path,"metrics":{}}),
        raw,
        endpoint,
        status_code: code,
    })
}
