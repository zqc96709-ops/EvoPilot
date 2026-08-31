use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

pub struct CachedResearch {
    pub item_ids: Vec<String>,
    pub urls: Vec<String>,
}

fn ensure_column(connection: &Connection, table: &str, column: &str, definition: &str) -> Result<(), String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| error.to_string())?;
    let exists = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .any(|name| name == column);
    if !exists {
        connection
            .execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn migrate(connection: &Connection, applied_at: &str) -> Result<(), String> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS external_items (
           id TEXT PRIMARY KEY,
           platform TEXT NOT NULL,
           external_id TEXT,
           content_type TEXT NOT NULL,
           title TEXT NOT NULL DEFAULT '',
           content_excerpt TEXT NOT NULL DEFAULT '',
           author TEXT NOT NULL DEFAULT '',
           author_id TEXT NOT NULL DEFAULT '',
           canonical_url TEXT NOT NULL,
           cover_url TEXT NOT NULL DEFAULT '',
           published_at TEXT,
           captured_at TEXT NOT NULL,
           expires_at TEXT,
           provider TEXT NOT NULL,
           provider_item_id TEXT,
           content_hash TEXT NOT NULL,
           raw_payload_path TEXT,
           UNIQUE(platform, external_id),
           UNIQUE(canonical_url)
         );
         CREATE INDEX IF NOT EXISTS idx_external_items_platform_published ON external_items(platform, published_at DESC);
         CREATE INDEX IF NOT EXISTS idx_external_items_expires ON external_items(expires_at);
         CREATE INDEX IF NOT EXISTS idx_external_items_hash ON external_items(content_hash);
         CREATE TABLE IF NOT EXISTS external_observations (
           id TEXT PRIMARY KEY,
           item_id TEXT NOT NULL,
           observed_at TEXT NOT NULL,
           views INTEGER NOT NULL DEFAULT 0,
           likes INTEGER NOT NULL DEFAULT 0,
           comments INTEGER NOT NULL DEFAULT 0,
           shares INTEGER NOT NULL DEFAULT 0,
           saves INTEGER NOT NULL DEFAULT 0,
           followers INTEGER NOT NULL DEFAULT 0,
           provider TEXT NOT NULL,
           UNIQUE(item_id, observed_at),
           FOREIGN KEY(item_id) REFERENCES external_items(id) ON DELETE CASCADE
         );
         CREATE INDEX IF NOT EXISTS idx_external_observations_item_time ON external_observations(item_id, observed_at DESC);
         CREATE TABLE IF NOT EXISTS external_provider_calls (
           id TEXT PRIMARY KEY,
           provider TEXT NOT NULL,
           endpoint TEXT NOT NULL,
           source_id TEXT,
           called_at TEXT NOT NULL,
           success INTEGER NOT NULL,
           status_code INTEGER,
           estimated_cost_micros INTEGER NOT NULL DEFAULT 0,
           items_returned INTEGER NOT NULL DEFAULT 0,
           error_code TEXT,
           error_message TEXT
         );
         CREATE INDEX IF NOT EXISTS idx_external_provider_calls_time ON external_provider_calls(called_at DESC);
         CREATE INDEX IF NOT EXISTS idx_external_provider_calls_provider ON external_provider_calls(provider, called_at DESC);"
    ).map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (7, ?1)",
            params![applied_at],
        )
        .map_err(|error| error.to_string())?;
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS external_research_runs (
           id TEXT PRIMARY KEY,
           request_id TEXT,
           source_key TEXT NOT NULL,
           platform TEXT NOT NULL,
           capability TEXT NOT NULL,
           primary_provider TEXT NOT NULL,
           fallback_providers_json TEXT NOT NULL DEFAULT '[]',
           status TEXT NOT NULL,
           execution_status TEXT NOT NULL,
           cache_hit INTEGER NOT NULL DEFAULT 0,
           started_at TEXT NOT NULL,
           completed_at TEXT,
           error_message TEXT
         );
         CREATE INDEX IF NOT EXISTS idx_external_research_runs_request ON external_research_runs(request_id, started_at DESC);
         CREATE TABLE IF NOT EXISTS external_research_evidence (
           id TEXT PRIMARY KEY,
           research_run_id TEXT NOT NULL,
           item_id TEXT NOT NULL,
           provider TEXT NOT NULL,
           provider_endpoint TEXT NOT NULL,
           source_url TEXT NOT NULL,
           observed_at TEXT NOT NULL,
           UNIQUE(research_run_id, item_id, provider),
           FOREIGN KEY(research_run_id) REFERENCES external_research_runs(id) ON DELETE CASCADE,
           FOREIGN KEY(item_id) REFERENCES external_items(id) ON DELETE CASCADE
         );
         CREATE INDEX IF NOT EXISTS idx_external_research_evidence_run ON external_research_evidence(research_run_id);
         CREATE TABLE IF NOT EXISTS external_research_cache (
           fingerprint TEXT PRIMARY KEY,
           provider TEXT NOT NULL,
           platform TEXT NOT NULL,
           capability TEXT NOT NULL,
           item_ids_json TEXT NOT NULL,
           urls_json TEXT NOT NULL,
           created_at TEXT NOT NULL,
           expires_at TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_external_research_cache_expires ON external_research_cache(expires_at);
         INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (8, strftime('%s','now'));"
    ).map_err(|error| error.to_string())?;
    ensure_column(connection, "external_provider_calls", "research_run_id", "TEXT")?;
    ensure_column(connection, "external_provider_calls", "capability", "TEXT")?;
    ensure_column(connection, "external_provider_calls", "cache_hit", "INTEGER NOT NULL DEFAULT 0")?;
    Ok(())
}

fn value_text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string()
}

pub fn content_hash(canonical: &Value) -> String {
    let mut hasher = DefaultHasher::new();
    value_text(canonical, "platformCode").hash(&mut hasher);
    value_text(canonical, "title").hash(&mut hasher);
    value_text(canonical, "content").hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

pub fn upsert_item(
    connection: &Connection,
    id: &str,
    canonical: &Value,
    captured_at: &str,
    expires_at: &str,
    raw_payload_path: &str,
) -> Result<String, String> {
    let platform = value_text(canonical, "platformCode");
    let external_id = value_text(canonical, "externalId");
    let canonical_url = value_text(canonical, "canonicalUrl");
    let existing: Option<String> = if !external_id.is_empty() {
        connection
            .query_row(
                "SELECT id FROM external_items WHERE platform=?1 AND external_id=?2 LIMIT 1",
                params![platform, external_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
    } else {
        None
    };
    let existing = match existing {
        Some(value) => Some(value),
        None if !canonical_url.is_empty() => connection
            .query_row(
                "SELECT id FROM external_items WHERE canonical_url=?1 LIMIT 1",
                params![canonical_url],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?,
        None => None,
    };
    let item_id = existing.unwrap_or_else(|| id.to_string());
    let metrics = canonical
        .get("metrics")
        .cloned()
        .unwrap_or_else(|| json!({}));
    connection.execute(
        "INSERT INTO external_items(id,platform,external_id,content_type,title,content_excerpt,author,author_id,canonical_url,cover_url,published_at,captured_at,expires_at,provider,provider_item_id,content_hash,raw_payload_path)
         VALUES(?1,?2,NULLIF(?3,''),?4,?5,?6,?7,?8,?9,?10,NULLIF(?11,''),?12,?13,?14,NULLIF(?15,''),?16,?17)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title,content_excerpt=excluded.content_excerpt,author=excluded.author,author_id=excluded.author_id,cover_url=excluded.cover_url,published_at=excluded.published_at,captured_at=excluded.captured_at,expires_at=excluded.expires_at,provider=excluded.provider,content_hash=excluded.content_hash,raw_payload_path=excluded.raw_payload_path",
        params![
            item_id,
            value_text(canonical, "platformCode"),
            value_text(canonical, "externalId"),
            value_text(canonical, "contentType"),
            value_text(canonical, "title"),
            value_text(canonical, "content"),
            value_text(canonical, "author"),
            value_text(canonical, "authorId"),
            value_text(canonical, "canonicalUrl"),
            value_text(canonical, "coverUrl"),
            value_text(canonical, "publishedAt"),
            captured_at,
            expires_at,
            value_text(canonical, "provider"),
            value_text(canonical, "externalId"),
            content_hash(canonical),
            raw_payload_path,
        ],
    ).map_err(|error| error.to_string())?;
    connection.execute(
        "INSERT OR IGNORE INTO external_observations(id,item_id,observed_at,views,likes,comments,shares,saves,followers,provider) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            format!("observation-{item_id}-{captured_at}"), item_id, captured_at,
            metrics["views"].as_i64().unwrap_or(0), metrics["likes"].as_i64().unwrap_or(0),
            metrics["comments"].as_i64().unwrap_or(0), metrics["shares"].as_i64().unwrap_or(0),
            metrics["saves"].as_i64().unwrap_or(0), metrics["followers"].as_i64().unwrap_or(0),
            value_text(canonical, "provider")
        ],
    ).map_err(|error| error.to_string())?;
    Ok(item_id)
}

pub fn record_provider_call(
    connection: &Connection,
    id: &str,
    provider: &str,
    endpoint: &str,
    source_id: Option<&str>,
    called_at: &str,
    success: bool,
    status_code: Option<u16>,
    items_returned: i64,
    error_message: Option<&str>,
) -> Result<(), String> {
    record_provider_call_with_context(
        connection,
        id,
        provider,
        endpoint,
        source_id,
        called_at,
        success,
        status_code,
        items_returned,
        error_message,
        None,
        None,
        false,
    )
}

pub fn record_provider_call_with_context(
    connection: &Connection,
    id: &str,
    provider: &str,
    endpoint: &str,
    source_id: Option<&str>,
    called_at: &str,
    success: bool,
    status_code: Option<u16>,
    items_returned: i64,
    error_message: Option<&str>,
    research_run_id: Option<&str>,
    capability: Option<&str>,
    cache_hit: bool,
) -> Result<(), String> {
    connection.execute(
        "INSERT INTO external_provider_calls(id,provider,endpoint,source_id,called_at,success,status_code,estimated_cost_micros,items_returned,error_message,research_run_id,capability,cache_hit) VALUES(?1,?2,?3,?4,?5,?6,?7,0,?8,?9,?10,?11,?12)",
        params![id, provider, endpoint, source_id, called_at, success as i64, status_code, items_returned, error_message, research_run_id, capability, cache_hit as i64],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

pub fn research_fingerprint(provider: &str, platform: &str, capability: &str, params: &Value) -> String {
    let mut hasher = DefaultHasher::new();
    provider.hash(&mut hasher);
    platform.hash(&mut hasher);
    capability.hash(&mut hasher);
    params.to_string().hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

pub fn cached_research(connection: &Connection, fingerprint: &str, current: &str) -> Result<Option<CachedResearch>, String> {
    connection.query_row(
        "SELECT item_ids_json,urls_json FROM external_research_cache WHERE fingerprint=?1 AND CAST(expires_at AS INTEGER) >= CAST(?2 AS INTEGER)",
        params![fingerprint, current],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    ).optional().map_err(|error| error.to_string())?.map(|(items, urls)| {
        Ok(CachedResearch {
            item_ids: serde_json::from_str(&items).map_err(|error| error.to_string())?,
            urls: serde_json::from_str(&urls).map_err(|error| error.to_string())?,
        })
    }).transpose()
}

pub fn cache_research(
    connection: &Connection,
    fingerprint: &str,
    provider: &str,
    platform: &str,
    capability: &str,
    item_ids: &[String],
    urls: &[String],
    created_at: &str,
    expires_at: &str,
) -> Result<(), String> {
    connection.execute(
        "INSERT INTO external_research_cache(fingerprint,provider,platform,capability,item_ids_json,urls_json,created_at,expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(fingerprint) DO UPDATE SET item_ids_json=excluded.item_ids_json,urls_json=excluded.urls_json,created_at=excluded.created_at,expires_at=excluded.expires_at",
        params![fingerprint, provider, platform, capability, serde_json::to_string(item_ids).map_err(|error| error.to_string())?, serde_json::to_string(urls).map_err(|error| error.to_string())?, created_at, expires_at],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

pub fn start_research_run(
    connection: &Connection,
    id: &str,
    request_id: Option<&str>,
    source_key: &str,
    platform: &str,
    capability: &str,
    primary_provider: &str,
    fallback_providers: &[String],
    started_at: &str,
) -> Result<(), String> {
    connection.execute(
        "INSERT INTO external_research_runs(id,request_id,source_key,platform,capability,primary_provider,fallback_providers_json,status,execution_status,started_at) VALUES(?1,?2,?3,?4,?5,?6,?7,'RUNNING','RUNNING',?8)",
        params![id, request_id, source_key, platform, capability, primary_provider, serde_json::to_string(fallback_providers).map_err(|error| error.to_string())?, started_at],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

pub fn finish_research_run(
    connection: &Connection,
    id: &str,
    status: &str,
    cache_hit: bool,
    completed_at: &str,
    error_message: Option<&str>,
) -> Result<(), String> {
    connection.execute(
        "UPDATE external_research_runs SET status=?2,execution_status=?2,cache_hit=?3,completed_at=?4,error_message=?5 WHERE id=?1",
        params![id, status, cache_hit as i64, completed_at, error_message],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

pub fn attach_research_evidence(
    connection: &Connection,
    id: &str,
    research_run_id: &str,
    item_id: &str,
    provider: &str,
    provider_endpoint: &str,
    source_url: &str,
    observed_at: &str,
) -> Result<(), String> {
    connection.execute(
        "INSERT OR IGNORE INTO external_research_evidence(id,research_run_id,item_id,provider,provider_endpoint,source_url,observed_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![id, research_run_id, item_id, provider, provider_endpoint, source_url, observed_at],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

pub fn research_evidence_count(connection: &Connection, research_run_id: &str) -> Result<i64, String> {
    connection.query_row(
        "SELECT COUNT(*) FROM external_research_evidence WHERE research_run_id=?1",
        params![research_run_id],
        |row| row.get(0),
    ).map_err(|error| error.to_string())
}

pub fn list_items(connection: &Connection, limit: i64) -> Result<Vec<Value>, String> {
    let mut statement = connection.prepare(
        "SELECT i.id,i.platform,i.external_id,i.content_type,i.title,i.content_excerpt,i.author,i.canonical_url,i.cover_url,i.published_at,i.captured_at,i.expires_at,i.provider,
                COALESCE(o.views,0),COALESCE(o.likes,0),COALESCE(o.comments,0),COALESCE(o.shares,0),COALESCE(o.saves,0)
         FROM external_items i LEFT JOIN external_observations o ON o.id=(SELECT id FROM external_observations WHERE item_id=i.id ORDER BY observed_at DESC LIMIT 1)
         ORDER BY i.captured_at DESC LIMIT ?1"
    ).map_err(|error| error.to_string())?;
    let rows = statement.query_map(params![limit.clamp(1, 200)], |row| Ok(json!({
        "id": row.get::<_,String>(0)?, "platform": row.get::<_,String>(1)?, "externalId": row.get::<_,Option<String>>(2)?,
        "contentType": row.get::<_,String>(3)?, "title": row.get::<_,String>(4)?, "content": row.get::<_,String>(5)?,
        "author": row.get::<_,String>(6)?, "canonicalUrl": row.get::<_,String>(7)?, "coverUrl": row.get::<_,String>(8)?,
        "publishedAt": row.get::<_,Option<String>>(9)?, "capturedAt": row.get::<_,String>(10)?, "expiresAt": row.get::<_,Option<String>>(11)?,
        "provider": row.get::<_,String>(12)?, "metrics": {"views":row.get::<_,i64>(13)?,"likes":row.get::<_,i64>(14)?,"comments":row.get::<_,i64>(15)?,"shares":row.get::<_,i64>(16)?,"saves":row.get::<_,i64>(17)?}
    }))).map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub fn cleanup_expired(connection: &Connection, now: &str) -> Result<i64, String> {
    connection
        .execute(
            "DELETE FROM external_items WHERE expires_at IS NOT NULL AND CAST(expires_at AS INTEGER) < CAST(?1 AS INTEGER)",
            params![now],
        )
        .map(|count| count as i64)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);").unwrap();
        migrate(&connection, "1").unwrap();
        connection
    }

    #[test]
    fn migration_v7_creates_required_tables_and_indexes() {
        let connection = db();
        for name in [
            "external_items",
            "external_observations",
            "external_provider_calls",
            "idx_external_items_platform_published",
            "idx_external_items_expires",
            "idx_external_items_hash",
            "idx_external_observations_item_time",
            "idx_external_provider_calls_time",
            "idx_external_provider_calls_provider",
        ] {
            let count: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE name=?1",
                    params![name],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "missing migration object: {name}");
        }
        let version: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version=7",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, 1);
    }

    #[test]
    fn stores_items_without_duplicate_urls() {
        let connection = db();
        let canonical = json!({"platformCode":"douyin","externalId":"123","contentType":"VIDEO_POST","title":"Title","content":"Text","canonicalUrl":"https://douyin.com/video/123","provider":"redfox","metrics":{"views":10}});
        let first =
            upsert_item(&connection, "item-1", &canonical, "100", "200", "/tmp/raw").unwrap();
        let second =
            upsert_item(&connection, "item-2", &canonical, "110", "210", "/tmp/raw2").unwrap();
        assert_eq!(first, second);
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM external_items", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn removes_only_expired_cache_items() {
        let connection = db();
        let a = json!({"platformCode":"douyin","externalId":"a","contentType":"VIDEO_POST","title":"A","canonicalUrl":"https://a","provider":"redfox"});
        let b = json!({"platformCode":"douyin","externalId":"b","contentType":"VIDEO_POST","title":"B","canonicalUrl":"https://b","provider":"redfox"});
        upsert_item(&connection, "a", &a, "1", "5", "").unwrap();
        upsert_item(&connection, "b", &b, "1", "50", "").unwrap();
        assert_eq!(cleanup_expired(&connection, "10").unwrap(), 1);
    }

    #[test]
    fn research_cache_and_evidence_keep_provenance_by_run() {
        let connection = db();
        let canonical = json!({"platformCode":"tiktok","externalId":"123","contentType":"SOCIAL_POST","title":"Title","canonicalUrl":"https://tiktok.com/@a/video/123","provider":"tikhub"});
        let item_id = upsert_item(&connection, "item-1", &canonical, "100", "200", "/tmp/raw").unwrap();
        start_research_run(&connection, "run-1", Some("request-1"), "planned:tiktok-video-search", "TikTok", "VIDEO_SEARCH", "tikhub", &[], "100").unwrap();
        attach_research_evidence(&connection, "evidence-1", "run-1", &item_id, "tikhub", "endpoint", "https://tiktok.com/@a/video/123", "100").unwrap();
        finish_research_run(&connection, "run-1", "COMPLETED", false, "101", None).unwrap();
        let fingerprint = research_fingerprint("tikhub", "TikTok", "VIDEO_SEARCH", &json!({"query":"plus size","periodDays":30}));
        cache_research(&connection, &fingerprint, "tikhub", "TikTok", "VIDEO_SEARCH", &[item_id.clone()], &["https://tiktok.com/@a/video/123".into()], "100", "200").unwrap();
        let cached = cached_research(&connection, &fingerprint, "150").unwrap().unwrap();
        assert_eq!(cached.item_ids, vec![item_id]);
        assert_eq!(research_evidence_count(&connection, "run-1").unwrap(), 1);
    }
}
