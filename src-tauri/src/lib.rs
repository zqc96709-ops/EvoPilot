mod apify;
mod decision_intelligence;
mod external_intelligence;
mod finance;
mod mental_models;
mod provider_http;
mod redfox;
mod scrapecreators;
mod tikhub;

use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    hash::{Hash, Hasher},
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

static ID_SEQUENCE: AtomicU64 = AtomicU64::new(0);
const LOCAL_NOTEBOOK_OWNER: &str = "local-user";
const NOTEBOOK_ENTITIES: &[&str] = &[
    "notes",
    "notebookCategories",
    "notebookFolders",
    "notebookFiles",
];
const NOTEBOOK_CONTENT_ENTITIES: &[&str] = &["notes", "notebookFiles", "inbox"];
const SCHEMA_VERSION: i64 = 18;
const NOTEBOOK_MAX_FILE_SIZE: u64 = 1024 * 1024 * 1024;
const NOTEBOOK_CHUNK_SIZE: usize = 2 * 1024 * 1024;
const NOTEBOOK_EXTRACT_LIMIT: usize = 1_500_000;
const WORKSPACE_DOCUMENT_LIMIT: u64 = 2 * 1024 * 1024;

const ENTITIES: &[&str] = &[
    "goals",
    "keyResults",
    "projects",
    "projectMilestones",
    "tasks",
    "hypotheses",
    "experiments",
    "timeLogs",
    "results",
    "deliverables",
    "resultPackages",
    "workflows",
    "workflowVersions",
    "workflowSteps",
    "workflowGates",
    "workflowRuns",
    "workflowRunSteps",
    "workflowMetricDefinitions",
    "workflowImprovementProposals",
    "reviews",
    "knowledge",
    "insights",
    "principles",
    "mentalModels",
    "mentalModelUsages",
    "decisions",
    "notes",
    "notebookCategories",
    "notebookFolders",
    "notebookFiles",
    "inbox",
    "events",
    "people",
    "dataRecords",
    "attachments",
    "timelineEvents",
    "agentRuns",
    "agentActions",
    "externalSources",
    "signals",
    "opportunities",
    "intelligenceBriefs",
    "researchThreads",
    "researchRequests",
    "researchRuns",
    "researchResults",
    "researchFindings",
    "financialAccounts",
    "financialCategories",
    "financialTransactions",
    "financialTransactionAllocations",
    "financialBudgets",
    "decisionFrameworks",
    "ceoPrinciples",
    "decisionLenses",
    "profiles",
];

fn now() -> String {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{ms}")
}

fn new_id(entity: &str) -> String {
    format!(
        "{}-{}-{}",
        entity,
        now(),
        ID_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    )
}

fn is_entity(entity: &str) -> bool {
    ENTITIES.contains(&entity)
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = std::env::var_os("JASON_OS_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or(app.path().app_data_dir().map_err(|e| e.to_string())?);
    fs::create_dir_all(dir.join("attachments")).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("notebook-files")).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("exports")).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("backups")).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("external-intelligence/raw")).map_err(|e| e.to_string())?;
    Ok(dir)
}

const TIMELINE_SOURCE_ENTITIES: &[&str] = &[
    "goals",
    "projects",
    "tasks",
    "timeLogs",
    "events",
    "results",
    "deliverables",
    "resultPackages",
    "workflows",
    "workflowVersions",
    "workflowSteps",
    "workflowGates",
    "workflowRuns",
    "workflowRunSteps",
    "workflowImprovementProposals",
    "reviews",
    "insights",
    "decisions",
    "signals",
    "opportunities",
    "intelligenceBriefs",
    "researchRuns",
    "researchResults",
    "financialTransactions",
    "timelineEvents",
];

fn timeline_text(data: &Value, key: &str) -> Option<String> {
    data.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn first_timeline_value(data: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| timeline_text(data, key))
}

fn timeline_semantics(
    entity: &str,
    data: &Value,
    created_at: &str,
    updated_at: &str,
) -> (String, &'static str) {
    match entity {
        "timeLogs" => (
            first_timeline_value(data, &["startAt"]).unwrap_or_else(|| created_at.into()),
            "actual",
        ),
        "events" => (
            first_timeline_value(data, &["startAt"]).unwrap_or_else(|| created_at.into()),
            "planned",
        ),
        "decisions" => (
            first_timeline_value(data, &["date", "decisionDate"])
                .unwrap_or_else(|| created_at.into()),
            "recorded",
        ),
        "results" => (
            first_timeline_value(data, &["date", "completedAt"])
                .unwrap_or_else(|| created_at.into()),
            "actual",
        ),
        "deliverables" => (
            first_timeline_value(data, &["finalizedAt", "createdAt"]).unwrap_or_else(|| created_at.into()),
            "actual",
        ),
        "workflowRuns" => (
            first_timeline_value(data, &["startedAt", "completedAt"]).unwrap_or_else(|| created_at.into()),
            "actual",
        ),
        "workflowRunSteps" => (
            first_timeline_value(data, &["startedAt", "completedAt"]).unwrap_or_else(|| created_at.into()),
            "actual",
        ),
        "signals" => (
            first_timeline_value(data, &["detectedAt"]).unwrap_or_else(|| created_at.into()),
            "recorded",
        ),
        "intelligenceBriefs" => (
            first_timeline_value(data, &["generatedAt"]).unwrap_or_else(|| created_at.into()),
            "recorded",
        ),
        "financialTransactions" => (
            first_timeline_value(data, &["occurredAt"]).unwrap_or_else(|| created_at.into()),
            "actual",
        ),
        "tasks" if data.get("status").and_then(Value::as_str) == Some("completed") => (
            first_timeline_value(data, &["completedAt"]).unwrap_or_else(|| updated_at.into()),
            "actual",
        ),
        "tasks" => first_timeline_value(data, &["dueAt", "dueDate"])
            .map(|value| (value, "planned"))
            .unwrap_or_else(|| (created_at.into(), "recorded")),
        "timelineEvents" => (
            first_timeline_value(data, &["occurredAt"]).unwrap_or_else(|| created_at.into()),
            "actual",
        ),
        _ => (created_at.into(), "recorded"),
    }
}

fn timeline_time_zone(value: &str) -> &'static str {
    if value.chars().all(|character| character.is_ascii_digit()) || value.ends_with('Z') {
        "UTC"
    } else if value.rfind(['+', '-']).is_some_and(|index| index > 9) {
        "offset"
    } else {
        "local"
    }
}

fn timeline_precision(value: &str) -> &'static str {
    if value.len() == 10 && value.chars().nth(4) == Some('-') && value.chars().nth(7) == Some('-') {
        "date"
    } else {
        "datetime"
    }
}

fn timeline_importance(entity: &str, data: &Value) -> &'static str {
    if data.get("timelineImportance").and_then(Value::as_str) == Some("key") {
        return "key";
    }
    if [
        "decisions",
        "results",
        "deliverables",
        "resultPackages",
        "workflowRuns",
        "workflowImprovementProposals",
        "reviews",
        "insights",
        "signals",
        "opportunities",
        "intelligenceBriefs",
    ]
    .contains(&entity)
    {
        return "key";
    }
    if entity == "projects"
        && (["blocked", "completed"]
            .contains(&data.get("status").and_then(Value::as_str).unwrap_or(""))
            || ["at_risk", "blocked"]
                .contains(&data.get("health").and_then(Value::as_str).unwrap_or("")))
    {
        return "key";
    }
    if entity == "goals"
        && ["completed", "paused"]
            .contains(&data.get("status").and_then(Value::as_str).unwrap_or(""))
    {
        return "key";
    }
    if entity == "tasks"
        && data.get("status").and_then(Value::as_str) == Some("completed")
        && (data.get("priority").and_then(Value::as_str) == Some("high")
            || data.get("importance").and_then(Value::as_str) == Some("important"))
    {
        return "key";
    }
    "normal"
}

fn timeline_evidence_level(entity: &str, data: &Value) -> &'static str {
    match data.get("evidenceLevel").and_then(Value::as_str) {
        Some("REALITY") => return "REALITY",
        Some("USER_CONFIRMED") => return "USER_CONFIRMED",
        Some("AI_CONFIRMED") => return "AI_CONFIRMED",
        Some("AI_SUGGESTION") => return "AI_SUGGESTION",
        _ => {}
    }
    if ["timeLogs", "results", "timelineEvents"].contains(&entity) {
        "REALITY"
    } else if data.get("agentActionId").and_then(Value::as_str).is_some() {
        "AI_CONFIRMED"
    } else {
        "USER_CONFIRMED"
    }
}

fn apply_timeline_metadata(
    entity: &str,
    data: &Value,
    created_at: &str,
    updated_at: &str,
) -> Value {
    if !TIMELINE_SOURCE_ENTITIES.contains(&entity) {
        return data.clone();
    }
    let mut enriched = data.clone();
    if !enriched.is_object() {
        enriched = json!({});
    }
    let (occurred_at, meaning) = timeline_semantics(entity, &enriched, created_at, updated_at);
    let importance = timeline_importance(entity, &enriched);
    let evidence = timeline_evidence_level(entity, &enriched);
    let object = enriched.as_object_mut().unwrap();
    object.insert("occurredAt".into(), Value::String(occurred_at.clone()));
    object.insert("timeMeaning".into(), Value::String(meaning.into()));
    object.insert(
        "timeZone".into(),
        Value::String(timeline_time_zone(&occurred_at).into()),
    );
    object.insert(
        "timePrecision".into(),
        Value::String(timeline_precision(&occurred_at).into()),
    );
    object.insert(
        "timelineImportance".into(),
        Value::String(importance.into()),
    );
    object.insert("evidenceLevel".into(), Value::String(evidence.into()));
    enriched
}

fn timeline_change_specs(entity: &str, before: &Value, after: &Value) -> Vec<Value> {
    let mut changes = Vec::new();
    let mut add = |field: &str, event_type: &str, title: &str, importance: &str| {
        let old = before.get(field).cloned().unwrap_or(Value::Null);
        let new = after.get(field).cloned().unwrap_or(Value::Null);
        if old != new {
            changes.push(json!({"field":field,"eventType":event_type,"title":title,"beforeValue":old,"afterValue":new,"timelineImportance":importance}));
        }
    };
    match entity {
        "goals" => add("status", "goal_status_changed", "目标状态发生变化", "key"),
        "projects" => {
            add(
                "status",
                "project_status_changed",
                "项目状态发生变化",
                "key",
            );
            add(
                "health",
                "project_health_changed",
                "项目健康度发生变化",
                "key",
            );
            add(
                "blockers",
                "project_blockers_changed",
                "项目阻塞发生变化",
                "key",
            );
        }
        "tasks" => {
            add(
                "status",
                "task_status_changed",
                "任务状态发生变化",
                if after.get("status").and_then(Value::as_str) == Some("completed") {
                    "key"
                } else {
                    "normal"
                },
            );
            add(
                "dueDate",
                "task_due_date_changed",
                "任务截止日期发生变化",
                "normal",
            );
            add(
                "dueAt",
                "task_due_time_changed",
                "任务具体时间发生变化",
                "normal",
            );
        }
        "results" => {
            add("status", "result_status_changed", "成果状态发生变化", "key");
            add("evidenceStatus", "result_validation_changed", "成果验证状态发生变化", "key");
            add("valueClassification", "result_value_classification_changed", "成果价值分类发生变化", "key");
        }
        "workflowRuns" => {
            add("status", "workflow_run_status_changed", "工作链运行状态发生变化", "key");
        }
        "workflowRunSteps" => {
            add("status", "workflow_step_status_changed", "工作链步骤状态发生变化", "normal");
        }
        "workflowVersions" => {
            add("maturity", "workflow_version_maturity_changed", "工作链版本成熟度发生变化", "key");
        }
        "deliverables" => {
            add("status", "deliverable_status_changed", "成果资产版本状态发生变化", "key");
        }
        "workflowImprovementProposals" => {
            add("status", "workflow_improvement_status_changed", "工作链改进提案状态发生变化", "key");
        }
        "decisions" => {
            add("status", "decision_status_changed", "决策状态发生变化", "key");
            add("choiceStatus", "decision_choice_changed", "决策选择状态发生变化", "key");
            add("executionStatus", "decision_execution_changed", "决策执行状态发生变化", "key");
            add("validationStatus", "decision_validation_changed", "决策校准结论发生变化", "key");
            add("riskLevel", "decision_risk_changed", "决策风险等级发生变化", "key");
        }
        "signals" => add(
            "status",
            "signal_status_changed",
            "外部信号状态发生变化",
            "key",
        ),
        "opportunities" => add(
            "status",
            "opportunity_status_changed",
            "机会状态发生变化",
            "key",
        ),
        _ => {}
    }
    changes
}

fn timeline_event_key(source_id: &str, change: &Value) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    source_id.hash(&mut hasher);
    change.to_string().hash(&mut hasher);
    format!("timeline:{:016x}", hasher.finish())
}

fn write_timeline_change_events(
    connection: &Connection,
    entity: &str,
    source_id: &str,
    before: Option<&Value>,
    after: &Value,
) -> Result<(), String> {
    if entity == "timelineEvents" {
        return Ok(());
    }
    let Some(before) = before else {
        return Ok(());
    };
    for change in timeline_change_specs(entity, before, after) {
        let key = timeline_event_key(source_id, &change);
        let exists: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM records WHERE entity='timelineEvents' AND deleted_at IS NULL AND json_extract(data_json,'$.timelineEventKey')=?1)", params![key], |row| row.get(0)).map_err(|error| error.to_string())?;
        if exists {
            continue;
        }
        let occurred_at = now();
        let mut event = json!({
            "title": change["title"], "eventType": change["eventType"], "occurredAt": occurred_at,
            "timeMeaning": "actual", "timeZone": "UTC", "timePrecision": "datetime",
            "timelineImportance": change["timelineImportance"], "evidenceLevel": "REALITY",
            "sourceEntityType": entity, "sourceEntityId": source_id, "timelineEventKey": key,
            "beforeValue": change["beforeValue"], "afterValue": change["afterValue"]
        });
        if let Some(object) = event.as_object_mut() {
            for field in [
                "goalId",
                "projectId",
                "taskId",
                "workflowRunId",
                "workflowVersionId",
                "resultId",
                "deliverableId",
            ] {
                if let Some(value) = after.get(field).and_then(Value::as_str) {
                    object.insert(field.into(), Value::String(value.into()));
                }
            }
            if entity == "goals" {
                object.insert("goalId".into(), Value::String(source_id.into()));
            }
            if entity == "projects" {
                object.insert("projectId".into(), Value::String(source_id.into()));
            }
            if entity == "tasks" {
                object.insert("taskId".into(), Value::String(source_id.into()));
            }
        }
        let id = new_id("timelineEvents");
        let saved = write_record(
            connection,
            "timelineEvents",
            &id,
            &event,
            Some(&occurred_at),
        )?;
        sync_relations(connection, &id, &saved)?;
    }
    Ok(())
}

fn db(app: &AppHandle) -> Result<Connection, String> {
    let connection =
        Connection::open(data_dir(app)?.join("jason-os.sqlite3")).map_err(|e| e.to_string())?;
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS records (
               id TEXT PRIMARY KEY,
               entity TEXT NOT NULL,
               data_json TEXT NOT NULL,
               title TEXT NOT NULL DEFAULT '',
               body TEXT NOT NULL DEFAULT '',
               created_at TEXT NOT NULL,
               updated_at TEXT NOT NULL,
               archived_at TEXT,
               deleted_at TEXT,
               CHECK (entity <> '')
             );
             CREATE INDEX IF NOT EXISTS idx_records_entity_updated ON records(entity, updated_at DESC);
             CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(id UNINDEXED, entity UNINDEXED, title, body, tokenize='unicode61');
             CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS relations (
               id TEXT PRIMARY KEY,
               from_id TEXT NOT NULL,
               to_id TEXT NOT NULL,
               relation_type TEXT NOT NULL,
               created_at TEXT NOT NULL,
               UNIQUE(from_id, to_id, relation_type),
               FOREIGN KEY(from_id) REFERENCES records(id) ON DELETE CASCADE,
               FOREIGN KEY(to_id) REFERENCES records(id) ON DELETE CASCADE
             );
             CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_id, relation_type);
             CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_id, relation_type);
             INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, strftime('%s','now'));
             INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, strftime('%s','now'));
            ",
        )
        .map_err(|e| e.to_string())?;
    ensure_column(&connection, "records", "archived_at", "TEXT")?;
    ensure_column(&connection, "records", "deleted_at", "TEXT")?;
    connection
        .execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_records_active ON records(entity, archived_at, deleted_at, updated_at DESC);
             INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (3, strftime('%s','now'));",
        )
        .map_err(|e| e.to_string())?;
    let relations_backfilled: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=4)",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !relations_backfilled {
        let rows = {
            let mut statement = connection
                .prepare("SELECT id, data_json FROM records WHERE deleted_at IS NULL")
                .map_err(|e| e.to_string())?;
            let mapped = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| e.to_string())?;
            mapped
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        for (id, raw) in rows {
            if let Ok(data) = serde_json::from_str::<Value>(&raw) {
                sync_relations(&connection, &id, &data)?;
            }
        }
        connection
            .execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (4, ?1)",
                params![now()],
            )
            .map_err(|e| e.to_string())?;
    }
    let relationships_repaired: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=5)",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !relationships_repaired {
        let rows = all_records(&connection)?;
        for record in rows {
            let entity = record["entity"].as_str().unwrap_or("");
            let id = record["id"].as_str().unwrap_or("");
            if entity.is_empty() || id.is_empty() {
                continue;
            }
            let normalized = normalize_record(&connection, entity, &record, false)?;
            let created = record["createdAt"].as_str();
            write_record(&connection, entity, id, &normalized, created)?;
            sync_relations(&connection, id, &normalized)?;
        }
        connection
            .execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (5, ?1)",
                params![now()],
            )
            .map_err(|e| e.to_string())?;
    }
    let timeline_backfilled: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=6)",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if !timeline_backfilled {
        let rows = {
            let mut statement = connection.prepare("SELECT id, entity, data_json, created_at, updated_at FROM records WHERE deleted_at IS NULL").map_err(|error| error.to_string())?;
            let mapped = statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                })
                .map_err(|error| error.to_string())?;
            mapped
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?
        };
        for (id, entity, raw, created_at, updated_at) in rows {
            if !TIMELINE_SOURCE_ENTITIES.contains(&entity.as_str()) {
                continue;
            }
            let data = serde_json::from_str::<Value>(&raw).unwrap_or_else(|_| json!({}));
            let enriched = apply_timeline_metadata(&entity, &data, &created_at, &updated_at);
            if enriched != data {
                connection
                    .execute(
                        "UPDATE records SET data_json=?2 WHERE id=?1",
                        params![
                            id,
                            serde_json::to_string(&enriched).map_err(|error| error.to_string())?
                        ],
                    )
                    .map_err(|error| error.to_string())?;
            }
        }
        connection
            .execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (6, ?1)",
                params![now()],
            )
            .map_err(|error| error.to_string())?;
    }
    external_intelligence::migrate(&connection, &now())?;
    finance::migrate(&connection, &now())?;
    mental_models::migrate(&connection, &now())?;
    mental_models::migrate_followups(&connection, &now())?;
    decision_intelligence::migrate(&connection, &now())?;
    connection.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_records_work_chain ON records(entity, updated_at DESC);
         INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (7, strftime('%s','now'));",
    ).map_err(|error| error.to_string())?;
    let research_result_architecture_migrated: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=13)",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if !research_result_architecture_migrated {
        migrate_research_result_architecture(&connection)?;
        connection
            .execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (13, ?1)",
                params![now()],
            )
            .map_err(|error| error.to_string())?;
    }
    finance::migrate_allocations(&connection, &now())?;
    finance::migrate_budgets(&connection, &now())?;
    migrate_sync_v1(&connection)?;
    migrate_image_persistence(&connection, app)?;
    repair_referenced_notebook_file_tombstones(&connection)?;
    migrate_notebook_category_ownership(&connection)?;
    Ok(connection)
}

fn unsafe_image_reference_type(value: &str) -> Option<&'static str> {
    let value = value.trim().to_lowercase();
    if value.starts_with("blob:") {
        Some("blob")
    } else if value.starts_with("file:") || value.contains("/tmp/") || value.contains("/var/folders/") {
        Some("temporary-file")
    } else if value.contains("localhost") || value.contains("127.0.0.1") {
        Some("localhost")
    } else if value.contains("x-amz-signature=") || value.contains("x-amz-credential=") {
        Some("presigned-url")
    } else {
        None
    }
}

fn repair_unsafe_note_image_html(html: &str) -> (String, usize) {
    let image = Regex::new(r"(?is)<img\b[^>]*>").expect("image regex");
    let double_src = Regex::new(r#"(?is)\bsrc\s*=\s*"([^"]*)""#).expect("double src regex");
    let single_src = Regex::new(r"(?is)\bsrc\s*=\s*'([^']*)'").expect("single src regex");
    let mut repaired = 0;
    let result = image.replace_all(html, |capture: &regex::Captures<'_>| {
        let tag = capture.get(0).map(|value| value.as_str()).unwrap_or("");
        let found = double_src
            .captures(tag)
            .and_then(|value| value.get(1).map(|src| (double_src.clone(), src.as_str().to_string())))
            .or_else(|| single_src.captures(tag).and_then(|value| value.get(1).map(|src| (single_src.clone(), src.as_str().to_string()))));
        let Some((source_regex, source)) = found else { return tag.to_string() };
        let Some(reference_type) = unsafe_image_reference_type(&source) else { return tag.to_string() };
        repaired += 1;
        let fingerprint = format!("{:x}", Sha256::digest(source.as_bytes()));
        let without_source = source_regex.replace(tag, "");
        format!("{} data-jason-missing-asset=\"true\" data-jason-original-reference-type=\"{}\" data-jason-missing-reference-hash=\"{}\">", without_source.trim_end_matches('>').trim_end(), reference_type, fingerprint)
    });
    (result.into_owned(), repaired)
}

fn file_sha256(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn migrate_image_persistence(connection: &Connection, app: &AppHandle) -> Result<(), String> {
    let migrated: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=17)", [], |row| row.get(0)).map_err(|error| error.to_string())?;
    if migrated { return Ok(()) }
    let rows = {
        let mut statement = connection.prepare("SELECT id,entity,data_json FROM records WHERE entity IN ('notes','notebookFiles')").map_err(|error| error.to_string())?;
        let mapped = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))).map_err(|error| error.to_string())?;
        mapped.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?
    };
    let file_root = notebook_files_dir(app)?;
    for (id, entity, raw) in rows {
        let mut data = serde_json::from_str::<Value>(&raw).map_err(|error| error.to_string())?;
        let mut changed = false;
        if entity == "notes" {
            if let Some(html) = data.get("contentHtml").and_then(Value::as_str) {
                let (safe_html, repaired) = repair_unsafe_note_image_html(html);
                if repaired > 0 {
                    data["contentHtml"] = Value::String(safe_html);
                    data["missingImageCount"] = Value::Number((repaired as u64).into());
                    changed = true;
                }
            }
        } else if let Some(object) = data.as_object_mut() {
            if let Some(storage_path) = object.get("storagePath").and_then(Value::as_str).map(PathBuf::from) {
                if let Some(name) = storage_path.file_name().and_then(|value| value.to_str()) {
                    let durable_path = file_root.join(safe_file_name(name));
                    if !durable_path.exists() && storage_path.starts_with(data_dir(app)?) && storage_path.exists() {
                        fs::copy(&storage_path, &durable_path).map_err(|error| error.to_string())?;
                    }
                    object.insert("storageKey".into(), Value::String(name.to_string()));
                    if durable_path.exists() {
                        object.insert("sha256".into(), Value::String(file_sha256(&durable_path)?));
                        object.insert("localState".into(), Value::String("LOCAL_AVAILABLE".into()));
                    } else {
                        object.insert("localState".into(), Value::String("MISSING".into()));
                    }
                    object.remove("storagePath");
                    changed = true;
                }
            }
        }
        if changed {
            connection.execute("UPDATE records SET data_json=?2,updated_at=?3 WHERE id=?1", params![id, serde_json::to_string(&data).map_err(|error| error.to_string())?, now()]).map_err(|error| error.to_string())?;
        }
    }
    connection.execute("INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(17,?1)", params![now()]).map_err(|error| error.to_string())?;
    connection.execute("UPDATE sync_state SET schema_version=17 WHERE schema_version<17", []).map_err(|error| error.to_string())?;
    Ok(())
}

fn repair_notebook_category_references(connection: &Connection) -> Result<usize, String> {
    let rows = {
        let mut statement = connection
            .prepare("SELECT id,entity,data_json,created_at FROM records WHERE deleted_at IS NULL")
            .map_err(|error| error.to_string())?;
        let mapped = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        mapped
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?
    };
    let mut repaired = 0;
    for (id, entity, raw, created_at) in rows {
        if !NOTEBOOK_CONTENT_ENTITIES.contains(&entity.as_str()) && entity != "notebookFolders" {
            continue;
        }
        let mut record: Value = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
        let Some(category_id) = string_field(&record, "notebookCategoryId") else {
            continue;
        };
        if valid_reference(connection, &category_id, "notebookCategories", false)?.is_some() {
            continue;
        }
        record
            .as_object_mut()
            .ok_or("Notebook 数据必须是对象")?
            .remove("notebookCategoryId");
        write_record(connection, &entity, &id, &record, Some(&created_at))?;
        sync_relations(connection, &id, &record)?;
        repaired += 1;
    }
    Ok(repaired)
}

fn repair_referenced_notebook_file_tombstones(connection: &Connection) -> Result<usize, String> {
    let rows = {
        let mut statement = connection
            .prepare(
                "SELECT id,data_json FROM records
                 WHERE entity='notebookFiles' AND deleted_at IS NOT NULL",
            )
            .map_err(|error| error.to_string())?;
        let mapped = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|error| error.to_string())?;
        mapped
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?
    };
    let mut repaired = 0;
    let sync_outbox_exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='sync_outbox')",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    for (id, raw) in rows {
        if notebook_file_reference_count(connection, &id)? == 0 {
            continue;
        }
        let mut data: Value = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
        let object = data
            .as_object_mut()
            .ok_or("Notebook 文件数据必须是对象")?;
        object.remove("archivedAt");
        object.remove("deletedAt");
        object.insert("updatedAt".into(), Value::String(now()));
        let (title, body) = title_body(&data);
        let updated_at = now();
        connection
            .execute(
                "UPDATE records
                 SET data_json=?2,title=?3,body=?4,updated_at=?5,archived_at=NULL,deleted_at=NULL
                 WHERE id=?1",
                params![
                    id,
                    serde_json::to_string(&data).map_err(|error| error.to_string())?,
                    title,
                    body,
                    updated_at,
                ],
            )
            .map_err(|error| error.to_string())?;
        connection
            .execute("DELETE FROM records_fts WHERE id=?1", params![id])
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "INSERT INTO records_fts (id, entity, title, body) VALUES (?1, 'notebookFiles', ?2, ?3)",
                params![id, title, body],
            )
            .map_err(|error| error.to_string())?;
        if sync_outbox_exists {
            connection
                .execute(
                    "DELETE FROM sync_outbox WHERE entity_type='notebookFiles' AND entity_id=?1 AND operation='DELETE'",
                    params![id],
                )
                .map_err(|error| error.to_string())?;
        }
        sync_relations(connection, &id, &data)?;
        repaired += 1;
    }
    if !sync_outbox_exists {
        return Ok(repaired);
    }
    let pending_delete_ids = {
        let mut statement = connection
            .prepare(
                "SELECT DISTINCT entity_id FROM sync_outbox
                 WHERE entity_type='notebookFiles' AND operation='DELETE'",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        rows
    };
    for id in pending_delete_ids {
        if notebook_file_reference_count(connection, &id)? > 0 {
            connection
                .execute(
                    "DELETE FROM sync_outbox WHERE entity_type='notebookFiles' AND entity_id=?1 AND operation='DELETE'",
                    params![id],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(repaired)
}

fn migrate_notebook_category_ownership(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_records_notebook_category_active
               ON records(json_extract(data_json,'$.notebookCategoryId'), entity, archived_at, deleted_at);",
        )
        .map_err(|error| error.to_string())?;
    let migrated: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=?1)",
            params![SCHEMA_VERSION],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if migrated {
        return Ok(());
    }
    repair_notebook_category_references(connection)?;
    connection
        .execute(
            "INSERT INTO schema_migrations(version,applied_at) VALUES(?1,?2)",
            params![SCHEMA_VERSION, now()],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "UPDATE sync_state SET schema_version=?1 WHERE schema_version<?1",
            params![SCHEMA_VERSION],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn clear_notebook_category_ownership(connection: &Connection, category_id: &str) -> Result<usize, String> {
    let records = all_records(connection)?;
    let mut cleared = 0;
    for record in records {
        let entity = record["entity"].as_str().unwrap_or("").to_string();
        if !NOTEBOOK_CONTENT_ENTITIES.contains(&entity.as_str()) && entity != "notebookFolders" {
            continue;
        }
        if string_field(&record, "notebookCategoryId").as_deref() != Some(category_id) {
            continue;
        }
        let id = record["id"].as_str().ok_or("Notebook 记录缺少 ID")?.to_string();
        let created_at = record["createdAt"].as_str().ok_or("Notebook 记录缺少创建时间")?.to_string();
        let mut updated = record;
        updated
            .as_object_mut()
            .ok_or("Notebook 数据必须是对象")?
            .remove("notebookCategoryId");
        write_record(connection, &entity, &id, &updated, Some(&created_at))?;
        sync_relations(connection, &id, &updated)?;
        cleared += 1;
    }
    Ok(cleared)
}

fn migrate_sync_v1(connection: &Connection) -> Result<(), String> {
    ensure_column(connection, "records", "workspace_id", "TEXT NOT NULL DEFAULT 'local'")?;
    ensure_column(connection, "records", "revision", "INTEGER NOT NULL DEFAULT 1")?;
    ensure_column(connection, "records", "created_by", "TEXT")?;
    ensure_column(connection, "records", "updated_by", "TEXT")?;
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS sync_outbox (
           mutation_id TEXT PRIMARY KEY,
           transaction_id TEXT,
           workspace_id TEXT NOT NULL,
           device_id TEXT NOT NULL,
           entity_type TEXT NOT NULL,
           entity_id TEXT NOT NULL,
           operation TEXT NOT NULL,
           base_revision INTEGER NOT NULL,
           changed_fields_json TEXT NOT NULL,
           payload_json TEXT NOT NULL,
           protocol_version INTEGER NOT NULL DEFAULT 1,
           created_at TEXT NOT NULL,
           attempts INTEGER NOT NULL DEFAULT 0,
           last_error TEXT
         );
         CREATE INDEX IF NOT EXISTS idx_sync_outbox_created ON sync_outbox(created_at, mutation_id);
         CREATE TABLE IF NOT EXISTS sync_state (
           workspace_id TEXT PRIMARY KEY,
           server_cursor INTEGER NOT NULL DEFAULT 0,
           snapshot_cursor INTEGER NOT NULL DEFAULT 0,
           last_synced_at TEXT,
           schema_version INTEGER NOT NULL DEFAULT 18,
           protocol_version INTEGER NOT NULL DEFAULT 1
         );
         CREATE TABLE IF NOT EXISTS sync_devices (
           device_id TEXT PRIMARY KEY,
           name TEXT NOT NULL,
           platform TEXT NOT NULL,
           app_version TEXT NOT NULL,
           schema_version INTEGER NOT NULL,
           protocol_version INTEGER NOT NULL,
           last_seen_at TEXT NOT NULL,
           revoked_at TEXT
         );
         CREATE TABLE IF NOT EXISTS sync_conflicts (
           conflict_id TEXT PRIMARY KEY,
           entity_type TEXT NOT NULL,
           entity_id TEXT NOT NULL,
           local_revision INTEGER NOT NULL,
           server_revision INTEGER NOT NULL,
           fields_json TEXT NOT NULL,
           local_payload_json TEXT NOT NULL,
           remote_payload_json TEXT NOT NULL,
           created_at TEXT NOT NULL,
           resolved_at TEXT,
           resolution TEXT
         );
         INSERT OR IGNORE INTO sync_state(workspace_id) VALUES ('local');
         DROP TRIGGER IF EXISTS sync_records_insert;
         DROP TRIGGER IF EXISTS sync_records_update;
         DROP TRIGGER IF EXISTS sync_relations_insert;
         DROP TRIGGER IF EXISTS sync_relations_delete;
         CREATE TRIGGER sync_records_insert AFTER INSERT ON records
         WHEN NOT EXISTS (SELECT 1 FROM settings WHERE key='sync.apply_mode' AND value='1')
         BEGIN
           INSERT INTO sync_outbox(mutation_id, workspace_id, device_id, entity_type, entity_id, operation, base_revision, changed_fields_json, payload_json, created_at)
           VALUES (lower(hex(randomblob(16))), NEW.workspace_id, coalesce((SELECT value FROM settings WHERE key='sync.device_id'),'unregistered'), NEW.entity, NEW.id, 'CREATE', 0, '[]', NEW.data_json, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
         END;
         CREATE TRIGGER sync_records_update AFTER UPDATE OF data_json, archived_at, deleted_at ON records
         WHEN NOT EXISTS (SELECT 1 FROM settings WHERE key='sync.apply_mode' AND value='1')
         BEGIN
           UPDATE records SET revision=OLD.revision+1 WHERE id=NEW.id;
           INSERT INTO sync_outbox(mutation_id, workspace_id, device_id, entity_type, entity_id, operation, base_revision, changed_fields_json, payload_json, created_at)
           VALUES (lower(hex(randomblob(16))), NEW.workspace_id, coalesce((SELECT value FROM settings WHERE key='sync.device_id'),'unregistered'), NEW.entity, NEW.id, CASE WHEN NEW.deleted_at IS NOT NULL THEN 'DELETE' ELSE 'UPDATE' END, OLD.revision,
             coalesce((SELECT json_group_array(key) FROM (SELECT key FROM json_each(OLD.data_json) UNION SELECT key FROM json_each(NEW.data_json)) WHERE json_extract(OLD.data_json,'$.'||key) IS NOT json_extract(NEW.data_json,'$.'||key)), '[]'),
             NEW.data_json, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
         END;
         CREATE TRIGGER sync_relations_insert AFTER INSERT ON relations
         WHEN NOT EXISTS (SELECT 1 FROM settings WHERE key='sync.apply_mode' AND value='1')
         BEGIN
           INSERT INTO sync_outbox(mutation_id, workspace_id, device_id, entity_type, entity_id, operation, base_revision, changed_fields_json, payload_json, created_at)
           VALUES (lower(hex(randomblob(16))), 'local', coalesce((SELECT value FROM settings WHERE key='sync.device_id'),'unregistered'), 'relations', NEW.id, 'RELATION_ADD', 0, '[\"fromId\",\"toId\",\"relationType\"]', json_object('id',NEW.id,'fromId',NEW.from_id,'toId',NEW.to_id,'relationType',NEW.relation_type,'createdAt',NEW.created_at), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
         END;
         CREATE TRIGGER sync_relations_delete AFTER DELETE ON relations
         WHEN NOT EXISTS (SELECT 1 FROM settings WHERE key='sync.apply_mode' AND value='1')
         BEGIN
           INSERT INTO sync_outbox(mutation_id, workspace_id, device_id, entity_type, entity_id, operation, base_revision, changed_fields_json, payload_json, created_at)
           VALUES (lower(hex(randomblob(16))), 'local', coalesce((SELECT value FROM settings WHERE key='sync.device_id'),'unregistered'), 'relations', OLD.id, 'RELATION_REMOVE', 0, '[]', json_object('id',OLD.id,'fromId',OLD.from_id,'toId',OLD.to_id,'relationType',OLD.relation_type,'createdAt',OLD.created_at), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
         END;
         INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (16, strftime('%s','now'));
         DELETE FROM settings WHERE key='sync.apply_mode';"
    ).map_err(|error| error.to_string())?;
    Ok(())
}

fn ensure_column(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| e.to_string())?;
    let exists = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .any(|name| name == column);
    if !exists {
        connection
            .execute_batch(&format!(
                "ALTER TABLE {table} ADD COLUMN {column} {definition}"
            ))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn value_to_record(
    id: String,
    entity: String,
    raw: String,
    created_at: String,
    updated_at: String,
) -> Value {
    let mut data = serde_json::from_str::<Value>(&raw).unwrap_or_else(|_| json!({}));
    if !data.is_object() {
        data = Value::Object(Map::new());
    }
    let object = data.as_object_mut().expect("object just created");
    object.insert("id".into(), Value::String(id));
    object.insert("entity".into(), Value::String(entity));
    object.insert("createdAt".into(), Value::String(created_at));
    object.insert("updatedAt".into(), Value::String(updated_at));
    data
}

fn title_body(data: &Value) -> (String, String) {
    let get = |key: &str| data.get(key).and_then(Value::as_str).unwrap_or("");
    let title = [get("title"), get("name"), get("statement"), get("content")]
        .into_iter()
        .find(|v| !v.trim().is_empty())
        .unwrap_or("")
        .to_string();
    let body = serde_json::to_string(data).unwrap_or_default();
    (title, body)
}

fn write_record(
    connection: &Connection,
    entity: &str,
    id: &str,
    data: &Value,
    created_at: Option<&str>,
) -> Result<Value, String> {
    let timestamp = now();
    let created = created_at.unwrap_or(&timestamp);
    let (title, body) = title_body(data);
    let raw = serde_json::to_string(data).map_err(|e| e.to_string())?;
    connection
        .execute(
            "INSERT INTO records (id, entity, data_json, title, body, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(id) DO UPDATE SET entity=excluded.entity, data_json=excluded.data_json,
       title=excluded.title, body=excluded.body, updated_at=excluded.updated_at",
            params![id, entity, raw, title, body, created, timestamp],
        )
        .map_err(|e| e.to_string())?;
    connection
        .execute("DELETE FROM records_fts WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    connection
        .execute(
            "INSERT INTO records_fts (id, entity, title, body) VALUES (?1, ?2, ?3, ?4)",
            params![id, entity, title, body],
        )
        .map_err(|e| e.to_string())?;
    Ok(value_to_record(
        id.into(),
        entity.into(),
        serde_json::to_string(data).unwrap_or_default(),
        created.into(),
        timestamp,
    ))
}

fn record_by_id(connection: &Connection, id: &str) -> Result<Option<Value>, String> {
    connection
        .query_row(
            "SELECT id, entity, data_json, created_at, updated_at FROM records WHERE id=?1 AND deleted_at IS NULL",
            params![id],
            |row| {
                Ok(value_to_record(
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())
}

fn string_field(data: &Value, key: &str) -> Option<String> {
    data.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn set_optional_id(object: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value.filter(|value| !value.is_empty()) {
        object.insert(key.into(), Value::String(value));
    } else {
        object.remove(key);
    }
}

fn expected_entity(key: &str) -> Option<&'static str> {
    if key == "researchRunIds" {
        // Legacy provider execution IDs live outside unified records and are not relations.
        return None;
    }
    match key.trim_end_matches('s') {
        "goalId" => Some("goals"),
        "projectId" => Some("projects"),
        "taskId" | "dependencyId" => Some("tasks"),
        "timeLogId" => Some("timeLogs"),
        "resultId" => Some("results"),
        "sourceResearchResultId" => Some("researchResults"),
        "deliverableId" | "previousDeliverableId" => Some("deliverables"),
        "fileId" => Some("notebookFiles"),
        "evidenceId" => Some("results"),
        "resultPackageId" => Some("resultPackages"),
        "workflowId" => Some("workflows"),
        "workflowVersionId" | "sourceWorkflowVersionId" | "createdFromVersionId" | "currentVersionId" => Some("workflowVersions"),
        "workflowStepId" => Some("workflowSteps"),
        "workflowRunId" | "sourceWorkflowRunId" => Some("workflowRuns"),
        "reviewId" => Some("reviews"),
        "insightId" => Some("insights"),
        "knowledgeId" => Some("knowledge"),
        "mentalModelId" => Some("mentalModels"),
        "principleId" => Some("principles"),
        "decisionId" => Some("decisions"),
        "hypothesisId" => Some("hypotheses"),
        "experimentId" => Some("experiments"),
        "personId" => Some("people"),
        "sourceId" => Some("externalSources"),
        "signalId" => Some("signals"),
        "opportunityId" => Some("opportunities"),
        "briefId" => Some("intelligenceBriefs"),
        "researchThreadId" => Some("researchThreads"),
        "researchRequestId" => Some("researchRequests"),
        "researchRunId" => Some("researchRuns"),
        "researchResultId" => Some("researchResults"),
        "sourceDecisionId" => Some("decisions"),
        "sourceOpportunityId" => Some("opportunities"),
        "sourceSignalId" => Some("signals"),
        "accountId" | "destinationAccountId" => Some("financialAccounts"),
        "categoryId" | "parentCategoryId" => Some("financialCategories"),
        "transactionId" | "refundOfTransactionId" => Some("financialTransactions"),
        "notebookCategoryId" | "parentNotebookCategoryId" => Some("notebookCategories"),
        "notebookFolderId" | "parentNotebookFolderId" => Some("notebookFolders"),
        _ => None,
    }
}

fn valid_reference(
    connection: &Connection,
    id: &str,
    expected: &str,
    strict: bool,
) -> Result<Option<Value>, String> {
    let record = record_by_id(connection, id)?;
    if record.as_ref().and_then(|record| record["entity"].as_str()) == Some(expected) {
        return Ok(record);
    }
    if strict {
        Err(format!("关联记录无效：{id} 不是有效的 {expected}"))
    } else {
        Ok(None)
    }
}

fn align_context_from_reference(
    connection: &Connection,
    normalized: &mut Value,
    relation_key: &str,
    expected_entity: &str,
    context_keys: &[&str],
    strict: bool,
) -> Result<(), String> {
    let Some(reference_id) = string_field(normalized, relation_key) else {
        return Ok(());
    };
    let Some(reference) = valid_reference(connection, &reference_id, expected_entity, strict)?
    else {
        normalized.as_object_mut().unwrap().remove(relation_key);
        return Ok(());
    };
    for key in context_keys {
        if let (Some(current), Some(parent)) =
            (string_field(normalized, key), string_field(&reference, key))
        {
            if current != parent {
                if strict {
                    return Err(format!(
                        "因果关联跨越不同上下文：{relation_key} 的 {key} 不一致"
                    ));
                }
                normalized.as_object_mut().unwrap().remove(relation_key);
                return Ok(());
            }
        }
    }
    let inherited = context_keys
        .iter()
        .filter(|key| string_field(normalized, key).is_none())
        .map(|key| (*key, string_field(&reference, key)))
        .collect::<Vec<_>>();
    let object = normalized.as_object_mut().unwrap();
    for (key, value) in inherited {
        set_optional_id(object, key, value);
    }
    Ok(())
}

fn normalize_record(
    connection: &Connection,
    entity: &str,
    data: &Value,
    strict: bool,
) -> Result<Value, String> {
    let mut normalized = data.clone();
    if !normalized.is_object() {
        normalized = Value::Object(Map::new());
    }

    if entity == "projects" {
        if let Some(goal_id) = string_field(&normalized, "goalId") {
            if valid_reference(connection, &goal_id, "goals", strict)?.is_none() {
                normalized.as_object_mut().unwrap().remove("goalId");
            }
        }
    }

    if entity == "tasks" {
        if let Some(project_id) = string_field(&normalized, "projectId") {
            if let Some(project) = valid_reference(connection, &project_id, "projects", strict)? {
                let inherited_goal = string_field(&project, "goalId");
                let object = normalized.as_object_mut().unwrap();
                set_optional_id(object, "projectId", Some(project_id));
                set_optional_id(object, "goalId", inherited_goal);
            } else {
                normalized.as_object_mut().unwrap().remove("projectId");
            }
        }
        if string_field(&normalized, "projectId").is_none() {
            if let Some(goal_id) = string_field(&normalized, "goalId") {
                if valid_reference(connection, &goal_id, "goals", strict)?.is_none() {
                    normalized.as_object_mut().unwrap().remove("goalId");
                }
            }
        }
    }

    if ["timeLogs", "results", "reviews", "decisions"].contains(&entity) {
        if let Some(task_id) = string_field(&normalized, "taskId") {
            if let Some(task) = valid_reference(connection, &task_id, "tasks", strict)? {
                let object = normalized.as_object_mut().unwrap();
                set_optional_id(object, "taskId", Some(task_id));
                set_optional_id(object, "projectId", string_field(&task, "projectId"));
                set_optional_id(object, "goalId", string_field(&task, "goalId"));
            } else {
                normalized.as_object_mut().unwrap().remove("taskId");
            }
        }
        if string_field(&normalized, "taskId").is_none() {
            if let Some(project_id) = string_field(&normalized, "projectId") {
                if let Some(project) = valid_reference(connection, &project_id, "projects", strict)?
                {
                    let object = normalized.as_object_mut().unwrap();
                    set_optional_id(object, "projectId", Some(project_id));
                    set_optional_id(object, "goalId", string_field(&project, "goalId"));
                } else {
                    normalized.as_object_mut().unwrap().remove("projectId");
                }
            }
        }
    }

    if entity == "tasks" {
        align_context_from_reference(
            connection,
            &mut normalized,
            "decisionId",
            "decisions",
            &["projectId", "goalId"],
            strict,
        )?;
    }

    if entity == "reviews" {
        align_context_from_reference(
            connection,
            &mut normalized,
            "resultId",
            "results",
            &["taskId", "projectId", "goalId"],
            strict,
        )?;
    }

    if entity == "workflowRuns" {
        if let Some(project_id) = string_field(&normalized, "projectId") {
            if let Some(project) = valid_reference(connection, &project_id, "projects", strict)? {
                set_optional_id(normalized.as_object_mut().unwrap(), "goalId", string_field(&project, "goalId"));
            }
        }
    }

    if entity == "deliverables" {
        align_context_from_reference(connection, &mut normalized, "resultId", "results", &["projectId", "goalId", "taskId"], strict)?;
    }

    if entity == "resultPackages" {
        align_context_from_reference(connection, &mut normalized, "workflowRunId", "workflowRuns", &["projectId", "goalId"], strict)?;
    }

    if entity == "insights" {
        if string_field(&normalized, "reviewId").is_some() {
            align_context_from_reference(
                connection,
                &mut normalized,
                "reviewId",
                "reviews",
                &["taskId", "projectId", "goalId"],
                strict,
            )?;
        } else {
            align_context_from_reference(
                connection,
                &mut normalized,
                "resultId",
                "results",
                &["taskId", "projectId", "goalId"],
                strict,
            )?;
        }
    }

    if entity == "timeLogs" {
        let running = normalized["isRunning"].as_bool().unwrap_or(false);
        let object = normalized.as_object_mut().unwrap();
        object.insert(
            "status".into(),
            Value::String(if running { "running" } else { "completed" }.into()),
        );
    }

    finance::normalize(entity, &mut normalized)?;

    let keys = normalized
        .as_object()
        .map(|object| object.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    for key in keys {
        let Some(expected) = expected_entity(&key) else {
            continue;
        };
        if key.ends_with("Ids") {
            let values = match normalized.get(&key) {
                Some(Value::Array(values)) => values
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect::<Vec<_>>(),
                Some(Value::String(values)) => values
                    .split(',')
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .collect(),
                _ => Vec::new(),
            };
            let mut valid = Vec::new();
            for id in values {
                if valid_reference(connection, &id, expected, strict)?.is_some() {
                    valid.push(Value::String(id));
                }
            }
            normalized
                .as_object_mut()
                .unwrap()
                .insert(key, Value::Array(valid));
        } else if let Some(id) = string_field(&normalized, &key) {
            if valid_reference(connection, &id, expected, strict)?.is_none() {
                normalized.as_object_mut().unwrap().remove(&key);
            }
        }
    }
    Ok(normalized)
}

fn cascade_context(
    connection: &Connection,
    parent_entity: &str,
    parent_id: &str,
) -> Result<(), String> {
    let rows = all_records(connection)?;
    for record in rows {
        let matches = (parent_entity == "projects"
            && string_field(&record, "projectId").as_deref() == Some(parent_id))
            || (parent_entity == "tasks"
                && string_field(&record, "taskId").as_deref() == Some(parent_id));
        if !matches {
            continue;
        }
        let Some(entity) = record["entity"].as_str() else {
            continue;
        };
        let Some(id) = record["id"].as_str() else {
            continue;
        };
        let normalized = normalize_record(connection, entity, &record, false)?;
        let created = record["createdAt"].as_str();
        write_record(connection, entity, id, &normalized, created)?;
        sync_relations(connection, id, &normalized)?;
    }
    Ok(())
}

fn relationship_integrity(connection: &Connection) -> Result<Value, String> {
    let records = all_records(connection)?;
    let mut issues = Vec::new();
    for record in records {
        let entity = record["entity"].as_str().unwrap_or("");
        let id = record["id"].as_str().unwrap_or("");
        let normalized = normalize_record(connection, entity, &record, false)?;
        for key in [
            "goalId",
            "projectId",
            "taskId",
            "resultId",
            "reviewId",
            "insightId",
        ] {
            if record.get(key) != normalized.get(key) {
                issues.push(
                    json!({"id": id, "entity": entity, "field": key, "value": record.get(key)}),
                );
            }
        }
    }
    Ok(json!({"ok": issues.is_empty(), "issueCount": issues.len(), "issues": issues}))
}

fn sync_relations(connection: &Connection, source_id: &str, data: &Value) -> Result<(), String> {
    connection
        .execute(
            "DELETE FROM relations WHERE from_id=?1 AND relation_type LIKE 'field:%'",
            params![source_id],
        )
        .map_err(|e| e.to_string())?;
    let Some(object) = data.as_object() else {
        return Ok(());
    };
    for (key, value) in object {
        if key == "id" || key == "entity" || key == "sourceId" {
            continue;
        }
        let targets: Vec<String> = if key.ends_with("Id") {
            value
                .as_str()
                .filter(|v| !v.trim().is_empty())
                .map(|v| vec![v.trim().to_string()])
                .unwrap_or_default()
        } else if key.ends_with("Ids") {
            match value {
                Value::Array(values) => values
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::trim)
                    .filter(|v| !v.is_empty())
                    .map(str::to_string)
                    .collect(),
                Value::String(values) => values
                    .split(',')
                    .map(str::trim)
                    .filter(|v| !v.is_empty())
                    .map(str::to_string)
                    .collect(),
                _ => Vec::new(),
            }
        } else {
            Vec::new()
        };
        for target in targets {
            let target_exists: bool = connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM records WHERE id=?1 AND deleted_at IS NULL)",
                    params![target],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            if target_exists && target != source_id {
                connection.execute(
                    "INSERT OR IGNORE INTO relations(id, from_id, to_id, relation_type, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![new_id("relation"), source_id, target, format!("field:{key}"), now()],
                ).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

fn validate_research_result_snapshot(existing: &Value, incoming: &Value) -> Result<(), String> {
    if !["COMPLETED", "PARTIAL"].contains(&existing["status"].as_str().unwrap_or("")) {
        return Ok(());
    }
    for field in [
        "summary", "executiveSummary", "scopeSnapshot", "planSnapshot", "metricsSummary",
        "sourceCoverage", "missingData", "limitations", "confidence", "recommendations",
        "evidenceUrls", "evidenceItemIds", "researchRunIds", "provenanceCount",
        "researchThreadId", "researchRequestId", "researchRunId", "completedAt", "status",
    ] {
        if incoming.get(field).is_some() && incoming.get(field) != existing.get(field) {
            return Err("已完成的调研结果是不可变快照；请创建后续调研，而不是覆盖历史结果".into());
        }
    }
    Ok(())
}

fn apply_task_execution_fields(data: &mut Value, existing: Option<&Value>, timestamp: &str) {
    if data.get("status").and_then(Value::as_str) == Some("blocked") {
        let has_blocked_since = data
            .get("blockedSince")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty());
        if !has_blocked_since {
            let previous = existing
                .and_then(|record| record.get("blockedSince"))
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(timestamp)
                .to_string();
            if let Some(object) = data.as_object_mut() {
                object.insert("blockedSince".into(), Value::String(previous));
            }
        }
    } else if let Some(object) = data.as_object_mut() {
        object.remove("blockedSince");
    }
}

#[tauri::command]
fn initialize_database(app: AppHandle) -> Result<Value, String> {
    let connection = db(&app)?;
    Ok(
        json!({"ok": true, "entities": ENTITIES, "database": data_dir(&app)?.join("jason-os.sqlite3"), "integrity": relationship_integrity(&connection)?}),
    )
}

#[tauri::command]
fn check_relationship_integrity(app: AppHandle) -> Result<Value, String> {
    relationship_integrity(&db(&app)?)
}

#[tauri::command]
fn list_records(app: AppHandle, entity: String) -> Result<Vec<Value>, String> {
    if entity != "all" && !is_entity(&entity) {
        return Err("Unknown entity".into());
    }
    let connection = db(&app)?;
    let sql = if entity == "all" {
        "SELECT id, entity, data_json, created_at, updated_at FROM records WHERE archived_at IS NULL AND deleted_at IS NULL ORDER BY updated_at DESC"
    } else {
        "SELECT id, entity, data_json, created_at, updated_at FROM records WHERE entity = ?1 AND archived_at IS NULL AND deleted_at IS NULL ORDER BY updated_at DESC"
    };
    let mut statement = connection.prepare(sql).map_err(|e| e.to_string())?;
    let map_row = |row: &rusqlite::Row<'_>| -> rusqlite::Result<Value> {
        Ok(value_to_record(
            row.get(0)?,
            row.get(1)?,
            row.get(2)?,
            row.get(3)?,
            row.get(4)?,
        ))
    };
    let rows = if entity == "all" {
        statement.query_map([], map_row)
    } else {
        statement.query_map(params![entity], map_row)
    }
    .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn decision_text(record: &Value, key: &str) -> String {
    record.get(key).and_then(Value::as_str).unwrap_or("").trim().to_string()
}

fn decision_validation(record: &Value) -> String {
    let explicit = decision_text(record, "validationStatus");
    if !explicit.is_empty() { return explicit; }
    match decision_text(record, "status").as_str() {
        "validated" => "SUPPORTED".into(),
        "partially_correct" => "PARTIALLY_SUPPORTED".into(),
        "wrong" => "CONTRADICTED".into(),
        "unknown" => "INCONCLUSIVE".into(),
        _ => "PENDING".into(),
    }
}

fn decision_stage(record: &Value) -> String {
    if decision_validation(record) != "PENDING" { return "CALIBRATED".into(); }
    if !decision_text(record, "actualOutcome").is_empty() || !decision_text(record, "outcome").is_empty() || decision_text(record, "executionStatus") == "EXECUTED" { return "VALIDATING".into(); }
    if decision_text(record, "executionStatus") == "IN_PROGRESS" { return "IN_PROGRESS".into(); }
    if !decision_text(record, "selectedOption").is_empty() || !decision_text(record, "ceoDecision").is_empty() || decision_text(record, "choiceStatus") == "DECIDED" || decision_text(record, "status") == "decided" { return "DECIDED".into(); }
    "PENDING".into()
}

fn decision_date(record: &Value) -> String {
    ["decisionAt", "date", "createdAt", "updatedAt"].into_iter().map(|key| decision_text(record, key)).find(|value| !value.is_empty()).unwrap_or_default()
}

fn iso_date_millis(value: &str) -> Option<i128> {
    let mut parts = value.get(..10)?.split('-').map(str::parse::<i64>);
    let mut year = parts.next()?.ok()?;
    let month = parts.next()?.ok()?;
    let day = parts.next()?.ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) { return None; }
    year -= if month <= 2 { 1 } else { 0 };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month_offset = if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * (month + month_offset) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    Some(((era * 146097 + day_of_era - 719468) as i128) * 86_400_000)
}

#[tauri::command]
fn query_decision_records(app: AppHandle, query: Value) -> Result<Value, String> {
    let object = query.as_object().ok_or("决策查询参数无效")?;
    let text = |key: &str| object.get(key).and_then(Value::as_str).unwrap_or("").trim().to_string();
    let stage = text("stage"); let importance = text("importance"); let risk = text("riskLevel"); let project_id = text("projectId"); let validation = text("validationStatus"); let period = text("period"); let sort = text("sort"); let search = text("search").to_lowercase();
    let limit = object.get("limit").and_then(Value::as_u64).unwrap_or(50).clamp(1, 100) as usize;
    let offset = object.get("offset").and_then(Value::as_u64).unwrap_or(0) as usize;
    let connection = db(&app)?;
    let mut statement = connection.prepare("SELECT id, entity, data_json, created_at, updated_at FROM records WHERE entity='decisions' AND archived_at IS NULL AND deleted_at IS NULL").map_err(|e| e.to_string())?;
    let rows = statement.query_map([], |row| Ok(value_to_record(row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))).map_err(|e| e.to_string())?;
    let now_ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as i128;
    let mut records = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?.into_iter().filter(|record| {
        let matches_search = search.is_empty() || serde_json::to_string(record).unwrap_or_default().to_lowercase().contains(&search);
        let matches_stage = stage.is_empty() || stage == "ALL" || decision_stage(record) == stage;
        let matches_importance = importance.is_empty() || importance == "ALL" || decision_text(record, "importance").to_uppercase() == importance;
        let matches_risk = risk.is_empty() || risk == "ALL" || decision_text(record, "riskLevel").to_uppercase() == risk;
        let matches_project = project_id.is_empty() || project_id == "ALL" || decision_text(record, "projectId") == project_id;
        let matches_validation = validation.is_empty() || validation == "ALL" || decision_validation(record) == validation;
        let matches_period = if period == "30d" || period == "90d" || period == "YEAR" { let days: i128 = if period == "30d" { 30 } else if period == "90d" { 90 } else { 365 }; let value = decision_date(record); value.parse::<i128>().ok().or_else(|| iso_date_millis(&value)).map(|millis| millis >= now_ms - days * 86_400_000).unwrap_or(true) } else { true };
        matches_search && matches_stage && matches_importance && matches_risk && matches_project && matches_validation && matches_period
    }).collect::<Vec<_>>();
    let rank = |record: &Value| match decision_text(record, "importance").to_uppercase().as_str() { "CRITICAL" => 4, "HIGH" => 3, "MEDIUM" => 2, "LOW" => 1, _ => 0 };
    records.sort_by(|left, right| match sort.as_str() { "IMPORTANCE" => rank(right).cmp(&rank(left)).then_with(|| decision_date(right).cmp(&decision_date(left))), "VALIDATION_DUE" => decision_text(left, "validationDueAt").cmp(&decision_text(right, "validationDueAt")), "UPDATED_AT" => decision_text(right, "updatedAt").cmp(&decision_text(left, "updatedAt")), _ => decision_date(right).cmp(&decision_date(left)) });
    let total = records.len();
    Ok(json!({ "records": records.into_iter().skip(offset).take(limit).collect::<Vec<_>>(), "total": total }))
}

#[tauri::command]
fn list_sync_records(app: AppHandle) -> Result<Vec<Value>, String> {
    let connection = db(&app)?;
    let mut statement = connection
        .prepare("SELECT id, entity, data_json, created_at, updated_at FROM records ORDER BY updated_at ASC")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(value_to_record(
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn write_synced_record(connection: &Connection, data: &Value) -> Result<(), String> {
    let object = data.as_object().ok_or("同步记录必须是对象")?;
    let id = object.get("id").and_then(Value::as_str).filter(|value| !value.is_empty()).ok_or("同步记录缺少 id")?;
    let entity = object.get("entity").and_then(Value::as_str).filter(|value| is_entity(value)).ok_or("同步记录实体无效")?;
    let created_at = object.get("createdAt").and_then(Value::as_str).filter(|value| !value.is_empty()).ok_or("同步记录缺少 createdAt")?;
    let updated_at = object.get("updatedAt").and_then(Value::as_str).filter(|value| !value.is_empty()).ok_or("同步记录缺少 updatedAt")?;
    let raw = serde_json::to_string(data).map_err(|e| e.to_string())?;
    let (title, body) = title_body(data);
    let archived_at = object.get("archivedAt").and_then(Value::as_str);
    let deleted_at = object.get("deletedAt").and_then(Value::as_str);
    connection.execute(
        "INSERT INTO records (id, entity, data_json, title, body, created_at, updated_at, archived_at, deleted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET entity=excluded.entity, data_json=excluded.data_json, title=excluded.title,
           body=excluded.body, created_at=excluded.created_at, updated_at=excluded.updated_at,
           archived_at=excluded.archived_at, deleted_at=excluded.deleted_at",
        params![id, entity, raw, title, body, created_at, updated_at, archived_at, deleted_at],
    ).map_err(|e| e.to_string())?;
    connection.execute("DELETE FROM records_fts WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    if archived_at.is_none() && deleted_at.is_none() {
        connection.execute("INSERT INTO records_fts (id, entity, title, body) VALUES (?1, ?2, ?3, ?4)", params![id, entity, title, body]).map_err(|e| e.to_string())?;
    } else {
        connection.execute("DELETE FROM relations WHERE from_id=?1 OR to_id=?1", params![id]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn merge_remote_records(app: AppHandle, records: Vec<Value>) -> Result<usize, String> {
    let connection = db(&app)?;
    let mut merged = 0;
    for record in &records {
        write_synced_record(&connection, record)?;
        merged += 1;
    }
    for record in records.iter().filter(|record| record.get("deletedAt").is_none() && record.get("archivedAt").is_none()) {
        if let Some(id) = record.get("id").and_then(Value::as_str) {
            sync_relations(&connection, id, record)?;
        }
    }
    Ok(merged)
}

#[tauri::command]
fn get_record(app: AppHandle, id: String) -> Result<Option<Value>, String> {
    record_by_id(&db(&app)?, &id)
}

#[tauri::command]
fn get_sync_status(app: AppHandle) -> Result<Value, String> {
    let connection = db(&app)?;
    let pending: i64 = connection.query_row("SELECT COUNT(*) FROM sync_outbox", [], |row| row.get(0)).map_err(|e| e.to_string())?;
    let conflicts: i64 = connection.query_row("SELECT COUNT(*) FROM sync_conflicts WHERE resolved_at IS NULL", [], |row| row.get(0)).map_err(|e| e.to_string())?;
    let (cursor, last_synced_at): (i64, Option<String>) = connection.query_row(
        "SELECT server_cursor,last_synced_at FROM sync_state WHERE workspace_id='local'", [], |row| Ok((row.get(0)?, row.get(1)?))
    ).map_err(|e| e.to_string())?;
    Ok(json!({"pending":pending,"conflicts":conflicts,"serverCursor":cursor,"lastSyncedAt":last_synced_at,"protocolVersion":1,"schemaVersion":SCHEMA_VERSION}))
}

#[tauri::command]
fn get_build_provenance(app: AppHandle) -> Result<Value, String> {
    let connection = db(&app)?;
    let schema: i64 = connection.query_row("SELECT COALESCE(MAX(version),0) FROM schema_migrations", [], |row| row.get(0)).map_err(|e| e.to_string())?;
    let device_id: Option<String> = connection.query_row("SELECT value FROM settings WHERE key='sync.device_id'", [], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    let app_path = std::env::current_exe().map_err(|e| e.to_string())?.to_string_lossy().to_string();
    Ok(json!({"appPath":app_path,"appVersion":env!("CARGO_PKG_VERSION"),"gitCommit":env!("JASON_GIT_COMMIT"),"buildTime":env!("JASON_BUILD_TIME"),"schemaVersion":schema,"syncProtocolVersion":1,"deviceId":device_id,"workspaceId":"local"}))
}

#[tauri::command]
fn get_sync_v1_config(app: AppHandle) -> Result<Value, String> {
    let connection = db(&app)?;
    let url = setting(&connection, "sync.v1_url")?.unwrap_or_default();
    let token = read_secrets()?.get("sync-v1-token").and_then(Value::as_str).unwrap_or_default().to_string();
    Ok(json!({"url":url,"configured":!token.is_empty(),"token":token}))
}

#[tauri::command]
fn configure_sync_v1(app: AppHandle, url: String, token: String) -> Result<Value, String> {
    let normalized = url.trim().trim_end_matches('/').to_string();
    if !(normalized.starts_with("http://") || normalized.starts_with("https://")) { return Err("同步服务地址必须以 http:// 或 https:// 开头".into()); }
    if token.trim().is_empty() { return Err("同步 Token 不能为空".into()); }
    let connection = db(&app)?; let timestamp = now();
    connection.execute("INSERT INTO settings(key,value,updated_at) VALUES('sync.v1_url',?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at", params![normalized,timestamp]).map_err(|e| e.to_string())?;
    store_provider_key("sync-v1-token", token.trim())?;
    Ok(json!({"url":normalized,"configured":true,"token":token.trim()}))
}

#[tauri::command]
fn test_sync_v1(app: AppHandle) -> Result<Value, String> {
    let connection = db(&app)?; let url = setting(&connection, "sync.v1_url")?.filter(|value| !value.is_empty()).ok_or("尚未配置同步服务地址")?;
    let token = read_secrets()?.get("sync-v1-token").and_then(Value::as_str).filter(|value| !value.is_empty()).ok_or("尚未配置同步 Token")?.to_string();
    let started = std::time::Instant::now();
    let response = reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(8)).build().map_err(|e| e.to_string())?.get(format!("{url}/devices")).bearer_auth(token).send().map_err(|e| e.to_string())?;
    if !response.status().is_success() { return Err(format!("同步服务验证失败：HTTP {}", response.status())); }
    Ok(json!({"ok":true,"latencyMs":started.elapsed().as_millis()}))
}

#[tauri::command]
fn register_sync_device(app: AppHandle, name: String, platform: String) -> Result<Value, String> {
    let connection = db(&app)?;
    let existing: Option<String> = connection.query_row("SELECT value FROM settings WHERE key='sync.device_id'", [], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    let id = existing.unwrap_or_else(|| new_id("device"));
    let timestamp = now();
    connection.execute("INSERT INTO settings(key,value,updated_at) VALUES('sync.device_id',?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at", params![id,timestamp]).map_err(|e| e.to_string())?;
    connection.execute("INSERT INTO sync_devices(device_id,name,platform,app_version,schema_version,protocol_version,last_seen_at) VALUES(?1,?2,?3,'0.1.0',?4,1,?5) ON CONFLICT(device_id) DO UPDATE SET name=excluded.name,platform=excluded.platform,last_seen_at=excluded.last_seen_at,schema_version=excluded.schema_version", params![id,name,platform,SCHEMA_VERSION,timestamp]).map_err(|e| e.to_string())?;
    connection.execute("UPDATE sync_outbox SET device_id=?1 WHERE device_id='unregistered'", params![id]).map_err(|e| e.to_string())?;
    Ok(json!({"deviceId":id,"name":name,"platform":platform,"schemaVersion":SCHEMA_VERSION,"protocolVersion":1}))
}

#[tauri::command]
fn list_sync_outbox(app: AppHandle, limit: Option<usize>) -> Result<Vec<Value>, String> {
    let connection = db(&app)?;
    let mut statement = connection.prepare("SELECT mutation_id,transaction_id,workspace_id,device_id,entity_type,entity_id,operation,base_revision,changed_fields_json,payload_json,protocol_version,created_at,attempts,last_error FROM sync_outbox ORDER BY created_at,mutation_id LIMIT ?1").map_err(|e| e.to_string())?;
    let rows = statement.query_map(params![limit.unwrap_or(100).min(500) as i64], |row| {
        let changed: String = row.get(8)?;
        let payload: String = row.get(9)?;
        Ok(json!({"mutationId":row.get::<_,String>(0)?,"transactionId":row.get::<_,Option<String>>(1)?,"workspaceId":row.get::<_,String>(2)?,"deviceId":row.get::<_,String>(3)?,"entityType":row.get::<_,String>(4)?,"entityId":row.get::<_,String>(5)?,"operation":row.get::<_,String>(6)?,"baseRevision":row.get::<_,i64>(7)?,"changedFields":serde_json::from_str::<Value>(&changed).unwrap_or(json!([])),"payload":serde_json::from_str::<Value>(&payload).unwrap_or(json!({})),"protocolVersion":row.get::<_,i64>(10)?,"createdAt":row.get::<_,String>(11)?,"attempts":row.get::<_,i64>(12)?,"lastError":row.get::<_,Option<String>>(13)?}))
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn acknowledge_sync_mutations(app: AppHandle, mutation_ids: Vec<String>, server_cursor: i64) -> Result<(), String> {
    let mut connection = db(&app)?;
    let transaction = connection.transaction().map_err(|e| e.to_string())?;
    for id in mutation_ids { transaction.execute("DELETE FROM sync_outbox WHERE mutation_id=?1", params![id]).map_err(|e| e.to_string())?; }
    transaction.execute("UPDATE sync_state SET server_cursor=max(server_cursor,?1),last_synced_at=?2 WHERE workspace_id='local'", params![server_cursor,now()]).map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())
}

#[tauri::command]
fn apply_sync_changes(app: AppHandle, changes: Vec<Value>, server_cursor: i64) -> Result<usize, String> {
    let connection = db(&app)?;
    connection.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
    let result = (|| -> Result<usize, String> {
        connection.execute("INSERT INTO settings(key,value,updated_at) VALUES('sync.apply_mode','1',?1) ON CONFLICT(key) DO UPDATE SET value='1',updated_at=excluded.updated_at", params![now()]).map_err(|e| e.to_string())?;
        for change in &changes {
            let entity_type = change.get("entityType").and_then(Value::as_str).ok_or("同步变化缺少 entityType")?;
            let entity_id = change.get("entityId").and_then(Value::as_str).ok_or("同步变化缺少 entityId")?;
            let operation = change.get("operation").and_then(Value::as_str).ok_or("同步变化缺少 operation")?;
            let payload = change.get("payload").cloned().unwrap_or_else(|| json!({}));
            let revision = change.get("serverRevision").and_then(Value::as_i64).unwrap_or(1);
            if entity_type == "relations" {
                let from_id = payload.get("fromId").and_then(Value::as_str).unwrap_or("");
                let to_id = payload.get("toId").and_then(Value::as_str).unwrap_or("");
                let relation_type = payload.get("relationType").and_then(Value::as_str).unwrap_or("manual");
                if operation == "RELATION_REMOVE" || payload.get("deletedAt").is_some() {
                    connection.execute("DELETE FROM relations WHERE id=?1 OR (from_id=?2 AND to_id=?3 AND relation_type=?4)", params![entity_id,from_id,to_id,relation_type]).map_err(|e| e.to_string())?;
                } else {
                    connection.execute("INSERT INTO relations(id,from_id,to_id,relation_type,created_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(from_id,to_id,relation_type) DO NOTHING", params![entity_id,from_id,to_id,relation_type,payload.get("createdAt").and_then(Value::as_str).unwrap_or(&now())]).map_err(|e| e.to_string())?;
                }
            } else {
                let mut record = payload;
                let object = record.as_object_mut().ok_or("同步 payload 必须是对象")?;
                object.insert("id".into(), Value::String(entity_id.into()));
                object.insert("entity".into(), Value::String(entity_type.into()));
                object.insert("revision".into(), Value::Number(revision.into()));
                if object.get("createdAt").is_none() { object.insert("createdAt".into(), Value::String(now())); }
                if object.get("updatedAt").is_none() { object.insert("updatedAt".into(), Value::String(now())); }
                write_synced_record(&connection, &record)?;
                connection.execute("UPDATE records SET revision=?2 WHERE id=?1", params![entity_id,revision]).map_err(|e| e.to_string())?;
            }
        }
        repair_notebook_category_references(&connection)?;
        connection.execute("UPDATE sync_state SET server_cursor=max(server_cursor,?1),last_synced_at=?2 WHERE workspace_id='local'", params![server_cursor,now()]).map_err(|e| e.to_string())?;
        connection.execute("DELETE FROM settings WHERE key='sync.apply_mode'", []).map_err(|e| e.to_string())?;
        Ok(changes.len())
    })();
    match result {
        Ok(count) => { connection.execute_batch("COMMIT").map_err(|e| e.to_string())?; Ok(count) }
        Err(error) => { let _ = connection.execute_batch("ROLLBACK"); Err(error) }
    }
}

#[tauri::command]
fn list_sync_conflicts(app: AppHandle) -> Result<Vec<Value>, String> {
    let connection = db(&app)?;
    let mut statement = connection.prepare("SELECT conflict_id,entity_type,entity_id,local_revision,server_revision,fields_json,local_payload_json,remote_payload_json,created_at,resolved_at,resolution FROM sync_conflicts ORDER BY created_at DESC").map_err(|e| e.to_string())?;
    let rows = statement.query_map([], |row| Ok(json!({"conflictId":row.get::<_,String>(0)?,"entityType":row.get::<_,String>(1)?,"entityId":row.get::<_,String>(2)?,"localRevision":row.get::<_,i64>(3)?,"serverRevision":row.get::<_,i64>(4)?,"fields":serde_json::from_str::<Value>(&row.get::<_,String>(5)?).unwrap_or(json!([])),"localPayload":serde_json::from_str::<Value>(&row.get::<_,String>(6)?).unwrap_or(json!({})),"remotePayload":serde_json::from_str::<Value>(&row.get::<_,String>(7)?).unwrap_or(json!({})),"createdAt":row.get::<_,String>(8)?,"resolvedAt":row.get::<_,Option<String>>(9)?,"resolution":row.get::<_,Option<String>>(10)?}))).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_sync_conflict(app: AppHandle, conflict: Value) -> Result<(), String> {
    let connection = db(&app)?;
    connection.execute("INSERT OR REPLACE INTO sync_conflicts(conflict_id,entity_type,entity_id,local_revision,server_revision,fields_json,local_payload_json,remote_payload_json,created_at,resolved_at,resolution) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,NULL,NULL)", params![
        conflict.get("conflictId").and_then(Value::as_str).ok_or("冲突缺少 ID")?,
        conflict.get("entityType").and_then(Value::as_str).ok_or("冲突缺少实体")?,
        conflict.get("entityId").and_then(Value::as_str).ok_or("冲突缺少记录")?,
        conflict.get("localRevision").and_then(Value::as_i64).unwrap_or(0),
        conflict.get("serverRevision").and_then(Value::as_i64).unwrap_or(0),
        serde_json::to_string(conflict.get("fields").unwrap_or(&json!([]))).map_err(|e| e.to_string())?,
        serde_json::to_string(conflict.get("localPayload").unwrap_or(&json!({}))).map_err(|e| e.to_string())?,
        serde_json::to_string(conflict.get("remotePayload").unwrap_or(&json!({}))).map_err(|e| e.to_string())?,
        now()
    ]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_record(app: AppHandle, entity: String, mut data: Value) -> Result<Value, String> {
    if !is_entity(&entity) {
        return Err("Unknown entity".into());
    }
    if entity == "timelineEvents" {
        return Err("时间线事件只能由系统生成，不能手动创建或修改".into());
    }
    let id = data
        .get("id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| new_id(&entity));
    let connection = db(&app)?;
    let existing = record_by_id(&connection, &id)?;
    if entity == "researchResults" {
        if let Some(existing) = existing.as_ref() {
            validate_research_result_snapshot(existing, &data)?;
        }
    }
    if NOTEBOOK_ENTITIES.contains(&entity.as_str()) {
        let existing_owner = existing
            .as_ref()
            .and_then(|record| record.get("ownerId"))
            .and_then(Value::as_str)
            .unwrap_or(LOCAL_NOTEBOOK_OWNER);
        if existing_owner != LOCAL_NOTEBOOK_OWNER {
            return Err("无权访问其他用户的 Notebook 内容".into());
        }
        let object = data.as_object_mut().ok_or("Notebook 数据必须是对象")?;
        if let Some(owner) = object.get("ownerId").and_then(Value::as_str) {
            if !owner.is_empty() && owner != LOCAL_NOTEBOOK_OWNER {
                return Err("不能写入其他用户的 Notebook 内容".into());
            }
        }
        object.insert("ownerId".into(), Value::String(LOCAL_NOTEBOOK_OWNER.into()));
    }
    if entity == "decisions" && existing.is_none() {
        finance::freeze_decision_snapshot(&connection, &mut data, &now())?;
    }
    let saved_at = now();
    if entity == "tasks" {
        apply_task_execution_fields(&mut data, existing.as_ref(), &saved_at);
    }
    ensure_external_source_capacity(&connection, &entity, &id, &data)?;
    let created_at = existing
        .as_ref()
        .and_then(|record| record.get("createdAt"))
        .and_then(Value::as_str)
        .or_else(|| data.get("createdAt").and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| saved_at.clone());
    let normalized = normalize_record(&connection, &entity, &data, true)?;
    finance::validate_transition(&entity, existing.as_ref(), &normalized)?;
    finance::validate_allocation(&connection, &entity, &id, &normalized)?;
    let enriched = apply_timeline_metadata(&entity, &normalized, &created_at, &saved_at);
    if entity == "timeLogs" && enriched["isRunning"].as_bool().unwrap_or(false) {
        let another_running: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM records WHERE entity='timeLogs' AND id<>?1 AND archived_at IS NULL AND deleted_at IS NULL AND json_extract(data_json,'$.isRunning')=1)",
            params![id],
            |row| row.get(0),
        ).map_err(|error| error.to_string())?;
        if another_running {
            return Err("全局已有正在运行的计时器".into());
        }
    }
    let saved = write_record(&connection, &entity, &id, &enriched, Some(&created_at))?;
    if entity == "notes" {
        coalesce_pending_note_updates(&connection, &id)?;
    }
    sync_relations(&connection, &id, &enriched)?;
    if entity == "projects" || entity == "tasks" {
        cascade_context(&connection, &entity, &id)?;
    }
    write_timeline_change_events(&connection, &entity, &id, existing.as_ref(), &saved)?;
    Ok(saved)
}

fn coalesce_pending_note_updates(connection: &Connection, id: &str) -> Result<(), String> {
    connection.execute(
        "DELETE FROM sync_outbox
         WHERE entity_type='notes' AND entity_id=?1 AND operation='UPDATE'
           AND rowid NOT IN (
             SELECT rowid FROM sync_outbox
             WHERE entity_type='notes' AND entity_id=?1 AND operation='UPDATE'
             ORDER BY rowid DESC LIMIT 1
           )",
        params![id],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

fn delete_record_from_connection(connection: &Connection, id: &str) -> Result<(), String> {
    let Some(mut data) = record_by_id(&connection, &id)? else {
        return Err("记录不存在".into());
    };
    if data["entity"].as_str() == Some("financialTransactions")
        && data["status"].as_str().unwrap_or("POSTED") != "DRAFT"
    {
        return Err("已入账财务流水不能删除；请将状态改为 VOIDED 并填写作废原因".into());
    }
    let entity = data["entity"].as_str().unwrap_or("").to_string();
    if NOTEBOOK_ENTITIES.contains(&entity.as_str())
        && data["ownerId"].as_str().unwrap_or(LOCAL_NOTEBOOK_OWNER) != LOCAL_NOTEBOOK_OWNER
    {
        return Err("无权删除其他用户的 Notebook 内容".into());
    }
    if entity == "notebookCategories" {
        clear_notebook_category_ownership(connection, id)?;
    }
    if entity == "notebookFiles" && notebook_file_reference_count(connection, id)? > 0 {
        return Err("文件仍被笔记或业务记录引用，不能删除".into());
    }
    let deleted_at = now();
    if let Some(object) = data.as_object_mut() {
        object.remove("archivedAt");
        object.insert("deletedAt".into(), Value::String(deleted_at.clone()));
    }
    let created = data["createdAt"].as_str().map(str::to_string);
    write_record(&connection, &entity, &id, &data, created.as_deref())?;
    connection
        .execute(
            "UPDATE records SET archived_at=NULL, deleted_at=?2 WHERE id=?1",
            params![id, deleted_at],
        )
        .map_err(|e| e.to_string())?;
    connection
        .execute("DELETE FROM records_fts WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    if !["researchRequests", "researchResults"].contains(&entity.as_str()) {
        connection
            .execute(
                "DELETE FROM relations WHERE from_id=?1 OR to_id=?1",
                params![id],
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn archive_record_from_connection(connection: &Connection, id: &str) -> Result<(), String> {
    let Some(mut data) = record_by_id(&connection, &id)? else {
        return Err("记录不存在".into());
    };
    if data["entity"].as_str() == Some("financialTransactions")
        && data["status"].as_str().unwrap_or("POSTED") != "DRAFT"
    {
        return Err("已入账财务流水不能归档或删除；请将状态改为 VOIDED 并填写作废原因".into());
    }
    let archived_at = now();
    if let Some(object) = data.as_object_mut() {
        object.insert("archivedAt".into(), Value::String(archived_at.clone()));
    }
    let entity = data["entity"].as_str().unwrap_or("").to_string();
    if NOTEBOOK_ENTITIES.contains(&entity.as_str())
        && data["ownerId"].as_str().unwrap_or(LOCAL_NOTEBOOK_OWNER) != LOCAL_NOTEBOOK_OWNER
    {
        return Err("无权归档其他用户的 Notebook 内容".into());
    }
    let created = data["createdAt"].as_str().map(str::to_string);
    write_record(&connection, &entity, &id, &data, created.as_deref())?;
    connection
        .execute(
            "UPDATE records SET archived_at=?2 WHERE id=?1",
            params![id, archived_at],
        )
        .map_err(|e| e.to_string())?;
    connection
        .execute("DELETE FROM records_fts WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn unique_record_ids(ids: Vec<String>) -> Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    let ids = ids
        .into_iter()
        .filter(|id| !id.trim().is_empty() && seen.insert(id.clone()))
        .collect::<Vec<_>>();
    if ids.is_empty() {
        return Err("请至少选择一条记录".into());
    }
    Ok(ids)
}

fn apply_record_batch(
    connection: &Connection,
    ids: Vec<String>,
    action: fn(&Connection, &str) -> Result<(), String>,
) -> Result<(), String> {
    let ids = unique_record_ids(ids)?;
    connection
        .execute_batch("BEGIN IMMEDIATE")
        .map_err(|error| error.to_string())?;
    let result = ids.iter().try_for_each(|id| action(connection, id));
    match result {
        Ok(()) => connection.execute_batch("COMMIT").map_err(|error| error.to_string()),
        Err(error) => {
            let _ = connection.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

#[tauri::command]
fn delete_record(app: AppHandle, id: String) -> Result<(), String> {
    let connection = db(&app)?;
    connection.execute_batch("BEGIN IMMEDIATE").map_err(|error| error.to_string())?;
    match delete_record_from_connection(&connection, &id) {
        Ok(()) => connection.execute_batch("COMMIT").map_err(|error| error.to_string()),
        Err(error) => {
            let _ = connection.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

#[tauri::command]
fn delete_records(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    let connection = db(&app)?;
    apply_record_batch(&connection, ids, delete_record_from_connection)
}

#[tauri::command]
fn archive_record(app: AppHandle, id: String) -> Result<(), String> {
    let connection = db(&app)?;
    archive_record_from_connection(&connection, &id)
}

#[tauri::command]
fn archive_records(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    let connection = db(&app)?;
    apply_record_batch(&connection, ids, archive_record_from_connection)
}

#[tauri::command]
fn restore_record(app: AppHandle, id: String) -> Result<Value, String> {
    let connection = db(&app)?;
    let (entity, raw, created): (String, String, String) = connection
        .query_row(
            "SELECT entity, data_json, created_at FROM records WHERE id=?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| "记录不存在".to_string())?;
    let mut data: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if let Some(object) = data.as_object_mut() {
        object.remove("archivedAt");
        object.remove("deletedAt");
    }
    connection
        .execute(
            "UPDATE records SET archived_at=NULL, deleted_at=NULL WHERE id=?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
    let saved = write_record(&connection, &entity, &id, &data, Some(&created))?;
    sync_relations(&connection, &id, &data)?;
    Ok(saved)
}

#[tauri::command]
fn list_archived(app: AppHandle) -> Result<Vec<Value>, String> {
    let connection = db(&app)?;
    let mut statement = connection.prepare(
        "SELECT id, entity, data_json, created_at, updated_at FROM records WHERE archived_at IS NOT NULL AND deleted_at IS NULL ORDER BY archived_at DESC"
    ).map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(value_to_record(
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn search_filtered(
    connection: &Connection,
    query: &str,
    entities: &[String],
) -> Result<Vec<Value>, String> {
    let trimmed = query.trim();
    let mut results = Vec::new();
    if trimmed.is_empty() {
        let mut statement = connection.prepare(
            "SELECT id, entity, data_json, created_at, updated_at FROM records WHERE archived_at IS NULL AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 80"
        ).map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok(value_to_record(
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            results.push(row.map_err(|e| e.to_string())?);
        }
    } else {
        let sanitized = trimmed.replace('"', "");
        let fts_query = sanitized
            .split_whitespace()
            .filter(|value| !value.is_empty())
            .map(|value| format!("\"{}\"*", value.replace(['*', ':', '(', ')'], "")))
            .collect::<Vec<_>>()
            .join(" ");
        if !fts_query.is_empty() {
            let mut statement = connection.prepare(
                "SELECT r.id, r.entity, r.data_json, r.created_at, r.updated_at FROM records_fts f JOIN records r ON r.id=f.id WHERE records_fts MATCH ?1 AND r.archived_at IS NULL AND r.deleted_at IS NULL ORDER BY rank LIMIT 80"
            ).map_err(|e| e.to_string())?;
            let rows = statement
                .query_map(params![fts_query], |row| {
                    Ok(value_to_record(
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                })
                .map_err(|e| e.to_string())?;
            for row in rows {
                results.push(row.map_err(|e| e.to_string())?);
            }
        }
        if results.is_empty() {
            let pattern = format!("%{}%", trimmed);
            let mut statement = connection.prepare(
                "SELECT id, entity, data_json, created_at, updated_at FROM records WHERE archived_at IS NULL AND deleted_at IS NULL AND (title LIKE ?1 OR body LIKE ?1) ORDER BY updated_at DESC LIMIT 80"
            ).map_err(|e| e.to_string())?;
            let rows = statement
                .query_map(params![pattern], |row| {
                    Ok(value_to_record(
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                })
                .map_err(|e| e.to_string())?;
            for row in rows {
                results.push(row.map_err(|e| e.to_string())?);
            }
        }
    }
    if entities.is_empty() {
        return Ok(results);
    }
    Ok(results
        .into_iter()
        .filter(|record| {
            record["entity"]
                .as_str()
                .map(|e| entities.iter().any(|selected| selected == e))
                .unwrap_or(false)
        })
        .collect())
}

#[tauri::command]
fn search_records(app: AppHandle, query: String) -> Result<Vec<Value>, String> {
    search_filtered(&db(&app)?, &query, &[])
}

#[tauri::command]
fn search_records_filtered(
    app: AppHandle,
    query: String,
    entities: Vec<String>,
) -> Result<Vec<Value>, String> {
    search_filtered(&db(&app)?, &query, &entities)
}

#[tauri::command]
fn list_relations(app: AppHandle, id: String) -> Result<Vec<Value>, String> {
    let connection = db(&app)?;
    let mut statement = connection.prepare(
        "SELECT relation_type, from_id, to_id FROM relations WHERE from_id=?1 OR to_id=?1 ORDER BY created_at DESC"
    ).map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(params![id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut related = Vec::new();
    for row in rows {
        let (relation_type, from_id, to_id) = row.map_err(|e| e.to_string())?;
        let related_id = if from_id == id { &to_id } else { &from_id };
        if let Some(mut record) = record_by_id(&connection, related_id)? {
            if let Some(object) = record.as_object_mut() {
                object.insert("relationType".into(), Value::String(relation_type));
                object.insert(
                    "relationDirection".into(),
                    Value::String(
                        if from_id == id {
                            "outgoing"
                        } else {
                            "incoming"
                        }
                        .into(),
                    ),
                );
            }
            related.push(record);
        }
    }
    Ok(related)
}

#[tauri::command]
fn add_relation(
    app: AppHandle,
    from_id: String,
    to_id: String,
    relation_type: String,
) -> Result<(), String> {
    if from_id == to_id {
        return Err("不能关联记录自身".into());
    }
    let connection = db(&app)?;
    let from = record_by_id(&connection, &from_id)?.ok_or("关联记录不存在")?;
    let to = record_by_id(&connection, &to_id)?.ok_or("关联记录不存在")?;
    for record in [&from, &to] {
        if NOTEBOOK_ENTITIES.contains(&record["entity"].as_str().unwrap_or(""))
            && record["ownerId"].as_str().unwrap_or(LOCAL_NOTEBOOK_OWNER) != LOCAL_NOTEBOOK_OWNER
        {
            return Err("无权关联其他用户的 Notebook 内容".into());
        }
    }
    connection.execute(
        "INSERT OR IGNORE INTO relations(id, from_id, to_id, relation_type, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![new_id("relation"), from_id, to_id, relation_type, now()],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn remove_relation(
    app: AppHandle,
    from_id: String,
    to_id: String,
    relation_type: String,
) -> Result<(), String> {
    if relation_type.starts_with("field:") {
        return Err("字段派生关系不能直接删除，请编辑来源记录字段".into());
    }
    db(&app)?
        .execute(
            "DELETE FROM relations WHERE from_id=?1 AND to_id=?2 AND relation_type=?3",
            params![from_id, to_id, relation_type],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn safe_file_name(name: &str) -> String {
    let cleaned = name
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => '_',
            _ if character.is_control() => '_',
            _ => character,
        })
        .collect::<String>();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "untitled".into()
    } else {
        trimmed.into()
    }
}

fn truncate_notebook_text(value: String, limit: usize) -> (String, bool) {
    if value.chars().count() <= limit {
        return (value, false);
    }
    (
        format!(
            "{}\n[内容已截断]",
            value.chars().take(limit).collect::<String>()
        ),
        true,
    )
}

fn strip_xml(value: &str) -> String {
    let without_tags = Regex::new(r"<[^>]+>").unwrap().replace_all(value, " ");
    without_tags
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn extract_with_textutil(path: &Path) -> Result<String, String> {
    let output = Command::new("/usr/bin/textutil")
        .args(["-convert", "txt", "-stdout"])
        .arg(path)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn extract_pdf_with_pdfkit(path: &Path) -> Result<String, String> {
    let script = r#"import Foundation
import PDFKit
let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let document = PDFDocument(url: url) else { exit(1) }
for index in 0..<document.pageCount {
  if let text = document.page(at: index)?.string { print(text) }
}"#;
    let output = Command::new("/usr/bin/swift")
        .arg("-e")
        .arg(script)
        .arg(path)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn render_pdf_page(path: &Path, page: usize) -> Result<(usize, Vec<u8>), String> {
    let script = r#"import AppKit
import Foundation
import PDFKit
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let index = Int(CommandLine.arguments[2]) ?? 0
guard let document = PDFDocument(url: url), index >= 0, index < document.pageCount,
      let page = document.page(at: index) else { exit(1) }
let bounds = page.bounds(for: .mediaBox)
let width: CGFloat = 1200
let scale = width / bounds.width
let size = NSSize(width: width, height: max(1, bounds.height * scale))
let image = NSImage(size: size)
image.lockFocus()
NSColor.white.setFill()
NSBezierPath(rect: NSRect(origin: .zero, size: size)).fill()
guard let context = NSGraphicsContext.current?.cgContext else { exit(1) }
context.saveGState()
context.translateBy(x: 0, y: size.height)
context.scaleBy(x: scale, y: -scale)
page.draw(with: .mediaBox, to: context)
context.restoreGState()
image.unlockFocus()
guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
      let png = bitmap.representation(using: .png, properties: [:]) else { exit(1) }
print("\(document.pageCount)")
FileHandle.standardOutput.write(png)
"#;
    let output = Command::new("/usr/bin/swift")
        .arg("-e")
        .arg(script)
        .arg(path)
        .arg(page.to_string())
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let Some(separator) = output.stdout.iter().position(|byte| *byte == b'\n') else {
        return Err("PDF 页面渲染未返回页数".into());
    };
    let page_count = String::from_utf8_lossy(&output.stdout[..separator])
        .trim()
        .parse::<usize>()
        .map_err(|error| error.to_string())?;
    Ok((page_count, output.stdout[separator + 1..].to_vec()))
}

fn extract_office_xml(path: &Path, extension: &str) -> Result<String, String> {
    let listing = Command::new("/usr/bin/unzip")
        .args(["-Z1"])
        .arg(path)
        .output()
        .map_err(|error| error.to_string())?;
    if !listing.status.success() {
        return Err(String::from_utf8_lossy(&listing.stderr).trim().to_string());
    }
    let listing_text = String::from_utf8_lossy(&listing.stdout);
    let names = listing_text
        .lines()
        .filter(|name| match extension {
            "docx" => name.starts_with("word/") && name.ends_with(".xml"),
            "pptx" => name.starts_with("ppt/slides/") && name.ends_with(".xml"),
            "xlsx" => {
                (name.starts_with("xl/worksheets/") || *name == "xl/sharedStrings.xml")
                    && name.ends_with(".xml")
            }
            _ => false,
        })
        .take(80)
        .collect::<Vec<_>>();
    if names.is_empty() {
        return Err("没有可提取的 Office XML 内容".into());
    }
    let output = Command::new("/usr/bin/unzip")
        .arg("-p")
        .arg(path)
        .args(names)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(strip_xml(&String::from_utf8_lossy(&output.stdout)))
}

fn extract_notebook_content(path: &Path, extension: &str) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() > 200 * 1024 * 1024 {
        return Err("文件超过 200 MB，跳过内容提取；原文件已安全保存".into());
    }
    let raw_text_extensions = [
        "txt", "md", "markdown", "csv", "json", "yaml", "yml", "xml", "html", "htm", "css", "js",
        "ts", "jsx", "tsx", "py", "sql", "rtf",
    ];
    let content = if raw_text_extensions.contains(&extension) {
        String::from_utf8_lossy(&fs::read(path).map_err(|error| error.to_string())?).to_string()
    } else if extension == "pdf" {
        extract_pdf_with_pdfkit(path)?
    } else if ["doc", "docx", "odt", "pages"].contains(&extension) {
        extract_with_textutil(path).or_else(|_| extract_office_xml(path, "docx"))?
    } else if ["pptx", "xlsx"].contains(&extension) {
        extract_office_xml(path, extension)?
    } else if ["ppt", "xls", "numbers", "key"].contains(&extension) {
        extract_with_textutil(path)?
    } else {
        return Err("该文件类型当前只保存原始文件和 Metadata".into());
    };
    Ok(truncate_notebook_text(content, NOTEBOOK_EXTRACT_LIMIT).0)
}

fn apply_notebook_extraction(data: &mut Value, path: &Path) {
    let extension = data["extension"].as_str().unwrap_or("").to_string();
    let object = data.as_object_mut().unwrap();
    match extract_notebook_content(path, &extension) {
        Ok(content) if !content.trim().is_empty() => {
            object.insert("extractedContent".into(), Value::String(content));
            object.insert("extractStatus".into(), Value::String("READY".into()));
            object.insert("extractedAt".into(), Value::String(now()));
            object.remove("extractionError");
        }
        Ok(_) => {
            object.insert("extractStatus".into(), Value::String("UNAVAILABLE".into()));
            object.insert(
                "extractionError".into(),
                Value::String("未提取到可搜索文本".into()),
            );
        }
        Err(error) => {
            object.insert("extractStatus".into(), Value::String("UNAVAILABLE".into()));
            object.insert("extractionError".into(), Value::String(error));
        }
    }
}

fn notebook_files_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("notebook-files"))
}

fn notebook_uploads_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = notebook_files_dir(app)?.join(".uploads");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn notebook_file_path(app: &AppHandle, record: &Value) -> Result<PathBuf, String> {
    if record["entity"].as_str() != Some("notebookFiles") {
        return Err("不是 Notebook 文件".into());
    }
    if record["ownerId"].as_str().unwrap_or(LOCAL_NOTEBOOK_OWNER) != LOCAL_NOTEBOOK_OWNER {
        return Err("无权访问其他用户的 Notebook 文件".into());
    }
    let path = if let Some(key) = record["storageKey"].as_str() {
        notebook_files_dir(app)?.join(safe_file_name(key))
    } else {
        PathBuf::from(record["storagePath"].as_str().ok_or("文件缺少 storageKey")?)
    };
    if !path.starts_with(notebook_files_dir(app)?) || !path.exists() {
        return Err("文件路径无效或文件不存在".into());
    }
    Ok(path)
}

fn notebook_file_data(
    id: String,
    name: String,
    mime_type: String,
    path: &Path,
    notebook_category_id: Option<String>,
    notebook_folder_id: Option<String>,
    relative_path: Option<String>,
) -> Result<Value, String> {
    let safe_name = safe_file_name(&name);
    let extension = Path::new(&safe_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    let mut data = json!({
        "id": id,
        "name": safe_name,
        "originalName": name,
        "extension": extension,
        "mimeType": mime_type,
        "size": fs::metadata(path).map_err(|error| error.to_string())?.len(),
        "storageKey": path.file_name().and_then(|value| value.to_str()).unwrap_or_default(),
        "sha256": file_sha256(path)?,
        "localState": "LOCAL_AVAILABLE",
        "relativePath": relative_path.unwrap_or_default(),
        "status": "ACTIVE",
        "ownerId": LOCAL_NOTEBOOK_OWNER
    });
    if let Some(object) = data.as_object_mut() {
        if let Some(value) = notebook_category_id.filter(|value| !value.trim().is_empty()) {
            object.insert("notebookCategoryId".into(), Value::String(value));
        }
        if let Some(value) = notebook_folder_id.filter(|value| !value.trim().is_empty()) {
            object.insert("notebookFolderId".into(), Value::String(value));
        }
    }
    apply_notebook_extraction(&mut data, path);
    Ok(data)
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let a = chunk[0];
        let b = *chunk.get(1).unwrap_or(&0);
        let c = *chunk.get(2).unwrap_or(&0);
        output.push(TABLE[(a >> 2) as usize] as char);
        output.push(TABLE[((a & 0b0000_0011) << 4 | b >> 4) as usize] as char);
        output.push(if chunk.len() > 1 {
            TABLE[((b & 0b0000_1111) << 2 | c >> 6) as usize] as char
        } else {
            '='
        });
        output.push(if chunk.len() > 2 {
            TABLE[(c & 0b0011_1111) as usize] as char
        } else {
            '='
        });
    }
    output
}

fn notebook_max_file_size(app: &AppHandle) -> Result<u64, String> {
    let value = db(app)?
        .query_row(
            "SELECT value FROM settings WHERE key='notebook_max_file_size'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    Ok(value
        .and_then(|item| item.parse::<u64>().ok())
        .unwrap_or(NOTEBOOK_MAX_FILE_SIZE))
}

#[tauri::command]
fn get_notebook_storage_config(app: AppHandle) -> Result<Value, String> {
    Ok(json!({"maxFileSize": notebook_max_file_size(&app)?, "chunkSize": NOTEBOOK_CHUNK_SIZE}))
}

#[tauri::command]
fn set_notebook_storage_config(app: AppHandle, max_file_size: u64) -> Result<Value, String> {
    if !(1024 * 1024..=10 * 1024 * 1024 * 1024).contains(&max_file_size) {
        return Err("文件大小上限必须在 1 MB 到 10 GB 之间".into());
    }
    db(&app)?.execute(
        "INSERT INTO settings(key,value,updated_at) VALUES ('notebook_max_file_size',?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        params![max_file_size.to_string(), now()],
    ).map_err(|error| error.to_string())?;
    get_notebook_storage_config(app)
}

#[tauri::command]
fn begin_notebook_file_upload(app: AppHandle, _name: String, size: u64) -> Result<Value, String> {
    let max_file_size = notebook_max_file_size(&app)?;
    if size > max_file_size {
        return Err(format!(
            "文件超过当前允许上限（{} MB）",
            max_file_size / 1024 / 1024
        ));
    }
    let upload_id = new_id("notebook-upload");
    let path = notebook_uploads_dir(&app)?.join(format!("{upload_id}.part"));
    fs::File::create(path).map_err(|error| error.to_string())?;
    Ok(json!({"uploadId": upload_id, "chunkSize": NOTEBOOK_CHUNK_SIZE}))
}

#[tauri::command]
fn append_notebook_file_upload(
    app: AppHandle,
    upload_id: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    if bytes.len() > NOTEBOOK_CHUNK_SIZE {
        return Err("上传分块超过允许大小".into());
    }
    let path = notebook_uploads_dir(&app)?.join(format!("{}.part", safe_file_name(&upload_id)));
    let mut file = OpenOptions::new()
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    file.write_all(&bytes).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn finish_notebook_file_upload(
    app: AppHandle,
    upload_id: String,
    name: String,
    mime_type: String,
    notebook_category_id: Option<String>,
    notebook_folder_id: Option<String>,
    relative_path: Option<String>,
) -> Result<Value, String> {
    let temporary_path =
        notebook_uploads_dir(&app)?.join(format!("{}.part", safe_file_name(&upload_id)));
    let size = fs::metadata(&temporary_path)
        .map_err(|_| "上传临时文件不存在".to_string())?
        .len();
    if size > notebook_max_file_size(&app)? {
        let _ = fs::remove_file(&temporary_path);
        return Err("文件超过当前允许上限".into());
    }
    let id = new_id("notebookFiles");
    let safe_name = safe_file_name(&name);
    let extension = Path::new(&safe_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let stored_name = if extension.is_empty() {
        id.clone()
    } else {
        format!("{id}.{}", extension.to_lowercase())
    };
    let storage_path = notebook_files_dir(&app)?.join(stored_name);
    fs::rename(&temporary_path, &storage_path).map_err(|error| error.to_string())?;
    let data = notebook_file_data(
        id,
        name,
        mime_type,
        &storage_path,
        notebook_category_id,
        notebook_folder_id,
        relative_path,
    )?;
    save_record(app, "notebookFiles".into(), data)
}

#[tauri::command]
fn upload_notebook_file(
    app: AppHandle,
    name: String,
    mime_type: String,
    bytes: Vec<u8>,
    notebook_category_id: Option<String>,
    notebook_folder_id: Option<String>,
    relative_path: Option<String>,
) -> Result<Value, String> {
    if bytes.len() as u64 > notebook_max_file_size(&app)? {
        return Err("文件超过当前允许上限".into());
    }
    let id = new_id("notebookFiles");
    let safe_name = safe_file_name(&name);
    let extension = Path::new(&safe_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let stored_name = if extension.is_empty() {
        id.clone()
    } else {
        format!("{id}.{}", extension.to_lowercase())
    };
    let storage_path = notebook_files_dir(&app)?.join(stored_name);
    fs::write(&storage_path, bytes).map_err(|error| error.to_string())?;
    let data = notebook_file_data(
        id,
        name,
        mime_type,
        &storage_path,
        notebook_category_id,
        notebook_folder_id,
        relative_path,
    )?;
    save_record(app, "notebookFiles".into(), data)
}

#[tauri::command]
fn open_notebook_file(app: AppHandle, id: String) -> Result<(), String> {
    let record = record_by_id(&db(&app)?, &id)?.ok_or("文件不存在")?;
    let path = notebook_file_path(&app, &record)?;
    Command::new("open")
        .arg(path)
        .status()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn reveal_notebook_file(app: AppHandle, id: String) -> Result<(), String> {
    let record = record_by_id(&db(&app)?, &id)?.ok_or("文件不存在")?;
    let path = notebook_file_path(&app, &record)?;
    Command::new("open")
        .args(["-R"])
        .arg(path)
        .status()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_notebook_file_preview(app: AppHandle, id: String) -> Result<Value, String> {
    let record = record_by_id(&db(&app)?, &id)?.ok_or("文件不存在")?;
    let path = notebook_file_path(&app, &record)?;
    let extension = record["extension"].as_str().unwrap_or("").to_lowercase();
    let mime_type = record["mimeType"]
        .as_str()
        .filter(|value| !value.is_empty())
        .unwrap_or("application/octet-stream");
    if [
        "txt", "md", "markdown", "csv", "json", "yaml", "yml", "xml", "html", "htm", "css", "js",
        "ts", "jsx", "tsx", "py", "sql", "doc", "docx", "odt", "pages", "ppt", "pptx", "xls",
        "xlsx", "numbers", "key", "pdf",
    ]
    .contains(&extension.as_str())
    {
        let content = record["extractedContent"]
            .as_str()
            .unwrap_or("")
            .to_string();
        if extension == "pdf" {
            let (page_count, png) = render_pdf_page(&path, 0)?;
            return Ok(json!({"kind":"pdf", "page": 0, "pageCount": page_count, "dataUrl": format!("data:image/png;base64,{}", base64_encode(&png)), "text": truncate_notebook_text(content, 24_000).0}));
        }
        return Ok(
            json!({"kind":"text", "text": truncate_notebook_text(content, 24_000).0, "extractStatus": record["extractStatus"]}),
        );
    }
    if mime_type.starts_with("image/") {
        let bytes = fs::read(path).map_err(|error| error.to_string())?;
        return Ok(json!({"kind":"image", "dataUrl": format!("data:{mime_type};base64,{}", base64_encode(&bytes))}));
    }
    if mime_type.starts_with("audio/") {
        let bytes = fs::read(path).map_err(|error| error.to_string())?;
        return Ok(json!({"kind":"audio", "dataUrl": format!("data:{mime_type};base64,{}", base64_encode(&bytes))}));
    }
    if mime_type.starts_with("video/") {
        let bytes = fs::read(path).map_err(|error| error.to_string())?;
        return Ok(json!({"kind":"video", "dataUrl": format!("data:{mime_type};base64,{}", base64_encode(&bytes))}));
    }
    Ok(json!({"kind":"unsupported", "reason":"该类型暂不支持内嵌预览，可在本机打开"}))
}

#[tauri::command]
fn get_notebook_pdf_page(app: AppHandle, id: String, page: usize) -> Result<Value, String> {
    let record = record_by_id(&db(&app)?, &id)?.ok_or("文件不存在")?;
    if record["extension"].as_str().unwrap_or("").to_lowercase() != "pdf" {
        return Err("当前文件不是 PDF".into());
    }
    let path = notebook_file_path(&app, &record)?;
    let (page_count, png) = render_pdf_page(&path, page)?;
    Ok(json!({"kind":"pdf", "page": page, "pageCount": page_count, "dataUrl": format!("data:image/png;base64,{}", base64_encode(&png)), "text": truncate_notebook_text(record["extractedContent"].as_str().unwrap_or("").to_string(), 24_000).0}))
}

#[tauri::command]
fn extract_notebook_file_content(app: AppHandle, id: String) -> Result<Value, String> {
    let connection = db(&app)?;
    let mut record = record_by_id(&connection, &id)?.ok_or("文件不存在")?;
    let path = notebook_file_path(&app, &record)?;
    apply_notebook_extraction(&mut record, &path);
    save_record(app, "notebookFiles".into(), record)
}

#[tauri::command]
fn copy_notebook_file(
    app: AppHandle,
    id: String,
    notebook_category_id: Option<String>,
    notebook_folder_id: Option<String>,
) -> Result<Value, String> {
    let source = record_by_id(&db(&app)?, &id)?.ok_or("文件不存在")?;
    let source_path = notebook_file_path(&app, &source)?;
    let copy_id = new_id("notebookFiles");
    let extension = source["extension"].as_str().unwrap_or("");
    let destination = notebook_files_dir(&app)?.join(if extension.is_empty() {
        copy_id.clone()
    } else {
        format!("{copy_id}.{extension}")
    });
    fs::copy(source_path, &destination).map_err(|error| error.to_string())?;
    let source_name = source["name"].as_str().unwrap_or("未命名文件");
    let name = match Path::new(source_name)
        .extension()
        .and_then(|value| value.to_str())
    {
        Some(extension) if !extension.is_empty() => format!(
            "{} 副本.{extension}",
            Path::new(source_name)
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or(source_name)
        ),
        _ => format!("{source_name} 副本"),
    };
    let data = notebook_file_data(
        copy_id,
        name,
        source["mimeType"]
            .as_str()
            .unwrap_or("application/octet-stream")
            .into(),
        &destination,
        notebook_category_id.or_else(|| source["notebookCategoryId"].as_str().map(str::to_string)),
        notebook_folder_id.or_else(|| source["notebookFolderId"].as_str().map(str::to_string)),
        source["relativePath"].as_str().map(str::to_string),
    )?;
    save_record(app, "notebookFiles".into(), data)
}

#[tauri::command]
fn destroy_notebook_file(app: AppHandle, id: String) -> Result<(), String> {
    let connection = db(&app)?;
    let record = record_by_id(&connection, &id)?.ok_or("文件不存在")?;
    if record["archivedAt"].as_str().is_none() {
        return Err("请先 Archive 文件，再执行永久删除".into());
    }
    if notebook_file_reference_count(&connection, &id)? > 0 {
        return Err("文件仍被笔记或业务记录引用，不能永久删除".into());
    }
    let path = notebook_file_path(&app, &record)?;
    fs::remove_file(path).map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM relations WHERE from_id=?1 OR to_id=?1",
            params![id],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute("DELETE FROM records_fts WHERE id=?1", params![id])
        .map_err(|error| error.to_string())?;
    connection
        .execute("DELETE FROM records WHERE id=?1", params![id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn notebook_file_reference_count(connection: &Connection, id: &str) -> Result<i64, String> {
    connection.query_row(
        "SELECT COUNT(*) FROM records r WHERE r.deleted_at IS NULL AND r.id<>?1 AND (
           json_extract(r.data_json,'$.fileId')=?1 OR
           EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(json_extract(r.data_json,'$.fileIds')) THEN json_extract(r.data_json,'$.fileIds') ELSE '[]' END) WHERE value=?1) OR
           instr(coalesce(json_extract(r.data_json,'$.contentHtml'),''),'jason-file://' || ?1)>0
         )",
        params![id],
        |row| row.get(0),
    ).map_err(|error| error.to_string())
}

#[tauri::command]
fn stop_timer(
    app: AppHandle,
    id: String,
    end_at: String,
    duration_minutes: i64,
) -> Result<Value, String> {
    let connection = db(&app)?;
    let mut statement = connection
        .prepare("SELECT entity, data_json, created_at FROM records WHERE id=?1")
        .map_err(|e| e.to_string())?;
    let (entity, raw, created): (String, String, String) = statement
        .query_row(params![id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(|_| "Timer not found".to_string())?;
    if entity != "timeLogs" {
        return Err("Record is not a time log".into());
    }
    let mut data = serde_json::from_str::<Value>(&raw).map_err(|e| e.to_string())?;
    let object = data.as_object_mut().ok_or("Invalid timer data")?;
    object.insert("endAt".into(), Value::String(end_at));
    object.insert(
        "durationMinutes".into(),
        Value::Number(duration_minutes.into()),
    );
    object.insert("isRunning".into(), Value::Bool(false));
    object.insert("status".into(), Value::String("completed".into()));
    let saved = write_record(&connection, &entity, &id, &data, Some(&created))?;
    sync_relations(&connection, &id, &data)?;
    Ok(saved)
}

fn all_records(connection: &Connection) -> Result<Vec<Value>, String> {
    let mut statement = connection.prepare("SELECT id, entity, data_json, created_at, updated_at FROM records WHERE deleted_at IS NULL ORDER BY created_at ASC").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(value_to_record(
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn research_payload(record: &Value) -> Value {
    let mut payload = record.clone();
    if let Some(object) = payload.as_object_mut() {
        for key in ["id", "entity", "createdAt", "updatedAt", "archivedAt", "deletedAt"] {
            object.remove(key);
        }
    }
    payload
}

fn migrate_research_result_architecture(connection: &Connection) -> Result<(), String> {
    let records = all_records(connection)?;
    let mut request_thread_ids = std::collections::HashMap::<String, String>::new();

    for request in records.iter().filter(|record| record["entity"] == "researchRequests") {
        let request_id = request["id"].as_str().unwrap_or("");
        if request_id.is_empty() {
            continue;
        }
        let existing_thread_id = string_field(request, "researchThreadId");
        let thread_id = if let Some(thread_id) = existing_thread_id {
            thread_id
        } else {
            let thread_id = new_id("researchThreads");
            let title = string_field(request, "title").unwrap_or_else(|| "历史调研主题".into());
            let thread = json!({
                "title": title,
                "summary": "由旧版调研需求迁移；每条旧需求独立保留，未自动合并。",
                "status": "ACTIVE",
                "legacy": true,
                "tags": request.get("tags").cloned().unwrap_or(Value::String(String::new())),
            });
            write_record(connection, "researchThreads", &thread_id, &thread, None)?;
            sync_relations(connection, &thread_id, &thread)?;
            let mut migrated = research_payload(request);
            migrated["researchThreadId"] = Value::String(thread_id.clone());
            write_record(connection, "researchRequests", request_id, &migrated, request["createdAt"].as_str())?;
            sync_relations(connection, request_id, &migrated)?;
            thread_id
        };
        request_thread_ids.insert(request_id.into(), thread_id);
    }

    let results = all_records(connection)?;
    for result in results.iter().filter(|record| record["entity"] == "researchResults") {
        let result_id = result["id"].as_str().unwrap_or("");
        if result_id.is_empty() {
            continue;
        }
        let request_id = string_field(result, "researchRequestId");
        let thread_id = if let Some(thread_id) = string_field(result, "researchThreadId")
            .or_else(|| request_id.as_ref().and_then(|id| request_thread_ids.get(id).cloned())) {
            thread_id
        } else {
            let id = new_id("researchThreads");
            let thread = json!({
                "title": format!("历史调研：{}", string_field(result, "title").unwrap_or_else(|| "未命名结果".into())),
                "summary": "由没有来源需求的旧版调研结果迁移；未与其他记录自动合并。",
                "status": "ACTIVE",
                "legacy": true,
            });
            write_record(connection, "researchThreads", &id, &thread, None)?;
            sync_relations(connection, &id, &thread)?;
            id
        };
        let existing_run_id = string_field(result, "researchRunId");
        let run_id = if let Some(run_id) = existing_run_id { run_id } else {
            let run_id = new_id("researchRuns");
            let source_request = request_id.as_ref().and_then(|id| records.iter().find(|record| record["id"].as_str() == Some(id.as_str())));
            let plan_snapshot = source_request.map(|request| json!({
                "scope": request.get("scope").cloned().unwrap_or(Value::String(String::new())),
                "dimensions": request.get("dimensions").cloned().unwrap_or(Value::String(String::new())),
                "deliverables": request.get("deliverables").cloned().unwrap_or(Value::String(String::new())),
                "sourcePlan": request.get("sourcePlan").cloned().unwrap_or(Value::String(String::new())),
            }).to_string()).unwrap_or_else(|| "{}".into());
            let run = json!({
                "title": format!("{} · 历史执行", string_field(result, "title").unwrap_or_else(|| "未命名调研".into())),
                "researchThreadId": thread_id,
                "researchRequestId": request_id,
                "status": result.get("status").cloned().unwrap_or(Value::String("COMPLETED".into())),
                "planSnapshot": plan_snapshot,
                "scopeSnapshot": source_request.and_then(|request| string_field(request, "scope")).unwrap_or_default(),
                "providerRunIds": result.get("researchRunIds").cloned().unwrap_or(Value::String(String::new())),
                "completedAt": result.get("completedAt").cloned().unwrap_or(Value::String(String::new())),
                "legacy": true,
            });
            write_record(connection, "researchRuns", &run_id, &run, result["createdAt"].as_str())?;
            sync_relations(connection, &run_id, &run)?;
            run_id
        };
        let mut migrated = research_payload(result);
        migrated["researchThreadId"] = Value::String(thread_id);
        migrated["researchRunId"] = Value::String(run_id);
        if migrated.get("executiveSummary").is_none() {
            migrated["legacyStatus"] = Value::String("LEGACY_RESULT".into());
        }
        write_record(connection, "researchResults", result_id, &migrated, result["createdAt"].as_str())?;
        sync_relations(connection, result_id, &migrated)?;
    }
    Ok(())
}

#[tauri::command]
fn export_data(app: AppHandle, format: String) -> Result<String, String> {
    if !["json", "markdown", "csv"].contains(&format.as_str()) {
        return Err("Unsupported export format".into());
    }
    let connection = db(&app)?;
    let records = all_records(&connection)?;
    let target = data_dir(&app)?
        .join("exports")
        .join(format!("jason-os-{}.{}", now(), format));
    let content = match format.as_str() {
        "json" => serde_json::to_string_pretty(
            &json!({"version": 1, "exportedAt": now(), "records": records}),
        )
        .map_err(|e| e.to_string())?,
        "markdown" => records
            .iter()
            .map(|record| {
                format!(
                    "## {} · {}\n\n{}\n",
                    record["entity"].as_str().unwrap_or("record"),
                    record["title"].as_str().unwrap_or("Untitled"),
                    serde_json::to_string_pretty(record).unwrap_or_default()
                )
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => {
            let mut out = String::from("id,entity,title,createdAt,updatedAt,data\n");
            for r in records {
                out.push_str(&format!(
                    "\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\"\n",
                    r["id"].as_str().unwrap_or(""),
                    r["entity"].as_str().unwrap_or(""),
                    r["title"].as_str().unwrap_or("").replace('"', "\"\""),
                    r["createdAt"].as_str().unwrap_or(""),
                    r["updatedAt"].as_str().unwrap_or(""),
                    serde_json::to_string(&r)
                        .unwrap_or_default()
                        .replace('"', "\"\"")
                ));
            }
            out
        }
    };
    fs::write(&target, content).map_err(|e| e.to_string())?;
    Ok(target.display().to_string())
}

#[tauri::command]
fn create_backup(app: AppHandle) -> Result<String, String> {
    let target = data_dir(&app)?
        .join("backups")
        .join(format!("jason-os-{}.sqlite3", now()));
    let connection = db(&app)?;
    connection
        .execute("VACUUM INTO ?1", params![target.display().to_string()])
        .map_err(|e| e.to_string())?;
    Ok(target.display().to_string())
}

#[tauri::command]
fn list_backups(app: AppHandle) -> Result<Vec<Value>, String> {
    let dir = data_dir(&app)?.join("backups");
    let mut backups = fs::read_dir(&dir).map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().and_then(|v| v.to_str()) == Some("sqlite3"))
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            Some(json!({
                "name": entry.file_name().to_string_lossy(),
                "path": entry.path().display().to_string(),
                "size": metadata.len(),
                "modified": metadata.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_millis().to_string()
            }))
        }).collect::<Vec<_>>();
    backups.sort_by(|a, b| b["modified"].as_str().cmp(&a["modified"].as_str()));
    Ok(backups)
}

#[tauri::command]
fn restore_backup(app: AppHandle, path: String) -> Result<(), String> {
    let backups_dir = data_dir(&app)?
        .join("backups")
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let source = PathBuf::from(&path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !source.starts_with(&backups_dir) {
        return Err("只能恢复 EvoPilot 备份目录中的文件".into());
    }
    let target = data_dir(&app)?.join("jason-os.sqlite3");
    let safety = data_dir(&app)?
        .join("backups")
        .join(format!("before-restore-{}.sqlite3", now()));
    {
        let connection = db(&app)?;
        connection
            .execute("VACUUM INTO ?1", params![safety.display().to_string()])
            .map_err(|e| e.to_string())?;
    }
    for suffix in ["-wal", "-shm"] {
        let _ = fs::remove_file(format!("{}{}", target.display(), suffix));
    }
    fs::copy(source, target).map_err(|e| e.to_string())?;
    Ok(())
}

fn setting(connection: &Connection, key: &str) -> Result<Option<String>, String> {
    connection
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())
}

fn provider_models(provider: &str) -> &'static [&'static str] {
    match provider {
        "deepseek" => &["deepseek-v4-pro", "deepseek-v4-flash"],
        "minimax" => &["MiniMax-M3"],
        "volc-agent-plan" => &[
            "kimi-k3",
            "deepseek-v4-flash",
            "glm-5.2",
            "minimax-m3",
            "doubao-seed-evolving",
            "kimi-k2.7-code",
        ],
        _ => &["gpt-5.5"],
    }
}

fn ensure_external_source_capacity(
    connection: &Connection,
    entity: &str,
    id: &str,
    data: &Value,
) -> Result<(), String> {
    if entity != "externalSources"
        || data
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("active")
            != "active"
    {
        return Ok(());
    }
    let active_sources: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM records WHERE entity='externalSources' AND id<>?1 AND archived_at IS NULL AND deleted_at IS NULL AND COALESCE(json_extract(data_json,'$.status'),'active')='active'",
            params![id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if active_sources >= 20 {
        return Err("第一版最多启用 20 个情报源；请先暂停不需要的 Source".into());
    }
    Ok(())
}

fn provider_capability(platform: &str, capability: &str, endpoint_key: &str) -> Value {
    json!({
        "platform": platform,
        "capability": capability,
        "status": "AVAILABLE",
        "endpointKey": endpoint_key,
        "costClass": "UNKNOWN",
        "latencyClass": "STANDARD"
    })
}

fn capture_provider_config(
    redfox_configured: bool,
    apify_configured: bool,
    tikhub_configured: bool,
    scrapecreators_configured: bool,
) -> Value {
    // This registry deliberately lists only endpoints implemented in this desktop app.
    // Marketing platform lists must never be used as an executable capability claim.
    json!({
        "providers": [
            {
                "id":"redfox", "code":"REDFOXHUB", "label":"RedFoxHub", "providerType":"API",
                "configured":redfox_configured, "enabled":true,
                "status": if redfox_configured { "CONFIGURED" } else { "NOT_CONFIGURED" },
                "supportedPlatforms":["微信公众号","抖音","小红书"], "automaticSync":false, "mediaDownload":false,
                "capabilities":[
                    provider_capability("微信公众号", "POST_DETAIL", "gzhData/queryArticleDetail"),
                    provider_capability("抖音", "POST_DETAIL", "dyData/queryWork"),
                    provider_capability("小红书", "POST_DETAIL", "xhsUser/queryWorkDetail")
                ]
            },
            {
                "id":"apify", "code":"APIFY", "label":"Apify", "providerType":"API",
                "configured":apify_configured, "enabled":true,
                "status": if apify_configured { "CONFIGURED" } else { "NOT_CONFIGURED" },
                "supportedPlatforms":["网页"], "automaticSync":false, "mediaDownload":false,
                "capabilities":[provider_capability("网页", "WEB_CAPTURE", "apify~website-content-crawler")]
            },
            {
                "id":"tikhub", "code":"TIKHUB", "label":"TikHub", "providerType":"API",
                "configured":tikhub_configured, "enabled":true,
                "status": if tikhub_configured { "CONFIGURED" } else { "NOT_CONFIGURED" },
                "supportedPlatforms":["TikTok","抖音","小红书","X"], "automaticSync":false, "mediaDownload":false,
                "capabilities":[
                    provider_capability("TikTok", "VIDEO_SEARCH", "tiktok/fetch_general_search_result"),
                    provider_capability("TikTok", "POST_DETAIL", "tiktok/fetch_post_detail"),
                    provider_capability("抖音", "POST_DETAIL", "douyin/fetch_one_video_by_share_url"),
                    provider_capability("小红书", "POST_DETAIL", "xiaohongshu/fetch_note_detail"),
                    provider_capability("X", "POST_DETAIL", "twitter/fetch_tweet_detail")
                ]
            },
            {
                "id":"scrapecreators", "code":"SCRAPE_CREATORS", "label":"Scrape Creators", "providerType":"API",
                "configured":scrapecreators_configured, "enabled":true,
                "status": if scrapecreators_configured { "CONFIGURED" } else { "NOT_CONFIGURED" },
                "supportedPlatforms":["TikTok","Instagram","YouTube","Facebook","X"], "automaticSync":false, "mediaDownload":false,
                "capabilities":[
                    provider_capability("TikTok", "POST_DETAIL", "tiktok/video"),
                    provider_capability("Instagram", "POST_DETAIL", "instagram/post"),
                    provider_capability("YouTube", "POST_DETAIL", "youtube/video"),
                    provider_capability("Facebook", "POST_DETAIL", "facebook/post"),
                    provider_capability("X", "POST_DETAIL", "twitter/tweet")
                ]
            }
        ]
    })
}

fn provider_health_key(provider: &str) -> String {
    format!("external_provider_health:{provider}")
}

fn provider_health(connection: &Connection, provider: &str) -> Value {
    setting(connection, &provider_health_key(provider))
        .ok()
        .flatten()
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_else(|| json!({}))
}

fn save_provider_health(
    app: &AppHandle,
    provider: &str,
    status: &str,
    latency_ms: Option<u128>,
    error: Option<&str>,
) -> Result<(), String> {
    let value = json!({
        "status": status,
        "lastCheckedAt": now(),
        "latencyMs": latency_ms,
        "lastError": error.map(|value| value.chars().take(300).collect::<String>())
    });
    db(app)?
        .execute(
            "INSERT INTO settings (key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![provider_health_key(provider), value.to_string()],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn provider_error_status(error: &str) -> &'static str {
    let text = error.to_ascii_lowercase();
    if text.contains("401") || text.contains("403") || text.contains("unauthorized") || text.contains("forbidden") {
        "AUTH_ERROR"
    } else if text.contains("429") || text.contains("rate limit") || text.contains("quota") {
        "RATE_LIMITED"
    } else if text.contains("timeout") || text.contains("timed out") {
        "DEGRADED"
    } else {
        "UNAVAILABLE"
    }
}

fn capture_provider_config_for_app(app: &AppHandle) -> Result<Value, String> {
    let mut config = capture_provider_config(
        redfox_key().is_ok(),
        apify_key().is_ok(),
        tikhub_key().is_ok(),
        scrapecreators_key().is_ok(),
    );
    let connection = db(app)?;
    if let Some(providers) = config.get_mut("providers").and_then(Value::as_array_mut) {
        for provider in providers {
            let Some(id) = provider.get("id").and_then(Value::as_str) else { continue };
            let configured = provider.get("configured").and_then(Value::as_bool).unwrap_or(false);
            let health = provider_health(&connection, id);
            let status = health
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or(if configured { "CONFIGURED" } else { "NOT_CONFIGURED" });
            if let Some(object) = provider.as_object_mut() {
                object.insert("status".into(), Value::String(status.into()));
                object.insert("health".into(), health);
            }
        }
    }
    Ok(config)
}

fn redfox_key() -> Result<String, String> {
    if let Ok(value) = std::env::var("REDFOX_API_KEY") {
        if !value.trim().is_empty() {
            return Ok(value);
        }
    }
    read_secrets()?
        .get("redfox")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .ok_or("尚未配置 RedFox API Key".to_string())
}

fn apify_key() -> Result<String, String> {
    if let Ok(value) = std::env::var("APIFY_API_TOKEN") {
        if !value.trim().is_empty() {
            return Ok(value);
        }
    }
    read_secrets()?
        .get("apify")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .ok_or("尚未配置 Apify API Token".to_string())
}

fn tikhub_key() -> Result<String, String> {
    if let Ok(value) = std::env::var("TIKHUB_API_KEY") {
        if !value.trim().is_empty() {
            return Ok(value);
        }
    }
    read_secrets()?
        .get("tikhub")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .ok_or("尚未配置 TikHub API Key".into())
}

fn scrapecreators_key() -> Result<String, String> {
    if let Ok(value) = std::env::var("SCRAPE_CREATORS_API_KEY") {
        if !value.trim().is_empty() {
            return Ok(value);
        }
    }
    read_secrets()?
        .get("scrapecreators")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .ok_or("尚未配置 Scrape Creators API Key".into())
}

fn timestamp_after_days(value: &str, days: i64) -> String {
    let base = value.parse::<i64>().unwrap_or_default();
    (base + days * 86_400_000).to_string()
}

fn existing_inbox_capture(
    connection: &Connection,
    source_url: &str,
    canonical_url: &str,
) -> Result<Option<Value>, String> {
    connection.query_row(
        "SELECT id,entity,data_json,created_at,updated_at FROM records WHERE entity='inbox' AND archived_at IS NULL AND deleted_at IS NULL AND (json_extract(data_json,'$.sourceUrl')=?1 OR json_extract(data_json,'$.canonicalUrl')=?2) LIMIT 1",
        params![source_url, canonical_url],
        |row| Ok(value_to_record(row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
    ).optional().map_err(|error| error.to_string())
}

#[tauri::command]
fn get_finance_summary(app: AppHandle, project_id: Option<String>) -> Result<Value, String> {
    finance::summary(&db(&app)?, project_id.as_deref())
}

#[tauri::command]
fn get_capture_provider_config(app: AppHandle) -> Result<Value, String> {
    capture_provider_config_for_app(&app)
}

#[tauri::command]
fn configure_capture_provider(app: AppHandle, provider: String, api_key: String) -> Result<Value, String> {
    if !["redfox", "apify", "tikhub", "scrapecreators"].contains(&provider.as_str()) {
        return Err("当前只支持配置 RedFoxHub、Apify、TikHub 或 Scrape Creators".into());
    }
    let key = if !api_key.trim().is_empty() {
        api_key.trim().to_string()
    } else if provider == "redfox" {
        redfox_key()?
    } else if provider == "apify" {
        apify_key()?
    } else if provider == "tikhub" {
        tikhub_key()?
    } else {
        scrapecreators_key()?
    };
    let started = Instant::now();
    let tested = match provider.as_str() {
        "apify" => apify::test_token(&key).map(|_| ()),
        "tikhub" => tikhub::test_token(&key).map(|_| ()),
        "scrapecreators" => scrapecreators::test_token(&key).map(|_| ()),
        // RedFox has no lightweight token endpoint in the implemented adapter.
        // Keep the state honest: a real public-link capture is the verification path.
        "redfox" => Ok(()),
        _ => unreachable!(),
    };
    if let Err(error) = tested {
        save_provider_health(&app, &provider, provider_error_status(&error), Some(started.elapsed().as_millis()), Some(&error))?;
        return Err(error);
    }
    store_provider_key(&provider, &key)?;
    let status = if provider == "redfox" { "CONFIGURED" } else { "AVAILABLE" };
    save_provider_health(&app, &provider, status, Some(started.elapsed().as_millis()), None)?;
    get_capture_provider_config(app)
}

#[tauri::command]
async fn test_capture_provider(app: AppHandle, provider: String, url: String) -> Result<Value, String> {
    let health_app = app.clone();
    let health_provider = provider.clone();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let started = Instant::now();
        if provider == "redfox" {
            let capture = redfox::capture(&redfox_key()?, url.trim())?;
            return Ok(json!({"ok":true,"provider":"redfox","latencyMs":started.elapsed().as_millis(),"content":capture.canonical}));
        }
        if provider == "apify" { let result = apify::test_token(&apify_key()?)?; return Ok(json!({"ok":true,"provider":"apify","latencyMs":started.elapsed().as_millis(),"content":result})); }
        if provider == "tikhub" { let result = tikhub::test_token(&tikhub_key()?)?; return Ok(json!({"ok":true,"provider":"tikhub","latencyMs":started.elapsed().as_millis(),"content":result})); }
        if provider == "scrapecreators" { let result = scrapecreators::test_token(&scrapecreators_key()?)?; return Ok(json!({"ok":true,"provider":"scrapecreators","latencyMs":started.elapsed().as_millis(),"content":result})); }
        Err("当前只支持测试 RedFoxHub、Apify、TikHub 或 Scrape Creators".into())
    }).await.map_err(|error| format!("采集服务后台任务失败：{error}"))?;
    match &result {
        Ok(value) => save_provider_health(&health_app, &health_provider, "AVAILABLE", value.get("latencyMs").and_then(Value::as_u64).map(|value| value as u128), None)?,
        Err(error) => save_provider_health(&health_app, &health_provider, provider_error_status(error), None, Some(error))?,
    }
    result
}

struct ResearchExecutionMeta {
    request_id: Option<String>,
    source_key: String,
    platform: String,
    capability: String,
    primary_provider: String,
    fallback_providers: Vec<String>,
}

fn run_tikhub_research(
    app: AppHandle,
    query: &str,
    period_days: i64,
    context: Option<ResearchExecutionMeta>,
) -> Result<Value, String> {
    let captured_at = now();
    let started = Instant::now();
    let connection = db(&app)?;
    let run_id = context.as_ref().map(|_| new_id("research-run"));
    if let (Some(meta), Some(run_id)) = (context.as_ref(), run_id.as_deref()) {
        external_intelligence::start_research_run(
            &connection,
            run_id,
            meta.request_id.as_deref(),
            &meta.source_key,
            &meta.platform,
            &meta.capability,
            &meta.primary_provider,
            &meta.fallback_providers,
            &captured_at,
        )?;
    }
    let cache_params = json!({"query":query.trim(),"periodDays":period_days});
    let fingerprint = external_intelligence::research_fingerprint("tikhub", "TikTok", "VIDEO_SEARCH", &cache_params);
    if let Some(cached) = external_intelligence::cached_research(&connection, &fingerprint, &captured_at)? {
        if let Some(run_id) = run_id.as_deref() {
            for (index, item_id) in cached.item_ids.iter().enumerate() {
                external_intelligence::attach_research_evidence(
                    &connection,
                    &new_id("research-evidence"),
                    run_id,
                    item_id,
                    "tikhub",
                    "cache:tiktok/fetch_general_search_result",
                    cached.urls.get(index).map(String::as_str).unwrap_or(""),
                    &captured_at,
                )?;
            }
            external_intelligence::record_provider_call_with_context(
                &connection,
                &new_id("provider-call"),
                "tikhub",
                "cache:tiktok/fetch_general_search_result",
                None,
                &captured_at,
                true,
                None,
                cached.item_ids.len() as i64,
                None,
                Some(run_id),
                Some("VIDEO_SEARCH"),
                true,
            )?;
            external_intelligence::finish_research_run(&connection, run_id, "COMPLETED", true, &now(), None)?;
        }
        return Ok(json!({"items":cached.item_ids.len(),"itemIds":cached.item_ids,"urls":cached.urls,"provider":"tikhub","cacheHit":true,"researchRunId":run_id,"evidenceCount":run_id.as_deref().map(|id| external_intelligence::research_evidence_count(&connection, id)).transpose()?.unwrap_or(0)}));
    }
    let search = match tikhub::search_videos(&tikhub_key()?, query.trim(), period_days) {
        Ok(value) => value,
        Err(error) => {
            if let Some(run_id) = run_id.as_deref() {
                external_intelligence::record_provider_call_with_context(&connection, &new_id("provider-call"), "tikhub", "tiktok/fetch_general_search_result", None, &captured_at, false, None, 0, Some(&error), Some(run_id), Some("VIDEO_SEARCH"), false)?;
                external_intelligence::finish_research_run(&connection, run_id, "FAILED", false, &now(), Some(&error))?;
            }
            save_provider_health(&app, "tikhub", provider_error_status(&error), Some(started.elapsed().as_millis()), Some(&error))?;
            return Err(error);
        }
    };
    let raw_path = data_dir(&app)?.join("external-intelligence/raw").join(format!("{}.json", new_id("tikhub-search")));
    fs::write(&raw_path, serde_json::to_vec_pretty(&search.raw).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
    let mut urls = Vec::new();
    let mut item_ids = Vec::new();
    for item in &search.items {
        let item_id = external_intelligence::upsert_item(&connection, &new_id("external-item"), item, &captured_at, &timestamp_after_days(&captured_at, 1), &raw_path.to_string_lossy())?;
        let url = item.get("canonicalUrl").and_then(Value::as_str).unwrap_or("").to_string();
        if let Some(run_id) = run_id.as_deref() {
            external_intelligence::attach_research_evidence(&connection, &new_id("research-evidence"), run_id, &item_id, "tikhub", &search.endpoint, &url, &captured_at)?;
        }
        item_ids.push(item_id);
        urls.push(url);
    }
    external_intelligence::cache_research(&connection, &fingerprint, "tikhub", "TikTok", "VIDEO_SEARCH", &item_ids, &urls, &captured_at, &timestamp_after_days(&captured_at, 1))?;
    external_intelligence::record_provider_call_with_context(&connection, &new_id("provider-call"), "tikhub", &search.endpoint, None, &captured_at, true, Some(search.status_code), item_ids.len() as i64, None, run_id.as_deref(), Some("VIDEO_SEARCH"), false)?;
    if let Some(run_id) = run_id.as_deref() {
        external_intelligence::finish_research_run(&connection, run_id, "COMPLETED", false, &now(), None)?;
    }
    save_provider_health(&app, "tikhub", "AVAILABLE", Some(started.elapsed().as_millis()), None)?;
    Ok(json!({"items":item_ids.len(),"itemIds":item_ids,"urls":urls,"provider":"tikhub","cacheHit":false,"researchRunId":run_id,"evidenceCount":run_id.as_deref().map(|id| external_intelligence::research_evidence_count(&connection, id)).transpose()?.unwrap_or(0)}))
}

#[tauri::command]
async fn search_tiktok_research(app: AppHandle, query: String, period_days: Option<i64>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || run_tikhub_research(app, &query, period_days.unwrap_or(30), None))
        .await
        .map_err(|error| format!("TikHub 调研后台任务失败：{error}"))?
}

#[tauri::command]
async fn execute_research_source(app: AppHandle, source: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mode = source.get("mode").and_then(Value::as_str).unwrap_or("link");
        let capability = source.get("capability").and_then(Value::as_str).unwrap_or("");
        let primary = source
            .get("primaryProvider")
            .or_else(|| source.get("provider"))
            .or_else(|| source.pointer("/sourceRoute/primaryProviderId"))
            .and_then(Value::as_str)
            .unwrap_or("auto");
        if mode == "keyword_search" {
            if capability != "VIDEO_SEARCH" || primary != "tikhub" {
                return Err("该调研源没有匹配当前已实现的关键词搜索能力。".into());
            }
            return run_tikhub_research(
                app,
                source.get("query").and_then(Value::as_str).unwrap_or("TikTok"),
                source.get("periodDays").and_then(Value::as_i64).unwrap_or(30),
                Some(ResearchExecutionMeta {
                    request_id: source.get("researchRequestId").and_then(Value::as_str).map(str::to_string),
                    source_key: source.get("key").and_then(Value::as_str).unwrap_or("source").to_string(),
                    platform: source.get("platform").and_then(Value::as_str).unwrap_or("TikTok").to_string(),
                    capability: capability.to_string(),
                    primary_provider: primary.to_string(),
                    fallback_providers: source.get("fallbackProviders").or_else(|| source.pointer("/sourceRoute/fallbackProviderIds")).and_then(Value::as_array).map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default(),
                }),
            );
        }
        let url = source.get("url").and_then(Value::as_str).ok_or("调研源缺少公开链接")?;
        let mut providers = vec![primary.to_string()];
        if let Some(fallbacks) = source
            .get("fallbackProviders")
            .or_else(|| source.pointer("/sourceRoute/fallbackProviderIds"))
            .and_then(Value::as_array)
        {
            providers.extend(fallbacks.iter().filter_map(Value::as_str).map(str::to_string));
        }
        providers.dedup();
        let captured_at = now();
        let connection = db(&app)?;
        let run_id = new_id("research-run");
        let source_key = source.get("key").and_then(Value::as_str).unwrap_or("source");
        let platform = source.get("platform").and_then(Value::as_str).unwrap_or("网页");
        let fallback_providers = providers.iter().skip(1).cloned().collect::<Vec<_>>();
        external_intelligence::start_research_run(
            &connection,
            &run_id,
            source.get("researchRequestId").and_then(Value::as_str),
            source_key,
            platform,
            if capability.is_empty() { "POST_DETAIL" } else { capability },
            primary,
            &fallback_providers,
            &captured_at,
        )?;
        let mut errors = Vec::new();
        for provider in providers {
            match capture_link_blocking(app.clone(), url.to_string(), provider.clone()) {
                Ok(record) if provider == "auto" || record.get("captureProvider").and_then(Value::as_str) == Some(provider.as_str()) => {
                    let item_id = record.get("externalItemId").and_then(Value::as_str).filter(|id| !id.is_empty());
                    if let Some(item_id) = item_id {
                        external_intelligence::attach_research_evidence(
                            &connection,
                            &new_id("research-evidence"),
                            &run_id,
                            item_id,
                            record.get("captureProvider").and_then(Value::as_str).unwrap_or(&provider),
                            "capture_link",
                            record.get("canonicalUrl").and_then(Value::as_str).unwrap_or(url),
                            &captured_at,
                        )?;
                    }
                    let effective_provider = record.get("captureProvider").and_then(Value::as_str).unwrap_or(&provider);
                    external_intelligence::record_provider_call_with_context(
                        &connection,
                        &new_id("provider-call"),
                        effective_provider,
                        "capture_link",
                        Some(source_key),
                        &captured_at,
                        true,
                        None,
                        item_id.is_some() as i64,
                        None,
                        Some(&run_id),
                        Some(if capability.is_empty() { "POST_DETAIL" } else { capability }),
                        false,
                    )?;
                    external_intelligence::finish_research_run(&connection, &run_id, "COMPLETED", false, &now(), None)?;
                    return Ok(json!({"items":item_id.is_some() as i64,"itemIds":item_id.map(|id| vec![id]),"urls":[url],"provider":effective_provider,"cacheHit":false,"researchRunId":run_id,"evidenceCount":external_intelligence::research_evidence_count(&connection, &run_id)?}));
                }
                Ok(_) => errors.push(format!("{provider} 未返回采集结果")),
                Err(error) => errors.push(format!("{provider}: {error}")),
            }
        }
        let error = format!("所有已确认的 Provider 均未完成：{}", errors.join("；"));
        external_intelligence::finish_research_run(&connection, &run_id, "FAILED", false, &now(), Some(&error))?;
        Err(error)
    })
    .await
    .map_err(|error| format!("调研执行后台任务失败：{error}"))?
}

#[tauri::command]
fn list_external_items(app: AppHandle, limit: Option<i64>) -> Result<Vec<Value>, String> {
    external_intelligence::list_items(&db(&app)?, limit.unwrap_or(80))
}

#[tauri::command]
fn cleanup_external_cache(app: AppHandle) -> Result<Value, String> {
    let connection = db(&app)?;
    let current = now();
    let raw_dir = data_dir(&app)?
        .join("external-intelligence/raw")
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let paths = {
        let mut statement = connection.prepare("SELECT raw_payload_path FROM external_items WHERE expires_at IS NOT NULL AND CAST(expires_at AS INTEGER) < CAST(?1 AS INTEGER) AND raw_payload_path IS NOT NULL").map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![current], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        rows.filter_map(Result::ok).collect::<Vec<_>>()
    };
    let removed = external_intelligence::cleanup_expired(&connection, &current)?;
    let mut raw_removed = 0;
    for value in paths {
        let path = PathBuf::from(value);
        if path
            .canonicalize()
            .ok()
            .is_some_and(|canonical| canonical.starts_with(&raw_dir))
            && fs::remove_file(path).is_ok()
        {
            raw_removed += 1;
        }
    }
    Ok(json!({"ok":true,"removed":removed,"rawRemoved":raw_removed}))
}

fn capture_platform(url: &str) -> &'static str {
    let lower = url.to_lowercase();
    if lower.contains("mp.weixin.qq.com") {
        "微信公众号"
    } else if lower.contains("douyin.com") {
        "抖音"
    } else if lower.contains("xiaohongshu.com") || lower.contains("xhslink.com") {
        "小红书"
    } else if lower.contains("twitter.com") || lower.contains("x.com") {
        "X"
    } else if lower.contains("tiktok.com") {
        "TikTok"
    } else if lower.contains("instagram.com") {
        "Instagram"
    } else if lower.contains("facebook.com") || lower.contains("fb.watch") {
        "Facebook"
    } else if lower.contains("reddit.com") || lower.contains("redd.it") {
        "Reddit"
    } else if lower.contains("channels.weixin.qq.com") {
        "视频号"
    } else {
        "网页"
    }
}

fn executable(candidates: &[&str]) -> Option<String> {
    candidates
        .iter()
        .find(|candidate| Path::new(candidate).exists())
        .map(|value| value.to_string())
}

fn run_yt_dlp(url: &str) -> Result<Value, String> {
    let command = executable(&["/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp"])
        .ok_or("未安装 yt-dlp")?;
    let output = Command::new(command)
        .args([
            "--dump-single-json",
            "--skip-download",
            "--no-playlist",
            "--socket-timeout",
            "15",
            "--retries",
            "1",
            "--extractor-retries",
            "1",
            "--",
            url,
        ])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())
}

fn run_gallery_dl(url: &str) -> Result<Value, String> {
    let command = executable(&["/opt/homebrew/bin/gallery-dl", "/usr/local/bin/gallery-dl"])
        .ok_or("未安装 gallery-dl")?;
    let output = Command::new(command)
        .args(["--dump-json", "--", url])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let first = String::from_utf8_lossy(&output.stdout)
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .to_string();
    serde_json::from_str(&first).map_err(|error| error.to_string())
}

fn html_meta(html: &str, key: &str) -> String {
    let escaped = regex::escape(key);
    for pattern in [
        format!(
            r#"(?is)<meta[^>]+(?:property|name)=["']{escaped}["'][^>]+content=["']([^"']*)["']"#
        ),
        format!(
            r#"(?is)<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']{escaped}["']"#
        ),
    ] {
        if let Ok(regex) = Regex::new(&pattern) {
            if let Some(value) = regex.captures(html).and_then(|capture| capture.get(1)) {
                return value.as_str().trim().to_string();
            }
        }
    }
    String::new()
}

fn fetch_web_metadata(url: &str) -> Result<Value, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("Mozilla/5.0 EvoPilot/3.1")
        .build()
        .map_err(|error| error.to_string())?;
    let response = client.get(url).send().map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("网页返回 {}", response.status()));
    }
    let final_url = response.url().to_string();
    let html = response.text().map_err(|error| error.to_string())?;
    let title = html_meta(&html, "og:title");
    let description = {
        let value = html_meta(&html, "og:description");
        if value.is_empty() {
            html_meta(&html, "description")
        } else {
            value
        }
    };
    Ok(
        json!({"title":title,"description":description,"webpage_url":final_url,"thumbnail":html_meta(&html,"og:image"),"uploader":html_meta(&html,"article:author")}),
    )
}

#[tauri::command]
async fn capture_link(
    app: AppHandle,
    url: String,
    provider: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        capture_link_blocking(app, url, provider.unwrap_or_else(|| "auto".into()))
    })
    .await
    .map_err(|error| format!("采集后台任务失败：{error}"))?
}

fn capture_link_blocking(app: AppHandle, url: String, provider: String) -> Result<Value, String> {
    let url = url.trim().to_string();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("请输入有效的 http/https 链接".into());
    }
    let platform = capture_platform(&url);
    let capture_id = new_id("capture");
    let captured_at = now();
    let mut errors = Vec::new();
    let mut external_item_id = String::new();
    let mut capture_provider = "local".to_string();
    let mut local_metadata_path = String::new();
    let redfox_result = if (provider == "redfox" || provider == "auto") && redfox::platform_for_url(&url).is_some() {
        match redfox_key() {
            Ok(key) => {
                let endpoint = redfox::request_for_url(&url)
                    .ok()
                    .map(|value| value.0.to_string())
                    .unwrap_or_default();
                match redfox::capture(&key, &url) {
                    Ok(capture) => {
                        let directory = data_dir(&app)?.join("external-intelligence/raw");
                        let raw_path = directory.join(format!("{capture_id}.json"));
                        fs::write(
                            &raw_path,
                            serde_json::to_vec_pretty(&capture.raw)
                                .map_err(|error| error.to_string())?,
                        )
                        .map_err(|error| error.to_string())?;
                        let connection = db(&app)?;
                        external_item_id = external_intelligence::upsert_item(
                            &connection,
                            &new_id("external-item"),
                            &capture.canonical,
                            &captured_at,
                            &timestamp_after_days(&captured_at, 30),
                            &raw_path.to_string_lossy(),
                        )?;
                        external_intelligence::record_provider_call(
                            &connection,
                            &new_id("provider-call"),
                            "redfox",
                            &capture.endpoint,
                            None,
                            &captured_at,
                            true,
                            Some(capture.status_code),
                            1,
                            None,
                        )?;
                        local_metadata_path = raw_path.to_string_lossy().to_string();
                        capture_provider = "redfox".into();
                        Some(capture.canonical)
                    }
                    Err(error) => {
                        if !endpoint.is_empty() {
                            let connection = db(&app)?;
                            external_intelligence::record_provider_call(
                                &connection,
                                &new_id("provider-call"),
                                "redfox",
                                &endpoint,
                                None,
                                &captured_at,
                                false,
                                None,
                                0,
                                Some(&error),
                            )?;
                        }
                        errors.push(format!("RedFox: {error}"));
                        None
                    }
                }
            }
            Err(_) => None,
        }
    } else {
        None
    };
    let apify_result = if provider == "apify" {
        match apify_key() {
            Ok(key) => match apify::capture(&key, &url) {
                Ok(capture) => {
                    let directory = data_dir(&app)?.join("external-intelligence/raw");
                    let raw_path = directory.join(format!("{capture_id}.json"));
                    fs::write(
                        &raw_path,
                        serde_json::to_vec_pretty(&capture.raw)
                            .map_err(|error| error.to_string())?,
                    )
                    .map_err(|error| error.to_string())?;
                    let connection = db(&app)?;
                    external_item_id = external_intelligence::upsert_item(
                        &connection,
                        &new_id("external-item"),
                        &capture.canonical,
                        &captured_at,
                        &timestamp_after_days(&captured_at, 30),
                        &raw_path.to_string_lossy(),
                    )?;
                    external_intelligence::record_provider_call(
                        &connection,
                        &new_id("provider-call"),
                        "apify",
                        &capture.endpoint,
                        None,
                        &captured_at,
                        true,
                        Some(capture.status_code),
                        1,
                        None,
                    )?;
                    local_metadata_path = raw_path.to_string_lossy().to_string();
                    capture_provider = "apify".into();
                    Some(capture.canonical)
                }
                Err(error) => {
                    let connection = db(&app)?;
                    external_intelligence::record_provider_call(
                        &connection,
                        &new_id("provider-call"),
                        "apify",
                        "https://api.apify.com/v2/acts/apify~website-content-crawler/runs",
                        None,
                        &captured_at,
                        false,
                        None,
                        0,
                        Some(&error),
                    )?;
                    errors.push(format!("Apify: {error}"));
                    None
                }
            },
            Err(error) => {
                errors.push(format!("Apify: {error}"));
                None
            }
        }
    } else {
        None
    };
    let tikhub_result = if provider == "tikhub" {
        match tikhub_key() {
            Ok(key) => match tikhub::capture(&key, &url) {
                Ok(capture) => {
                    let directory = data_dir(&app)?.join("external-intelligence/raw");
                    let raw_path = directory.join(format!("{capture_id}.json"));
                    fs::write(
                        &raw_path,
                        serde_json::to_vec_pretty(&capture.raw)
                            .map_err(|error| error.to_string())?,
                    )
                    .map_err(|error| error.to_string())?;
                    let connection = db(&app)?;
                    external_item_id = external_intelligence::upsert_item(
                        &connection,
                        &new_id("external-item"),
                        &capture.canonical,
                        &captured_at,
                        &timestamp_after_days(&captured_at, 30),
                        &raw_path.to_string_lossy(),
                    )?;
                    external_intelligence::record_provider_call(
                        &connection,
                        &new_id("provider-call"),
                        "tikhub",
                        &capture.endpoint,
                        None,
                        &captured_at,
                        true,
                        Some(capture.status_code),
                        1,
                        None,
                    )?;
                    local_metadata_path = raw_path.to_string_lossy().to_string();
                    capture_provider = "tikhub".into();
                    Some(capture.canonical)
                }
                Err(error) => {
                    errors.push(format!("TikHub: {error}"));
                    None
                }
            },
            Err(error) => {
                errors.push(format!("TikHub: {error}"));
                None
            }
        }
    } else {
        None
    };
    let scrapecreators_result = if provider == "scrapecreators" {
        match scrapecreators_key() {
            Ok(key) => match scrapecreators::capture(&key, &url) {
                Ok(capture) => {
                    let directory = data_dir(&app)?.join("external-intelligence/raw");
                    let raw_path = directory.join(format!("{capture_id}.json"));
                    fs::write(
                        &raw_path,
                        serde_json::to_vec_pretty(&capture.raw)
                            .map_err(|error| error.to_string())?,
                    )
                    .map_err(|error| error.to_string())?;
                    let connection = db(&app)?;
                    external_item_id = external_intelligence::upsert_item(
                        &connection,
                        &new_id("external-item"),
                        &capture.canonical,
                        &captured_at,
                        &timestamp_after_days(&captured_at, 30),
                        &raw_path.to_string_lossy(),
                    )?;
                    external_intelligence::record_provider_call(
                        &connection,
                        &new_id("provider-call"),
                        "scrapecreators",
                        &capture.endpoint,
                        None,
                        &captured_at,
                        true,
                        Some(capture.status_code),
                        1,
                        None,
                    )?;
                    local_metadata_path = raw_path.to_string_lossy().to_string();
                    capture_provider = "scrapecreators".into();
                    Some(capture.canonical)
                }
                Err(error) => {
                    errors.push(format!("Scrape Creators: {error}"));
                    None
                }
            },
            Err(error) => {
                errors.push(format!("Scrape Creators: {error}"));
                None
            }
        }
    } else {
        None
    };
    let (metadata, method) = if let Some(value) = tikhub_result {
        (value, "tikhub")
    } else if let Some(value) = scrapecreators_result {
        (value, "scrapecreators")
    } else if let Some(value) = apify_result {
        (value, "apify")
    } else if let Some(value) = redfox_result {
        (value, "redfox")
    } else {
        match run_yt_dlp(&url) {
            Ok(value) => (value, "yt-dlp"),
            Err(error) => {
                errors.push(format!("yt-dlp: {error}"));
                match run_gallery_dl(&url) {
                    Ok(value) => (value, "gallery-dl"),
                    Err(error) => {
                        errors.push(format!("gallery-dl: {error}"));
                        match fetch_web_metadata(&url) {
                            Ok(value) => (value, "open-graph"),
                            Err(error) => {
                                errors.push(format!("网页读取: {error}"));
                                (json!({"webpage_url":url}), "link-only")
                            }
                        }
                    }
                }
            }
        }
    };
    if local_metadata_path.is_empty() {
        let directory = data_dir(&app)?
            .join("attachments/captures")
            .join(&capture_id);
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        let path = directory.join("metadata.json");
        fs::write(
            &path,
            serde_json::to_vec_pretty(&metadata).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        local_metadata_path = path.to_string_lossy().to_string();
    }
    if external_item_id.is_empty()
        && redfox::platform_for_url(&url).is_some()
        && method != "link-only"
        && method != "apify"
    {
        let mut canonical_item = redfox::normalize_response(&url, method, &metadata);
        if let Some(object) = canonical_item.as_object_mut() {
            object.insert("provider".into(), Value::String(method.into()));
            object.insert("providerEndpoint".into(), Value::String(method.into()));
        }
        external_item_id = external_intelligence::upsert_item(
            &db(&app)?,
            &new_id("external-item"),
            &canonical_item,
            &captured_at,
            &timestamp_after_days(&captured_at, 30),
            &local_metadata_path,
        )?;
        capture_provider = method.into();
    }
    let title = metadata["title"]
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            metadata["fulltitle"]
                .as_str()
                .filter(|value| !value.trim().is_empty())
        })
        .unwrap_or(&url)
        .to_string();
    let text = metadata["description"]
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            metadata["content"]
                .as_str()
                .filter(|value| !value.trim().is_empty())
        })
        .unwrap_or("")
        .to_string();
    let author = metadata["uploader"]
        .as_str()
        .or_else(|| metadata["channel"].as_str())
        .or_else(|| metadata["author"].as_str())
        .unwrap_or("")
        .to_string();
    let canonical = metadata["canonicalUrl"]
        .as_str()
        .or_else(|| metadata["webpage_url"].as_str())
        .or_else(|| metadata["original_url"].as_str())
        .unwrap_or(&url)
        .to_string();
    let connection = db(&app)?;
    let existing = existing_inbox_capture(&connection, &url, &canonical)?;
    let mut record = json!({
        "content": if text.is_empty() { title.clone() } else { format!("{}\n\n{}", title, text) },
        "type":"link", "status":"unprocessed", "platform":platform, "sourceUrl":url,
        "canonicalUrl":canonical, "externalContentId":metadata["externalId"], "contentType":metadata["contentType"],
        "author":author, "title":title, "publishedAt":metadata.get("publishedAt").cloned().unwrap_or_else(|| metadata["upload_date"].clone()),
        "cover":metadata.get("coverUrl").cloned().unwrap_or_else(|| metadata["thumbnail"].clone()),
        "metrics":metadata["metrics"], "captureProvider":capture_provider,
        "captureStatus": if method == "link-only" || (title == url && text.is_empty()) { "link_saved" } else { "captured" },
        "captureMethod":method, "captureErrors":errors, "localMetadataPath":local_metadata_path,
        "externalItemId":external_item_id, "rightsConfirmed":false, "savedAt":captured_at, "lastCapturedAt":now()
    });
    if let Some(existing) = existing {
        if let Some(object) = record.as_object_mut() {
            object.insert("id".into(), existing["id"].clone());
            object.insert("createdAt".into(), existing["createdAt"].clone());
        }
    }
    save_record(app, "inbox".into(), record)
}

fn provider_label(provider: &str) -> &'static str {
    match provider {
        "deepseek" => "DeepSeek",
        "minimax" => "MiniMax Token Plan",
        "volc-agent-plan" => "火山引擎 Agent Plan",
        _ => "HackStart",
    }
}

fn provider_base_url(provider: &str) -> &'static str {
    match provider {
        "deepseek" => "https://api.deepseek.com/chat/completions",
        "minimax" => "https://api.minimaxi.com/anthropic/v1/messages",
        "volc-agent-plan" => "https://ark.cn-beijing.volces.com/api/plan/v3/responses",
        _ => "https://ip2.hackstart.org/v1/chat/completions",
    }
}

fn provider_key_account(provider: &str) -> &'static str {
    match provider {
        "deepseek" => "deepseek-api-key",
        "minimax" => "minimax-token-plan-api-key",
        "volc-agent-plan" => "volc-agent-plan-api-key",
        _ => "hackstart-api-key",
    }
}

fn secrets_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "无法定位用户目录".to_string())?;
    let dir = PathBuf::from(home).join("Library/Application Support/com.jasonos.desktop");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("secrets.json"))
}

fn read_secrets() -> Result<Map<String, Value>, String> {
    let path = secrets_path()?;
    if !path.exists() {
        return Ok(Map::new());
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str::<Value>(&raw)
        .map_err(|e| e.to_string())?
        .as_object()
        .cloned()
        .ok_or("凭据文件格式无效".to_string())
}

fn provider_key(provider: &str) -> Result<String, String> {
    let environment_name = match provider {
        "deepseek" => "DEEPSEEK_API_KEY",
        "minimax" => "MINIMAX_TOKEN_PLAN_API_KEY",
        "volc-agent-plan" => "VOLC_AGENT_PLAN_API_KEY",
        _ => "HACKSTART_API_KEY",
    };
    if let Ok(value) = std::env::var(environment_name) {
        if !value.trim().is_empty() {
            return Ok(value);
        }
    }
    read_secrets()?
        .get(provider)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            format!(
                "尚未配置 {} API Key。请在设置中保存。",
                provider_label(provider)
            )
        })
}

fn store_provider_key(provider: &str, password: &str) -> Result<(), String> {
    let path = secrets_path()?;
    let mut secrets = read_secrets()?;
    secrets.insert(provider.to_string(), Value::String(password.to_string()));
    let temporary = path.with_extension("json.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(&Value::Object(secrets)).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    #[cfg(unix)]
    fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))
        .map_err(|e| e.to_string())?;
    fs::rename(&temporary, &path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    Ok(())
}

fn active_provider(connection: &Connection) -> Result<String, String> {
    let provider = setting(connection, "ai_provider")?.unwrap_or_else(|| "hackstart".to_string());
    if ["hackstart", "deepseek", "minimax", "volc-agent-plan"].contains(&provider.as_str()) {
        Ok(provider)
    } else {
        Ok("hackstart".into())
    }
}

fn selected_model(connection: &Connection, provider: &str) -> Result<String, String> {
    Ok(setting(connection, &format!("{}_model", provider))?
        .or_else(|| {
            if provider == "hackstart" {
                setting(connection, "hackstart_model").ok().flatten()
            } else {
                None
            }
        })
        .unwrap_or_else(|| provider_models(provider)[0].to_string()))
}

fn provider_config(connection: &Connection, provider: &str) -> Result<Value, String> {
    let models = provider_models(provider)
        .iter()
        .map(|model| {
            let description = match *model {
                "deepseek-v4-pro" => "高质量复杂推理",
                "MiniMax-M3" => "最新旗舰 Agent 与推理模型",
                "kimi-k3" => "Agent Plan Medium 当前文本模型",
                "deepseek-v4-flash" => "低延迟高性价比",
                "glm-5.2" => "智谱 GLM 通用大模型",
                "minimax-m3" => "MiniMax 旗舰 Agent 与推理模型",
                "doubao-seed-evolving" => "豆包 Seed 自进化模型",
                "kimi-k2.7-code" => "Kimi 代码专用模型（需开启 thinking）",
                _ => "HackStart 模型",
            };
            json!({"id": model, "label": model, "description": description})
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "id": provider,
        "label": provider_label(provider),
        "configured": provider_key(provider).is_ok(),
        "baseUrl": provider_base_url(provider),
        "model": selected_model(connection, provider)?,
        "models": models
    }))
}

fn is_external_url(url: &str) -> bool {
    url.starts_with("https://") || url.starts_with("http://")
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !is_external_url(&url) {
        return Err("只允许打开 http 或 https 新闻链接".into());
    }
    Command::new("open")
        .arg(url)
        .status()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_ai_config(app: AppHandle) -> Result<Value, String> {
    let connection = db(&app)?;
    let provider = active_provider(&connection)?;
    let providers = ["hackstart", "deepseek", "minimax", "volc-agent-plan"]
        .iter()
        .map(|item| provider_config(&connection, item))
        .collect::<Result<Vec<_>, _>>()?;
    let current = provider_config(&connection, &provider)?;
    Ok(json!({
        "provider": provider,
        "providerLabel": current["label"],
        "configured": current["configured"],
        "model": current["model"],
        "baseUrl": current["baseUrl"],
        "providers": providers
    }))
}

fn provider_response_text(provider: &str, response: &Value) -> String {
    if provider == "volc-agent-plan" {
        response["output"]
            .as_array()
            .into_iter()
            .flatten()
            .flat_map(|item| item["content"].as_array().into_iter().flatten())
            .filter(|content| content["type"] == "output_text")
            .filter_map(|content| content["text"].as_str())
            .collect::<Vec<_>>()
            .join("")
    } else if provider == "minimax" {
        response["content"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|content| content["type"] == "text")
            .filter_map(|content| content["text"].as_str())
            .collect::<Vec<_>>()
            .join("")
    } else {
        response["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string()
    }
}

fn call_provider(
    provider: &str,
    key: &str,
    model: &str,
    system: &str,
    messages: &[Value],
    max_tokens: u64,
) -> Result<(Value, u128), String> {
    let mut client_builder = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(90))
        .connect_timeout(Duration::from_secs(15));
    if provider == "minimax" {
        client_builder = client_builder.http1_only();
    }
    let client = client_builder.build().map_err(|e| e.to_string())?;
    let started = Instant::now();
    let (request, payload) = if provider == "volc-agent-plan" {
        let mut payload = json!({"model": model, "instructions": system, "input": messages, "max_output_tokens": max_tokens});
        if model != "kimi-k2.7-code" {
            payload["thinking"] = json!({"type": "disabled"});
        }
        (
            client.post(provider_base_url(provider)).bearer_auth(key),
            payload,
        )
    } else if provider == "minimax" {
        let payload = json!({"model": model, "system": system, "messages": messages, "max_tokens": max_tokens});
        (
            client
                .post(provider_base_url(provider))
                .header("x-api-key", key)
                .header("anthropic-version", "2023-06-01"),
            payload,
        )
    } else {
        let mut chat_messages = vec![json!({"role": "system", "content": system})];
        chat_messages.extend(messages.iter().cloned());
        let mut payload = json!({"model": model, "temperature": 0.2, "messages": chat_messages, "max_tokens": max_tokens});
        if provider == "deepseek" {
            payload["thinking"] = json!({"type": "disabled"});
        }
        (
            client.post(provider_base_url(provider)).bearer_auth(key),
            payload,
        )
    };
    let response = request
        .json(&payload)
        .send()
        .map_err(|e| format!("{} 请求失败：{e}", provider_label(provider)))?;
    let latency = started.elapsed().as_millis();
    let status = response.status();
    let response_json: Value = response
        .json()
        .map_err(|e| format!("无法解析 {} 响应：{e}", provider_label(provider)))?;
    if !status.is_success() {
        let message = response_json["error"]["message"]
            .as_str()
            .or_else(|| response_json["base_resp"]["status_msg"].as_str())
            .or_else(|| response_json["message"].as_str())
            .unwrap_or("未知错误");
        return Err(format!(
            "{} 返回 {}：{}",
            provider_label(provider),
            status,
            message
        ));
    }
    Ok((response_json, latency))
}

fn verify_provider(provider: &str, key: &str, model: &str) -> Result<Value, String> {
    let messages =
        vec![json!({"role": "user", "content": "Reply exactly: JASON_OS_CONNECTION_OK"})];
    let (response, latency_ms) = call_provider(
        provider,
        key,
        model,
        "You are a connectivity test. Return only the requested token.",
        &messages,
        64,
    )?;
    let content = provider_response_text(provider, &response);
    if content.trim().is_empty() {
        return Err(format!("{} 已响应但未返回文本", provider_label(provider)));
    }
    Ok(
        json!({"ok": true, "provider": provider, "model": model, "latencyMs": latency_ms, "content": content}),
    )
}

#[tauri::command]
fn test_ai_provider(app: AppHandle, provider: String, model: String) -> Result<Value, String> {
    if !["hackstart", "deepseek", "minimax", "volc-agent-plan"].contains(&provider.as_str()) {
        return Err("不支持的 AI 服务商".into());
    }
    let connection = db(&app)?;
    let selected = if model.trim().is_empty() {
        selected_model(&connection, &provider)?
    } else {
        model
    };
    verify_provider(&provider, &provider_key(&provider)?, &selected)
}

#[tauri::command]
fn configure_ai_provider(
    app: AppHandle,
    provider: String,
    api_key: String,
    model: String,
) -> Result<Value, String> {
    if !["hackstart", "deepseek", "minimax", "volc-agent-plan"].contains(&provider.as_str()) {
        return Err("不支持的 AI 服务商".into());
    }
    let chosen_model = if model.trim().is_empty() {
        provider_models(&provider)[0]
    } else {
        model.trim()
    };
    if provider != "hackstart" && !provider_models(&provider).contains(&chosen_model) {
        return Err("模型不在当前支持列表中".into());
    }
    let candidate_key = if api_key.trim().is_empty() {
        provider_key(&provider)?
    } else {
        api_key.trim().to_string()
    };
    verify_provider(&provider, &candidate_key, chosen_model)?;
    if !api_key.trim().is_empty() {
        store_provider_key(&provider, api_key.trim())?;
    }
    let connection = db(&app)?;
    let timestamp = now();
    connection.execute(
        "INSERT INTO settings(key,value,updated_at) VALUES ('ai_provider',?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        params![provider, timestamp],
    ).map_err(|e| e.to_string())?;
    connection.execute(
        "INSERT INTO settings(key,value,updated_at) VALUES (?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        params![format!("{}_model", provider), chosen_model, now()],
    ).map_err(|e| e.to_string())?;
    get_ai_config(app)
}

// Backward-compatible commands for existing installations.
#[tauri::command]
fn get_hackstart_config(app: AppHandle) -> Result<Value, String> {
    get_ai_config(app)
}

#[tauri::command]
fn configure_hackstart(app: AppHandle, api_key: String, model: String) -> Result<Value, String> {
    configure_ai_provider(app, "hackstart".into(), api_key, model)
}

fn agent_tool_metadata(tool: &str) -> Option<(&'static str, &'static str, bool, &'static str)> {
    match tool {
        "createMentalModel" => Some(("mentalModels", "LOW_WRITE", false, "CREATE")),
        "updateMentalModel" => Some(("mentalModels", "MEDIUM_WRITE", true, "UPDATE")),
        "createNote" => Some(("notes", "LOW_WRITE", false, "CREATE")),
        "updateNote" => Some(("notes", "MEDIUM_WRITE", true, "UPDATE")),
        "createNotebookCategory" => Some(("notebookCategories", "LOW_WRITE", false, "CREATE")),
        "updateNotebookCategory" => Some(("notebookCategories", "MEDIUM_WRITE", true, "UPDATE")),
        "createNotebookFolder" => Some(("notebookFolders", "LOW_WRITE", false, "CREATE")),
        "updateNotebookFolder" => Some(("notebookFolders", "MEDIUM_WRITE", true, "UPDATE")),
        "updateNotebookFile" => Some(("notebookFiles", "MEDIUM_WRITE", true, "UPDATE")),
        "updateProfile" => Some(("profiles", "MEDIUM_WRITE", true, "UPDATE")),
        "importWorkspaceDocumentToNotebook" => {
            Some(("notebookFiles", "MEDIUM_WRITE", true, "CREATE"))
        }
        "createKnowledge" => Some(("knowledge", "LOW_WRITE", false, "CREATE")),
        "updateKnowledge" => Some(("knowledge", "MEDIUM_WRITE", true, "UPDATE")),
        "createGoal" => Some(("goals", "LOW_WRITE", false, "CREATE")),
        "updateGoal" => Some(("goals", "MEDIUM_WRITE", true, "UPDATE")),
        "createProject" => Some(("projects", "LOW_WRITE", false, "CREATE")),
        "updateProject" => Some(("projects", "MEDIUM_WRITE", true, "UPDATE")),
        "createTask" => Some(("tasks", "LOW_WRITE", false, "CREATE")),
        "updateTask" => Some(("tasks", "MEDIUM_WRITE", true, "UPDATE")),
        "completeTask" => Some(("tasks", "MEDIUM_WRITE", true, "COMPLETE")),
        "startTimer" => Some(("timeLogs", "LOW_WRITE", false, "START_TIMER")),
        "stopTimer" => Some(("timeLogs", "MEDIUM_WRITE", true, "STOP_TIMER")),
        "createTimeRecord" => Some(("timeLogs", "LOW_WRITE", false, "CREATE")),
        "createDecision" => Some(("decisions", "MEDIUM_WRITE", true, "CREATE")),
        "updateDecision" => Some(("decisions", "MEDIUM_WRITE", true, "UPDATE")),
        "createReview" => Some(("reviews", "LOW_WRITE", false, "CREATE")),
        "createInsight" => Some(("insights", "LOW_WRITE", false, "CREATE")),
        "createPrinciple" => Some(("principles", "LOW_WRITE", false, "CREATE")),
        "createExternalSource" => Some(("externalSources", "MEDIUM_WRITE", true, "CREATE")),
        "updateExternalSource" => Some(("externalSources", "MEDIUM_WRITE", true, "UPDATE")),
        "updateExternalSignal" => Some(("signals", "MEDIUM_WRITE", true, "UPDATE")),
        "createOpportunity" => Some(("opportunities", "LOW_WRITE", false, "CREATE")),
        "updateOpportunity" => Some(("opportunities", "MEDIUM_WRITE", true, "UPDATE")),
        "createOutcome" => Some(("results", "MEDIUM_WRITE", true, "CREATE")),
        "updateOutcome" => Some(("results", "MEDIUM_WRITE", true, "UPDATE")),
        "createFinancialAccount" => Some(("financialAccounts", "MEDIUM_WRITE", true, "CREATE")),
        "createFinancialCategory" => Some(("financialCategories", "LOW_WRITE", false, "CREATE")),
        "createDeliverable" => Some(("deliverables", "MEDIUM_WRITE", true, "CREATE")),
        "updateDeliverable" => Some(("deliverables", "MEDIUM_WRITE", true, "UPDATE")),
        "createResultPackage" => Some(("resultPackages", "MEDIUM_WRITE", true, "CREATE")),
        "updateResultPackage" => Some(("resultPackages", "MEDIUM_WRITE", true, "UPDATE")),
        "createWorkflow" => Some(("workflows", "MEDIUM_WRITE", true, "CREATE")),
        "updateWorkflow" => Some(("workflows", "MEDIUM_WRITE", true, "UPDATE")),
        "createWorkflowVersion" => Some(("workflowVersions", "MEDIUM_WRITE", true, "CREATE")),
        "updateWorkflowVersion" => Some(("workflowVersions", "MEDIUM_WRITE", true, "UPDATE")),
        "promoteWorkflowVersion" | "rollbackWorkflowVersion" => Some(("workflowVersions", "HIGH_RISK", true, "UPDATE")),
        "createWorkflowStep" => Some(("workflowSteps", "LOW_WRITE", false, "CREATE")),
        "updateWorkflowStep" => Some(("workflowSteps", "MEDIUM_WRITE", true, "UPDATE")),
        "createWorkflowGate" => Some(("workflowGates", "MEDIUM_WRITE", true, "CREATE")),
        "updateWorkflowGate" => Some(("workflowGates", "MEDIUM_WRITE", true, "UPDATE")),
        "createWorkflowRun" => Some(("workflowRuns", "MEDIUM_WRITE", true, "CREATE")),
        "updateWorkflowRun" => Some(("workflowRuns", "MEDIUM_WRITE", true, "UPDATE")),
        "createWorkflowRunStep" => Some(("workflowRunSteps", "LOW_WRITE", false, "CREATE")),
        "updateWorkflowRunStep" => Some(("workflowRunSteps", "MEDIUM_WRITE", true, "UPDATE")),
        "createWorkflowMetric" => Some(("workflowMetricDefinitions", "MEDIUM_WRITE", true, "CREATE")),
        "updateWorkflowMetric" => Some(("workflowMetricDefinitions", "MEDIUM_WRITE", true, "UPDATE")),
        "createWorkflowImprovementProposal" => Some(("workflowImprovementProposals", "MEDIUM_WRITE", true, "CREATE")),
        "updateWorkflowImprovementProposal" => Some(("workflowImprovementProposals", "MEDIUM_WRITE", true, "UPDATE")),
        "createFinancialTransaction" => {
            Some(("financialTransactions", "HIGH_RISK", true, "CREATE"))
        }
        "voidFinancialTransaction" => Some(("financialTransactions", "HIGH_RISK", true, "UPDATE")),
        _ => None,
    }
}

fn extract_json_value(text: &str) -> Option<Value> {
    serde_json::from_str(text.trim()).ok().or_else(|| {
        let start = text.find('{')?;
        let end = text.rfind('}')?;
        serde_json::from_str(&text[start..=end]).ok()
    })
}

fn action_idempotency_key(tool: &str, input: &Value) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    tool.hash(&mut hasher);
    input.to_string().hash(&mut hasher);
    format!("agent:{:016x}", hasher.finish())
}

fn required_agent_fields(entity: &str) -> &'static [&'static str] {
    match entity {
        "mentalModels" => &["name"],
        "notes" => &["title"],
        "notebookCategories" | "notebookFolders" | "notebookFiles" => &["name"],
        "knowledge" => &["title", "content"],
        "goals" | "projects" | "tasks" | "decisions" | "reviews" | "deliverables"
        | "resultPackages" | "workflowRuns" | "workflowSteps" | "workflowGates"
        | "workflowImprovementProposals" => &["title"],
        "workflows" | "workflowVersions" => &["name"],
        "workflowMetricDefinitions" => &["name", "workflowVersionId"],
        "insights" | "principles" => &["statement"],
        "externalSources" => &["name"],
        "signals" | "opportunities" | "intelligenceBriefs" | "results" => &["title"],
        "financialTransactions" => &["title", "transactionType", "amountMinor"],
        "financialAccounts" | "financialCategories" => &["name"],
        "timeLogs" => &["title"],
        _ => &[],
    }
}

fn validate_agent_input(entity: &str, action_type: &str, input: &Value) -> Result<(), String> {
    let object = input.as_object().ok_or("AI Action 参数必须是结构化对象")?;
    if ["UPDATE", "COMPLETE"].contains(&action_type)
        && object
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .is_empty()
    {
        return Err("更新操作缺少真实记录 ID".into());
    }
    if action_type == "CREATE" {
        for field in required_agent_fields(entity) {
            if object
                .get(*field)
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .is_empty()
            {
                return Err(format!("缺少必要字段：{field}"));
            }
        }
    }
    Ok(())
}

fn validate_agent_tool_input(tool: &str, input: &Value) -> Result<(), String> {
    if tool != "importWorkspaceDocumentToNotebook" {
        return Ok(());
    }
    if input
        .get("sourcePath")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .is_empty()
    {
        return Err("导入本地文档缺少 sourcePath".into());
    }
    Ok(())
}

fn context_string(context: &Value, key: &str) -> Option<String> {
    context
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn timeline_analysis_is_read_only(context: &Value) -> bool {
    context.get("analysisMode").and_then(Value::as_str) == Some("timeline_readonly")
}

fn apply_agent_context(
    connection: &Connection,
    entity: &str,
    action_type: &str,
    input: &Value,
    context: &Value,
) -> Result<Value, String> {
    let mut resolved = input.clone();
    if !resolved.is_object() {
        resolved = json!({});
    }
    let object = resolved.as_object_mut().unwrap();
    if entity == "notes" {
        for key in [
            "goalId",
            "goalIds",
            "projectId",
            "projectIds",
            "taskId",
            "taskIds",
            "resultId",
            "resultIds",
            "timeLogId",
            "timeLogIds",
            "reviewId",
            "reviewIds",
            "insightId",
            "insightIds",
            "knowledgeId",
            "knowledgeIds",
            "mentalModelId",
            "mentalModelIds",
            "decisionId",
            "decisionIds",
            "financialTransactionId",
            "financialTransactionIds",
        ] {
            object.remove(key);
        }
    }
    if entity == "projects"
        && object
            .get("goalId")
            .and_then(Value::as_str)
            .unwrap_or("")
            .is_empty()
    {
        if let Some(goal_id) = context_string(context, "currentGoalId") {
            if valid_reference(connection, &goal_id, "goals", true)?.is_some() {
                object.insert("goalId".into(), Value::String(goal_id));
            }
        }
    }
    if entity == "tasks" {
        if object
            .get("projectId")
            .and_then(Value::as_str)
            .unwrap_or("")
            .is_empty()
        {
            if let Some(project_id) = context_string(context, "currentProjectId") {
                if valid_reference(connection, &project_id, "projects", true)?.is_some() {
                    object.insert("projectId".into(), Value::String(project_id));
                }
            }
        }
        if object
            .get("goalId")
            .and_then(Value::as_str)
            .unwrap_or("")
            .is_empty()
            && object.get("projectId").is_none()
        {
            if let Some(goal_id) = context_string(context, "currentGoalId") {
                if valid_reference(connection, &goal_id, "goals", true)?.is_some() {
                    object.insert("goalId".into(), Value::String(goal_id));
                }
            }
        }
        if action_type == "COMPLETE" && object.get("id").is_none() {
            if let Some(task_id) = context_string(context, "currentTaskId") {
                object.insert("id".into(), Value::String(task_id));
            }
        }
    }
    if ["externalSources", "opportunities"].contains(&entity) {
        if object
            .get("projectId")
            .and_then(Value::as_str)
            .unwrap_or("")
            .is_empty()
        {
            if let Some(project_id) = context_string(context, "currentProjectId") {
                object.insert("projectId".into(), Value::String(project_id));
            }
        }
        if object
            .get("goalId")
            .and_then(Value::as_str)
            .unwrap_or("")
            .is_empty()
        {
            if let Some(goal_id) = context_string(context, "currentGoalId") {
                object.insert("goalId".into(), Value::String(goal_id));
            }
        }
    }

    if entity == "timeLogs"
        && object
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("")
            .is_empty()
    {
        let title = [
            ("currentTaskId", "tasks"),
            ("currentProjectId", "projects"),
            ("currentGoalId", "goals"),
        ]
        .iter()
        .find_map(|(context_key, expected)| {
            let id = context_string(context, context_key)?;
            valid_reference(connection, &id, expected, false)
                .ok()
                .flatten()
                .and_then(|record| {
                    record
                        .get("title")
                        .or_else(|| record.get("name"))
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
        })
        .unwrap_or_else(|| "专注工作".into());
        object.insert("title".into(), Value::String(title));
    }
    if ["timeLogs", "decisions", "reviews"].contains(&entity) {
        for (field, context_key, expected) in [
            ("taskId", "currentTaskId", "tasks"),
            ("projectId", "currentProjectId", "projects"),
            ("goalId", "currentGoalId", "goals"),
        ] {
            if object
                .get(field)
                .and_then(Value::as_str)
                .unwrap_or("")
                .is_empty()
            {
                if let Some(id) = context_string(context, context_key) {
                    if valid_reference(connection, &id, expected, true)?.is_some() {
                        object.insert(field.into(), Value::String(id));
                    }
                }
            }
        }
    }
    if entity == "mentalModels" {
        let pairs = [
            ("definition", "corePrinciple"),
            ("trigger", "useCases"),
            ("questions", "keyQuestions"),
            ("method", "steps"),
            ("application", "useCases"),
        ];
        for (legacy, current) in pairs {
            if object
                .get(legacy)
                .and_then(Value::as_str)
                .unwrap_or("")
                .is_empty()
            {
                if let Some(value) = object
                    .get(current)
                    .and_then(Value::as_str)
                    .map(str::to_string)
                {
                    object.insert(legacy.into(), Value::String(value));
                }
            }
        }
    }
    Ok(resolved)
}

fn preview_label(key: &str) -> &str {
    match key {
        "name" => "名称",
        "category" => "类型",
        "corePrinciple" => "核心原则",
        "problem" => "解决的问题",
        "framework" => "框架",
        "steps" => "流程",
        "keyQuestions" => "核心问题",
        "useCases" => "适用场景",
        "outputTemplate" => "输出模板",
        "title" => "名称",
        "description" => "说明",
        "dueDate" => "截止日期",
        "goalId" => "目标",
        "projectId" => "项目",
        "taskId" => "任务",
        "statement" => "内容",
        "content" => "内容",
        "transactionType" => "交易类型",
        "amountMinor" => "金额（最小单位）",
        "currency" => "币种",
        "accountId" => "账户",
        "outcomeType" => "结果类型",
        "targetAmountMinor" => "预期金额（最小单位）",
        "actualAmountMinor" => "实际金额（最小单位）",
        "evidenceStatus" => "证据状态",
        _ => key,
    }
}

fn action_preview_fields(input: &Value) -> Vec<Value> {
    let preferred = [
        "name",
        "title",
        "category",
        "corePrinciple",
        "problem",
        "framework",
        "steps",
        "keyQuestions",
        "useCases",
        "statement",
        "content",
        "transactionType",
        "amountMinor",
        "currency",
        "accountId",
        "outcomeType",
        "targetAmountMinor",
        "actualAmountMinor",
        "evidenceStatus",
        "dueDate",
        "projectId",
        "goalId",
    ];
    let Some(object) = input.as_object() else {
        return Vec::new();
    };
    preferred
        .iter()
        .filter_map(|key| {
            object.get(*key).and_then(|value| {
                let rendered = if let Some(text) = value.as_str() {
                    text.to_string()
                } else {
                    value.to_string()
                };
                (!rendered.trim().is_empty())
                    .then(|| json!({"label": preview_label(key), "value": rendered}))
            })
        })
        .take(8)
        .collect()
}

fn agent_preview_title(tool: &str, input: &Value) -> String {
    let object_name = input
        .get("name")
        .or_else(|| input.get("title"))
        .or_else(|| input.get("statement"))
        .and_then(Value::as_str)
        .unwrap_or("新记录");
    let verb = if tool.starts_with("update") || tool == "completeTask" {
        "更新"
    } else if tool == "startTimer" {
        "开始计时"
    } else if tool == "stopTimer" {
        "停止计时"
    } else {
        "创建"
    };
    format!("准备{verb}：{object_name}")
}

fn find_agent_action_by_key(connection: &Connection, key: &str) -> Result<Option<Value>, String> {
    connection.query_row(
        "SELECT id, entity, data_json, created_at, updated_at FROM records WHERE entity='agentActions' AND archived_at IS NULL AND deleted_at IS NULL AND json_extract(data_json,'$.idempotencyKey')=?1 AND json_extract(data_json,'$.status') IN ('CONFIRM_REQUIRED','EXECUTING','SUCCESS') ORDER BY updated_at DESC LIMIT 1",
        params![key],
        |row| Ok(value_to_record(row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
    ).optional().map_err(|error| error.to_string())
}

fn voice_mode(context: &Value) -> bool {
    context.get("voiceMode").and_then(Value::as_bool).unwrap_or(false)
}

fn voice_audit_context(context: &Value) -> Value {
    if !voice_mode(context) { return context.clone(); }
    json!({
        "voiceMode": true,
        "voiceIntent": context.get("voiceIntent").cloned().unwrap_or(Value::Null),
        "currentRoute": context.get("currentRoute").cloned().unwrap_or(Value::Null),
        "currentEntityId": context.get("currentEntityId").cloned().unwrap_or(Value::Null),
        "currentProjectId": context.get("currentProjectId").cloned().unwrap_or(Value::Null),
        "currentTaskId": context.get("currentTaskId").cloned().unwrap_or(Value::Null)
    })
}

fn create_agent_action(app: AppHandle, plan: &Value, context: &Value) -> Result<Value, String> {
    let tool = plan
        .get("toolName")
        .and_then(Value::as_str)
        .ok_or("AI 没有返回可执行 Tool")?;
    let (entity, risk, requires_confirmation, action_type) =
        agent_tool_metadata(tool).ok_or_else(|| format!("不允许执行未注册 Tool：{tool}"))?;
    let connection = db(&app)?;
    let input = apply_agent_context(
        &connection,
        entity,
        action_type,
        plan.get("input").unwrap_or(&json!({})),
        context,
    )?;
    validate_agent_input(entity, action_type, &input)?;
    validate_agent_tool_input(tool, &input)?;
    let idempotency_key = action_idempotency_key(tool, &input);
    if let Some(existing) = find_agent_action_by_key(&connection, &idempotency_key)? {
        return Ok(existing);
    }
    let action_id = new_id("agentActions");
    let action = json!({
        "id": action_id,
        "actionId": action_id,
        "intent": plan.get("intent").and_then(Value::as_str).unwrap_or("CREATE"),
        "toolName": tool,
        "entityType": entity,
        "input": input,
        "status": if requires_confirmation { "CONFIRM_REQUIRED" } else { "PENDING" },
        "riskLevel": risk,
        "requiresConfirmation": requires_confirmation,
        "userConfirmed": false,
        "idempotencyKey": idempotency_key,
        "previewTitle": agent_preview_title(tool, &input),
        "previewFields": action_preview_fields(&input),
        "context": voice_audit_context(context),
        "source": if voice_mode(context) { "VOICE" } else { "AI" },
        "createdAt": now()
    });
    save_record(app, "agentActions".into(), action)
}

fn import_workspace_document_to_notebook(app: AppHandle, input: Value) -> Result<Value, String> {
    let source_path = input["sourcePath"]
        .as_str()
        .ok_or("导入本地文档缺少 sourcePath")?;
    let source = resolve_workspace_document_path(&app, source_path)?;
    let name = input["name"]
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .or_else(|| {
            source
                .file_name()
                .and_then(|value| value.to_str())
                .map(str::to_string)
        })
        .ok_or("文档没有有效文件名")?;
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    let mime_type = match extension.as_str() {
        "md" => "text/markdown",
        "txt" => "text/plain",
        "json" => "application/json",
        "csv" => "text/csv",
        _ => "application/octet-stream",
    };
    let id = new_id("notebookFiles");
    let stored_name = if extension.is_empty() {
        id.clone()
    } else {
        format!("{id}.{extension}")
    };
    let storage_path = notebook_files_dir(&app)?.join(stored_name);
    fs::copy(&source, &storage_path).map_err(|error| error.to_string())?;
    let mut data = notebook_file_data(
        id,
        name,
        mime_type.into(),
        &storage_path,
        input["notebookCategoryId"].as_str().map(str::to_string),
        input["notebookFolderId"].as_str().map(str::to_string),
        None,
    )?;
    let object = data.as_object_mut().ok_or("Notebook 文件数据无效")?;
    object.insert(
        "importSource".into(),
        Value::String("WORKSPACE_DOCUMENT".into()),
    );
    object.insert(
        "sourceDocumentName".into(),
        Value::String(
            source
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("本地文档")
                .into(),
        ),
    );
    if let Some(action_id) = input["agentActionId"].as_str() {
        object.insert("agentActionId".into(), Value::String(action_id.into()));
        object.insert("evidenceLevel".into(), Value::String("AI_CONFIRMED".into()));
    }
    save_record(app, "notebookFiles".into(), data)
}

fn execute_registered_tool(app: AppHandle, action: &Value) -> Result<Value, String> {
    let tool = action
        .get("toolName")
        .and_then(Value::as_str)
        .ok_or("Action 缺少 Tool")?;
    let (entity, _, _, action_type) = agent_tool_metadata(tool).ok_or("Tool 未注册")?;
    let mut input = action.get("input").cloned().unwrap_or_else(|| json!({}));
    if let Some(object) = input.as_object_mut() {
        if let Some(action_id) = action.get("actionId").and_then(Value::as_str) {
            object.insert("agentActionId".into(), Value::String(action_id.into()));
            object.insert("evidenceLevel".into(), Value::String("AI_CONFIRMED".into()));
        }
        if tool == "createFinancialTransaction" {
            object.insert("status".into(), Value::String("DRAFT".into()));
        }
        if tool == "voidFinancialTransaction" {
            object.insert("status".into(), Value::String("VOIDED".into()));
        }
    }
    validate_agent_input(entity, action_type, &input)?;
    validate_agent_tool_input(tool, &input)?;
    if tool == "importWorkspaceDocumentToNotebook" {
        return import_workspace_document_to_notebook(app, input);
    }
    match action_type {
        "CREATE" => save_record(app, entity.into(), input),
        "UPDATE" => {
            let id = input
                .get("id")
                .and_then(Value::as_str)
                .ok_or("更新操作缺少 ID")?
                .to_string();
            let existing = get_record(app.clone(), id.clone())?.ok_or("要更新的记录不存在")?;
            if existing["entity"] != entity {
                return Err("记录类型与 Tool 不匹配".into());
            }
            if let (Some(existing_object), Some(input_object)) =
                (existing.as_object(), input.as_object_mut())
            {
                for (key, value) in existing_object {
                    if !input_object.contains_key(key) {
                        input_object.insert(key.clone(), value.clone());
                    }
                }
            }
            save_record(app, entity.into(), input)
        }
        "COMPLETE" => {
            let id = input
                .get("id")
                .and_then(Value::as_str)
                .ok_or("完成任务缺少 ID")?
                .to_string();
            let mut task = get_record(app.clone(), id)?.ok_or("任务不存在")?;
            if task["entity"] != "tasks" {
                return Err("记录不是任务".into());
            }
            let object = task.as_object_mut().ok_or("任务结构无效")?;
            object.insert("status".into(), Value::String("completed".into()));
            object.insert("completedAt".into(), Value::String(now()));
            save_record(app, "tasks".into(), task)
        }
        "START_TIMER" => {
            let object = input.as_object_mut().ok_or("计时参数无效")?;
            object.insert("startAt".into(), Value::String(now()));
            object.insert("isRunning".into(), Value::Bool(true));
            object.insert("status".into(), Value::String("running".into()));
            if object
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("")
                .is_empty()
            {
                object.insert("title".into(), Value::String("专注工作".into()));
            }
            save_record(app, "timeLogs".into(), input)
        }
        "STOP_TIMER" => {
            let connection = db(&app)?;
            let running = connection.query_row("SELECT id, data_json FROM records WHERE entity='timeLogs' AND archived_at IS NULL AND deleted_at IS NULL AND json_extract(data_json,'$.isRunning')=1 LIMIT 1", [], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))).optional().map_err(|error| error.to_string())?.ok_or("当前没有正在运行的计时")?;
            let data: Value =
                serde_json::from_str(&running.1).map_err(|error| error.to_string())?;
            let start = data
                .get("startAt")
                .and_then(Value::as_str)
                .and_then(|value| value.parse::<i64>().ok())
                .unwrap_or_else(|| now().parse::<i64>().unwrap_or_default());
            let end = now();
            let end_ms = end.parse::<i64>().unwrap_or(start);
            let minutes = ((end_ms - start) / 60000).max(1);
            stop_timer(app, running.0, end, minutes)
        }
        _ => Err("当前 Tool 动作尚未实现".into()),
    }
}

#[tauri::command]
fn execute_ai_action(app: AppHandle, action_id: String) -> Result<Value, String> {
    let connection = db(&app)?;
    let mut action = record_by_id(&connection, &action_id)?.ok_or("AI Action 不存在")?;
    if action["entity"] != "agentActions" {
        return Err("记录不是 AI Action".into());
    }
    if action["status"] == "SUCCESS" {
        return Ok(
            json!({"action": action, "record": action.get("result").cloned(), "duplicate": true}),
        );
    }
    if action["status"] == "CANCELLED" {
        return Err("该 Action 已取消".into());
    }
    let started = Instant::now();
    {
        let object = action.as_object_mut().ok_or("Action 结构无效")?;
        object.insert("status".into(), Value::String("EXECUTING".into()));
        object.insert("userConfirmed".into(), Value::Bool(true));
    }
    action = save_record(app.clone(), "agentActions".into(), action)?;
    match execute_registered_tool(app.clone(), &action) {
        Ok(record) => {
            let object = action.as_object_mut().ok_or("Action 结构无效")?;
            object.insert("status".into(), Value::String("SUCCESS".into()));
            object.insert(
                "entityId".into(),
                record.get("id").cloned().unwrap_or(Value::Null),
            );
            object.insert("result".into(), record.clone());
            object.insert("completedAt".into(), Value::String(now()));
            object.insert(
                "duration".into(),
                Value::Number((started.elapsed().as_millis() as u64).into()),
            );
            object.remove("error");
            let saved_action = save_record(app, "agentActions".into(), action)?;
            Ok(json!({"action": saved_action, "record": record, "duplicate": false}))
        }
        Err(error) => {
            let object = action.as_object_mut().ok_or("Action 结构无效")?;
            object.insert("status".into(), Value::String("FAILED".into()));
            object.insert("error".into(), Value::String(error.clone()));
            object.insert("completedAt".into(), Value::String(now()));
            object.insert(
                "duration".into(),
                Value::Number((started.elapsed().as_millis() as u64).into()),
            );
            save_record(app, "agentActions".into(), action)?;
            Err(format!("执行失败：{error}。没有写入成功。"))
        }
    }
}

#[tauri::command]
fn cancel_ai_action(app: AppHandle, action_id: String) -> Result<Value, String> {
    let connection = db(&app)?;
    let mut action = record_by_id(&connection, &action_id)?.ok_or("AI Action 不存在")?;
    if action["status"] == "SUCCESS" {
        return Err("已执行成功的 Action 不能取消".into());
    }
    let object = action.as_object_mut().ok_or("Action 结构无效")?;
    object.insert("status".into(), Value::String("CANCELLED".into()));
    object.insert("completedAt".into(), Value::String(now()));
    let saved = save_record(app, "agentActions".into(), action)?;
    Ok(json!({"action": saved}))
}

fn profile_field(data: &Value, key: &str, limit: usize) -> Option<String> {
    data.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(limit).collect())
}

fn profile_context_for_question(
    connection: &Connection,
    question: &str,
) -> Result<Option<Value>, String> {
    let profile = connection
        .query_row(
            "SELECT id, entity, data_json, created_at, updated_at FROM records WHERE entity='profiles' AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1",
            [],
            |row| Ok(value_to_record(row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some(profile) = profile else {
        return Ok(None);
    };
    let is_related = |keywords: &[&str]| keywords.iter().any(|keyword| question.contains(keyword));
    let use_identity = is_related(&[
        "我是谁",
        "身份",
        "职业",
        "角色",
        "公司",
        "组织",
        "工作领域",
        "背景",
    ]);
    let use_personal = use_identity
        || is_related(&[
            "长期方向",
            "方向",
            "重点",
            "工作方式",
            "项目",
            "推进",
            "决策",
            "业务",
            "工具",
            "优先",
        ]);
    let use_ai = is_related(&[
        "AI",
        "ai",
        "助理",
        "如何帮助",
        "怎么帮助",
        "回答偏好",
        "回复偏好",
        "沟通",
        "以后",
    ]);
    if !use_identity && !use_personal && !use_ai {
        return Ok(None);
    }

    let mut sections = Vec::new();
    let append = |label: &str, key: &str, limit: usize, target: &mut Vec<String>| {
        if let Some(value) = profile_field(&profile, key, limit) {
            target.push(format!("{label}：{value}"));
        }
    };
    if use_identity {
        let mut lines = Vec::new();
        append("姓名", "name", 80, &mut lines);
        append("昵称", "nickname", 80, &mut lines);
        append("职业 / 身份", "occupation", 120, &mut lines);
        append("当前角色", "role", 120, &mut lines);
        append("公司 / 组织", "organization", 120, &mut lines);
        append("主要工作领域", "workDomains", 180, &mut lines);
        if !lines.is_empty() {
            sections.push(format!("基础资料\n{}", lines.join("\n")));
        }
    }
    if use_personal {
        let mut lines = Vec::new();
        append("长期方向", "longTermDirection", 480, &mut lines);
        append("当前重点", "currentFocus", 240, &mut lines);
        append("工作方式", "workStyle", 420, &mut lines);
        append("决策方式", "decisionStyle", 420, &mut lines);
        append("常用工具", "commonTools", 180, &mut lines);
        append("其他长期背景", "otherContext", 320, &mut lines);
        if !lines.is_empty() {
            sections.push(format!("个人上下文\n{}", lines.join("\n")));
        }
    }
    if use_ai {
        let mut lines = Vec::new();
        append(
            "希望 AI 如何帮助我",
            "aiAssistancePreference",
            480,
            &mut lines,
        );
        append("回答偏好", "aiResponsePreference", 360, &mut lines);
        append("决策偏好", "aiDecisionPreference", 360, &mut lines);
        append("AI 其他上下文", "aiOtherContext", 260, &mut lines);
        if !lines.is_empty() {
            sections.push(format!("AI 上下文\n{}", lines.join("\n")));
        }
    }
    if sections.is_empty() {
        return Ok(None);
    }
    Ok(Some(json!({
        "id": profile["id"], "entity": "profiles", "type": "PROFILE_CONTEXT",
        "title": "与当前问题相关的我的档案", "content": sections.join("\n\n"),
        "evidenceLevel": "USER_CONFIRMED"
    })))
}

#[tauri::command]
async fn ask_chief(
    app: AppHandle,
    question: String,
    context: Option<Value>,
    history: Option<Vec<Value>>,
    schema_registry: Option<Value>,
    tool_definitions: Option<Value>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ask_chief_blocking(
            app,
            question,
            context,
            history,
            schema_registry,
            tool_definitions,
        )
    })
    .await
    .map_err(|error| format!("AI 后台任务失败：{error}"))?
}

fn compact_for_ai(value: &Value, depth: usize) -> Value {
    match value {
        Value::String(text) => {
            let limit = 12_000;
            if text.chars().count() > limit {
                let prefix = text.chars().take(limit).collect::<String>();
                Value::String(format!("{prefix}\n[内容已省略]"))
            } else {
                Value::String(text.clone())
            }
        }
        Value::Array(items) => {
            if depth >= 5 {
                return Value::String("[嵌套内容已省略]".into());
            }
            Value::Array(
                items
                    .iter()
                    .take(30)
                    .map(|item| compact_for_ai(item, depth + 1))
                    .collect(),
            )
        }
        Value::Object(object) => {
            if depth >= 5 {
                return Value::String("[嵌套内容已省略]".into());
            }
            Value::Object(
                object
                    .iter()
                    .map(|(key, item)| (key.clone(), compact_for_ai(item, depth + 1)))
                    .collect(),
            )
        }
        _ => value.clone(),
    }
}

fn workspace_document_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let source_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")))
        .join("docs");
    roots.push(source_root);
    if let Ok(resource_dir) = app.path().resource_dir() {
        roots.push(resource_dir.join("docs"));
    }
    roots
}

fn is_workspace_document(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|extension| extension.to_str()),
        Some("md" | "txt" | "json" | "csv")
    )
}

fn resolve_workspace_document_path(
    app: &AppHandle,
    requested_path: &str,
) -> Result<PathBuf, String> {
    let requested = PathBuf::from(requested_path);
    let candidates = if requested.is_absolute() {
        vec![requested]
    } else {
        workspace_document_roots(app)
            .into_iter()
            .map(|root| root.join(&requested))
            .collect()
    };
    for candidate in candidates {
        let Ok(canonical) = candidate.canonicalize() else {
            continue;
        };
        let allowed = workspace_document_roots(app).into_iter().any(|root| {
            root.canonicalize()
                .map(|canonical_root| canonical.starts_with(canonical_root))
                .unwrap_or(false)
        });
        if !allowed {
        return Err("只允许读取 EvoPilot docs/ 目录内的文档".into());
        }
        if !is_workspace_document(&canonical) {
            return Err("仅支持读取 Markdown、TXT、JSON 或 CSV 文档".into());
        }
        let metadata = fs::metadata(&canonical).map_err(|error| error.to_string())?;
        if metadata.len() > WORKSPACE_DOCUMENT_LIMIT {
            return Err("文档超过 2 MB，不能直接注入 AI 上下文".into());
        }
        return Ok(canonical);
    }
    Err("未找到指定的 EvoPilot docs 文档".into())
}

fn read_workspace_document_file(app: &AppHandle, requested_path: &str) -> Result<Value, String> {
    let canonical = resolve_workspace_document_path(app, requested_path)?;
    let content = fs::read_to_string(&canonical).map_err(|error| error.to_string())?;
    let (content, truncated) = truncate_notebook_text(content, 60_000);
    Ok(json!({
            "id": format!("workspace-document:{}", canonical.to_string_lossy()),
            "entity": "dataRecords",
            "type": "WORKSPACE_DOCUMENT",
            "title": canonical.file_name().and_then(|name| name.to_str()).unwrap_or("本地文档"),
            "path": canonical.to_string_lossy(),
            "content": content,
            "truncated": truncated,
            "evidenceLevel": "USER_AUTHORIZED_LOCAL_DOCUMENT"
    }))
}

fn workspace_document_path_in_question(question: &str) -> Option<String> {
    let expression =
        Regex::new(r#"(?P<path>(?:/|\.?/)[^\n\r\"'`，。！？；]+?\.(?:md|txt|json|csv))"#).ok()?;
    expression
        .captures(question)
        .and_then(|captures| captures.name("path"))
        .map(|value| value.as_str().to_string())
}

#[tauri::command]
fn read_workspace_document(app: AppHandle, path: String) -> Result<Value, String> {
    read_workspace_document_file(&app, &path)
}

fn ask_chief_blocking(
    app: AppHandle,
    question: String,
    context: Option<Value>,
    history: Option<Vec<Value>>,
    schema_registry: Option<Value>,
    tool_definitions: Option<Value>,
) -> Result<Value, String> {
    let connection = db(&app)?;
    let provider = active_provider(&connection)?;
    let key = provider_key(&provider)?;
    let model = selected_model(&connection, &provider)?;
    let page_context = compact_for_ai(&context.unwrap_or_else(|| json!({})), 0);
    let global_context = page_context.get("globalContext").cloned().unwrap_or_else(|| json!({}));
    let include_inbox = global_context
        .get("includeInbox")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let relation_budget = global_context
        .get("contextBudget")
        .and_then(|budget| budget.get("maxRelatedEntities"))
        .and_then(Value::as_u64)
        .unwrap_or(24) as usize;
    let mut local_context = search_filtered(&connection, &question, &[])?;
    local_context.retain(|record| record["entity"].as_str() != Some("profiles"));
    if !include_inbox {
        local_context.retain(|record| record["entity"].as_str() != Some("inbox"));
    }
    let mut context_ids = page_context
        .get("selectedItems")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|value| value.as_str().map(str::to_string))
        .collect::<Vec<_>>();
    for key in [
        "currentEntityId",
        "currentGoalId",
        "currentProjectId",
        "currentTaskId",
    ] {
        if let Some(id) = context_string(&page_context, key) {
            if !context_ids.contains(&id) {
                context_ids.push(id);
            }
        }
    }
    for id in context_ids {
        if let Some(record) = record_by_id(&connection, &id)? {
            if !local_context
                .iter()
                .any(|existing| existing["id"] == record["id"])
            {
                local_context.insert(0, record);
            }
        }
        let available = relation_budget.saturating_sub(local_context.len());
        for record in list_relations(app.clone(), id)?.into_iter().take(available) {
            if !local_context
                .iter()
                .any(|existing| existing["id"] == record["id"])
            {
                local_context.push(record);
            }
        }
    }
    if let Some(profile_context) = profile_context_for_question(&connection, &question)? {
        local_context.push(profile_context);
    }
    if let Some(path) = workspace_document_path_in_question(&question) {
        match read_workspace_document_file(&app, &path) {
            Ok(document) => local_context.insert(0, document),
            Err(error) => local_context.insert(
                0,
                json!({
                    "id": format!("workspace-document-error:{path}"),
                    "entity": "dataRecords",
                    "type": "WORKSPACE_DOCUMENT_ERROR",
                    "path": path,
                    "error": error,
                    "evidenceLevel": "USER_AUTHORIZED_LOCAL_DOCUMENT"
                }),
            ),
        }
    }
    local_context.truncate(48);
    let local_context = local_context
        .iter()
        .map(|record| compact_for_ai(record, 0))
        .collect::<Vec<_>>();
    let context_json =
        serde_json::to_string_pretty(&local_context).map_err(|error| error.to_string())?;
    let schema_json = serde_json::to_string(&schema_registry.unwrap_or_else(|| json!([])))
        .map_err(|error| error.to_string())?;
    let tools_json = serde_json::to_string(&tool_definitions.unwrap_or_else(|| json!([])))
        .map_err(|error| error.to_string())?;
    let page_json =
        serde_json::to_string_pretty(&page_context).map_err(|error| error.to_string())?;
    let system = r#"你是 EvoPilot 的 AI Agent，也是用户的首席助理。你既能分析，也能通过受控 Action System 操作 EvoPilot。
必须只返回一个 JSON 对象，禁止 Markdown 代码块。格式：
{"mode":"chat|action","answer":"给用户看的简体中文","intent":"意图","toolName":"注册工具名","input":{},"missingFields":[]}
规则：
1. 用户明确要求保存、创建、更新、完成、开始或停止计时时，mode=action；不要回复“无法写入”，不要询问 Markdown/JSON/存储路径。
2. “保存到思维模型库”“沉淀为思维模型”“把刚才的模型保存”使用 createMentalModel，intent=SAVE_MENTAL_MODEL 或 CONVERT_TO_MENTAL_MODEL。
3. 从最近对话完整提取思维模型：name, category, corePrinciple, problem, framework, steps, keyQuestions, useCases, examples, outputTemplate, source, tags。多项内容可整理为换行文本。
4. 当前页面是思维模型且用户说“保存这个”时，目标就是思维模型库。
5. 创建 Project/Task/Time/Decision 时不要编造关系 ID；缺省关系由 Action System 根据当前上下文继承。
6. 写入遵循 Action Guard：READ 直接分析；用户明确、字段完整且 Tool 标记为 LOW_WRITE 的创建操作可直接执行；MEDIUM_WRITE 与 HIGH_RISK 必须只生成预览并等待确认。绝不能声称尚未执行的操作已经保存。
7. 删除、批量修改或批量删除不要生成 Action，只说明影响并要求明确确认；当前阶段没有删除 Tool。
8. 如果缺少真正必要字段，将 mode=chat，missingFields 列出并只问最少问题。
9. 普通分析/搜索问题 mode=chat，依据本地记录回答；可以明确说明正在调用找到的思维模型。
10. 不向用户暴露 JSON、Schema、数据库、SQL、内部 API 或 Tool 技术细节。
11. 当当前页面上下文 analysisMode=timeline_readonly 时，只能进行基于证据的只读分析，mode 必须为 chat，禁止生成 Action。
12. External Intelligence 分析必须区分事实、确定性计算、AI 推断、数据缺口和替代解释；不得把爆款等同于需求，不得把转载等同于独立信号。
13. 创建情报源、机会或由信号生成决策时必须生成 Action 预览；不得自动创建 Project、增加预算、采购或修改财务。
14. 外部指标只能引用 VERIFIED_EXTERNAL_TOOL_RESULT、Signal 或真实本地记录；缺失时必须说明数据不足。
15. Finance、Outcome 与 Project Economics 必须区分事实、确定性计算、推断和数据缺口；MISSING 不能解释为 0。
16. 现金净流动、项目经营贡献不等于会计利润；不得把库存采购直接判断为项目亏损。
17. AI 创建 Outcome、账户、分类或财务流水只能生成 Action 预览。财务流水默认 DRAFT，禁止直接创建 POSTED 流水、自动付款、增加预算或修改账户余额。
18. 用户说“保存到 Notebook”“记一条想法”“随手记下来”时使用 createNote 生成 Action 预览，intent=SAVE_NOTE 或 CREATE_NOTE；Note 不要求分类或关联，title 必填，content 可选。
19. 当用户要求理解、总结或查找 Notebook 文件时，只能使用文件已提取文本和 Metadata；若 extractStatus 不是 READY，必须说明文件仍可保存但尚无可用正文。AI 可以提出潜在关联候选和理由，但绝不能创建、删除或移动 Relation。
20. 当相关本地记录中存在 type=WORKSPACE_DOCUMENT 时，其 content 是用户明确授权读取的 EvoPilot docs 文档。必须直接基于该内容回答，不得声称“没有直接读取本地文件的工具”。如果存在 WORKSPACE_DOCUMENT_ERROR，则说明错误原因和允许的 docs/ 路径范围。
21. 用户明确要求把 WORKSPACE_DOCUMENT 保存、导入或复制到 Notebook 时，使用 importWorkspaceDocumentToNotebook 生成 Action 预览，input 必须包含 name 和 sourcePath。该操作只复制 docs 文件到 Notebook Inbox，不修改源文件；必须等待用户确认后执行。
22. type=PROFILE_CONTEXT 是用户主动保存的长期个人与 AI 上下文。只在它与当前问题直接相关时使用，不能机械复述、不能暴露无关私人资料；当前用户问题和当前页面上下文优先于 Profile。
23. AI 默认只能读取 Profile。用户明确要求更新我的档案时，只有在存在真实 Profile ID 且字段明确时，才使用 updateProfile 生成 Action 预览；绝不能声称已更新，必须等待用户确认后才写入。
24. Global Context Package 是本次回答的事实边界：优先使用其中 current 与 relation 来源，再使用 search 来源；缺少 Time、Finance、Result、Review 或 Workflow 事实时必须明确说数据缺失，不能估算。除非 Global Context Package 的 includeInbox=true，禁止引用 Inbox。
25. 用户要求根据成果或复盘优化工作链时，只能使用 createWorkflowImprovementProposal 生成改进提案，不能直接修改 Workflow、Promote 或 Rollback。"#;
    let mut messages = Vec::new();
    let recent_history = history.unwrap_or_default();
    let skip = recent_history.len().saturating_sub(10);
    for message in recent_history.into_iter().skip(skip) {
        if let (Some(role), Some(content)) = (message["role"].as_str(), message["content"].as_str())
        {
            if ["user", "assistant"].contains(&role) {
                messages.push(json!({"role": role, "content": content}));
            }
        }
    }
    messages.push(json!({"role":"user","content":format!("当前页面上下文：\n{page_json}\n\nEvoPilot Schema Registry：\n{schema_json}\n\n允许使用的 Tool Registry：\n{tools_json}\n\n相关本地记录与可调用思维模型：\n{context_json}\n\n当前用户请求：\n{question}")}));
    let (response_json, _) = call_provider(&provider, &key, &model, system, &messages, 2800)?;
    let raw = provider_response_text(&provider, &response_json);
    if raw.trim().is_empty() {
        return Err(format!("{} 未返回文本内容", provider_label(&provider)));
    }
    let parsed = extract_json_value(&raw);
    let mut answer = parsed
        .as_ref()
        .and_then(|value| value.get("answer"))
        .and_then(Value::as_str)
        .unwrap_or(&raw)
        .trim()
        .to_string();
    let mut action: Option<Value> = None;
    if !timeline_analysis_is_read_only(&page_context)
        && parsed
            .as_ref()
            .and_then(|value| value.get("mode"))
            .and_then(Value::as_str)
            == Some("action")
    {
        let plan = parsed.as_ref().unwrap();
        match create_agent_action(app.clone(), plan, &page_context) {
            Ok(saved_action) => {
                let status = saved_action
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if status == "PENDING" {
                    let action_id = saved_action
                        .get("actionId")
                        .and_then(Value::as_str)
                        .ok_or("AI Action 缺少 actionId")?
                        .to_string();
                    let executed = execute_ai_action(app.clone(), action_id)?;
                    let record = executed.get("record").cloned().unwrap_or(Value::Null);
                    let label = record
                        .get("entity")
                        .and_then(Value::as_str)
                        .unwrap_or("记录");
                    answer = format!("已按你的明确指令保存{label}。可在对应模块继续查看或修改。");
                    action = executed.get("action").cloned();
                } else if status == "SUCCESS" {
                    answer = "相同操作已经执行成功，为避免重复，没有再次创建。".into();
                    action = Some(saved_action);
                } else {
                    answer = format!(
                        "{}。请确认后执行。",
                        saved_action
                            .get("previewTitle")
                            .and_then(Value::as_str)
                            .unwrap_or("我已整理好本次操作")
                    );
                    action = Some(saved_action);
                }
            }
            Err(error) => {
                answer = format!("我理解了你的操作意图，但当前还不能安全执行：{error}");
            }
        }
    }
    let is_voice_request = voice_mode(&page_context);
    let audit_page_context = voice_audit_context(&page_context);
    let response_answer = answer.clone();
    let run = json!({
        "id": new_id("agentRuns"), "agentType": format!("{}-agent-planner", provider), "provider": provider,
        "input": if is_voice_request { "[voice transcript not retained]" } else { &question }, "context": local_context, "pageContext": audit_page_context,
        "output": if is_voice_request { "[voice response not retained]" } else { &answer },
        "actionId": action.as_ref().and_then(|value| value.get("actionId")).cloned(),
        "status": "completed", "model": model, "startedAt": now(), "completedAt": now()
    });
    let saved_run = save_record(app, "agentRuns".into(), run)?;
    Ok(
        json!({"answer": response_answer, "context": saved_run["context"], "action": action, "agentRun": saved_run}),
    )
}

pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_log::Builder::default().build());
    #[cfg(feature = "webdriver")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    builder
        .setup(|app| {
            db(&app.handle()).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            initialize_database,
            check_relationship_integrity,
            capture_link,
            get_finance_summary,
            get_capture_provider_config,
            configure_capture_provider,
            test_capture_provider,
            search_tiktok_research,
            execute_research_source,
            list_external_items,
            cleanup_external_cache,
            list_records,
            query_decision_records,
            list_sync_records,
            merge_remote_records,
            get_sync_status,
            get_build_provenance,
            get_sync_v1_config,
            configure_sync_v1,
            test_sync_v1,
            register_sync_device,
            list_sync_outbox,
            acknowledge_sync_mutations,
            apply_sync_changes,
            list_sync_conflicts,
            save_sync_conflict,
            get_record,
            save_record,
            delete_record,
            delete_records,
            archive_record,
            archive_records,
            restore_record,
            list_archived,
            search_records,
            search_records_filtered,
            list_relations,
            add_relation,
            remove_relation,
            get_notebook_storage_config,
            set_notebook_storage_config,
            begin_notebook_file_upload,
            append_notebook_file_upload,
            finish_notebook_file_upload,
            upload_notebook_file,
            open_notebook_file,
            reveal_notebook_file,
            get_notebook_file_preview,
            get_notebook_pdf_page,
            extract_notebook_file_content,
            copy_notebook_file,
            destroy_notebook_file,
            stop_timer,
            export_data,
            create_backup,
            list_backups,
            restore_backup,
            open_external,
            get_ai_config,
            configure_ai_provider,
            test_ai_provider,
            get_hackstart_config,
            configure_hackstart,
            read_workspace_document,
            ask_chief,
            execute_ai_action,
            cancel_ai_action
        ])
        .run(tauri::generate_context!())
        .expect("error while running EvoPilot");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_audit_context_excludes_transcript_and_conversation() {
        let source = json!({
            "voiceMode": true,
            "voiceIntent": "FAST_AI",
            "currentRoute": "tasks",
            "recentConversation": [{"role": "user", "content": "请创建一个不能留存的语音内容"}],
            "globalContext": {"userQuery": "不能留存的语音内容"}
        });
        let audit = voice_audit_context(&source);
        assert_eq!(audit["voiceMode"], true);
        assert_eq!(audit["voiceIntent"], "FAST_AI");
        assert!(audit.get("recentConversation").is_none());
        assert!(audit.get("globalContext").is_none());
        assert!(!audit.to_string().contains("不能留存的语音内容"));
    }

    #[test]
    fn voice_runs_store_no_transcript_or_response_text() {
        let transcript = "请把刚才的私密语音内容保存下来";
        let response = "我不会保留那段私密语音内容";
        let page_context = json!({"voiceMode": true, "voiceIntent": "FAST_AI"});
        let stored = json!({
            "input": if voice_mode(&page_context) { "[voice transcript not retained]" } else { transcript },
            "output": if voice_mode(&page_context) { "[voice response not retained]" } else { response },
            "pageContext": voice_audit_context(&page_context)
        });
        assert!(!stored.to_string().contains(transcript));
        assert!(!stored.to_string().contains(response));
    }

    #[test]
    fn notebook_storage_supports_safe_names_extractable_text_and_preview_encoding() {
        assert_eq!(safe_file_name("../unsafe:name?.txt"), "_unsafe_name_.txt");
        assert_eq!(
            strip_xml("<p>Hello <b>Notebook</b>&amp; AI</p>"),
            "Hello Notebook & AI"
        );
        assert_eq!(base64_encode(b"Jason"), "SmFzb24=");
        let (text, truncated) = truncate_notebook_text("abcdef".into(), 3);
        assert!(truncated);
        assert!(text.starts_with("abc"));
    }

    #[test]
    fn workspace_document_paths_are_explicit_and_limited_to_text_formats() {
        assert_eq!(
            workspace_document_path_in_question(
                "请读取 /Users/mac/Desktop/JASON OS/docs/JASON_OS_创作SOP.md"
            ),
            Some("/Users/mac/Desktop/JASON OS/docs/JASON_OS_创作SOP.md".into())
        );
        assert!(is_workspace_document(Path::new("guide.md")));
        assert!(is_workspace_document(Path::new("guide.txt")));
        assert!(!is_workspace_document(Path::new("secret.pdf")));
    }

    #[test]
    fn workspace_document_import_is_a_confirmed_notebook_write() {
        assert_eq!(
            agent_tool_metadata("importWorkspaceDocumentToNotebook"),
            Some(("notebookFiles", "MEDIUM_WRITE", true, "CREATE"))
        );
        assert!(validate_agent_tool_input(
            "importWorkspaceDocumentToNotebook",
            &json!({"name":"SOP.md","sourcePath":"/docs/SOP.md"})
        )
        .is_ok());
        assert!(validate_agent_tool_input(
            "importWorkspaceDocumentToNotebook",
            &json!({"name":"SOP.md"})
        )
        .is_err());
    }

    #[test]
    fn notebook_entities_and_relation_fields_are_registered() {
        for entity in [
            "notes",
            "notebookCategories",
            "notebookFolders",
            "notebookFiles",
        ] {
            assert!(is_entity(entity));
        }
        assert_eq!(
            expected_entity("notebookCategoryId"),
            Some("notebookCategories")
        );
        assert_eq!(expected_entity("notebookFolderId"), Some("notebookFolders"));
    }

    #[test]
    fn work_chain_and_results_center_entities_reuse_declared_relations() {
        for entity in [
            "results",
            "deliverables",
            "resultPackages",
            "workflows",
            "workflowVersions",
            "workflowSteps",
            "workflowGates",
            "workflowRuns",
            "workflowRunSteps",
            "workflowMetricDefinitions",
            "workflowImprovementProposals",
        ] {
            assert!(is_entity(entity));
        }
        assert_eq!(expected_entity("fileId"), Some("notebookFiles"));
        assert_eq!(expected_entity("evidenceId"), Some("results"));
        assert_eq!(expected_entity("workflowRunId"), Some("workflowRuns"));
    }

    #[test]
    fn outcome_and_finance_entities_and_agent_tools_are_registered() {
        for entity in [
            "results",
            "financialAccounts",
            "financialCategories",
            "financialTransactions",
            "financialTransactionAllocations",
        ] {
            assert!(is_entity(entity));
        }
        assert_eq!(agent_tool_metadata("createOutcome").unwrap().0, "results");
        assert_eq!(
            agent_tool_metadata("createFinancialTransaction").unwrap().1,
            "HIGH_RISK"
        );
        assert_eq!(
            expected_entity("destinationAccountId"),
            Some("financialAccounts")
        );
        assert_eq!(
            expected_entity("refundOfTransactionId"),
            Some("financialTransactions")
        );
    }

    #[test]
    fn action_guard_keeps_low_writes_direct_and_material_changes_confirmed() {
        assert_eq!(agent_tool_metadata("createTask"), Some(("tasks", "LOW_WRITE", false, "CREATE")));
        assert_eq!(agent_tool_metadata("updateProject"), Some(("projects", "MEDIUM_WRITE", true, "UPDATE")));
        assert_eq!(agent_tool_metadata("promoteWorkflowVersion"), Some(("workflowVersions", "HIGH_RISK", true, "UPDATE")));
        assert!(agent_tool_metadata("getProject").is_none());
    }

    #[test]
    fn notebook_text_extraction_keeps_searchable_content_separate_from_the_source_file() {
        let path = std::env::temp_dir().join(format!("jason-os-notebook-{}.txt", now()));
        fs::write(&path, "Shopify SEO research\n关键词：自然流量").unwrap();
        let extracted = extract_notebook_content(&path, "txt").unwrap();
        assert!(extracted.contains("Shopify SEO research"));
        assert!(path.exists());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn external_intelligence_entities_and_agent_tools_are_registered() {
        for entity in [
            "externalSources",
            "signals",
            "opportunities",
            "intelligenceBriefs",
        ] {
            assert!(is_entity(entity));
        }
        assert_eq!(
            agent_tool_metadata("createExternalSource").unwrap().0,
            "externalSources"
        );
        assert_eq!(
            agent_tool_metadata("createOpportunity").unwrap().0,
            "opportunities"
        );
    }

    #[test]
    fn capture_provider_config_never_contains_the_api_key() {
        let config = capture_provider_config(true, true, true, true);
        let serialized = serde_json::to_string(&config).unwrap();
        assert!(config["providers"][0]["configured"].as_bool().unwrap());
        assert_eq!(config["providers"][1]["id"], "apify");
        assert_eq!(config["providers"][1]["supportedPlatforms"], json!(["网页"]));
        assert_eq!(config["providers"][2]["capabilities"][0]["capability"], "VIDEO_SEARCH");
        assert!(!serialized.contains("apiKey"));
        assert!(!serialized.contains("REDFOX_API_KEY"));
        assert!(!serialized.contains("APIFY_API_TOKEN"));
        assert!(!serialized.contains("secret"));
    }

    #[test]
    fn agent_registry_allows_mental_model_writes_but_not_delete_tools() {
        assert_eq!(
            agent_tool_metadata("createMentalModel").unwrap().0,
            "mentalModels"
        );
        assert!(agent_tool_metadata("deleteProject").is_none());
    }

    #[test]
    fn agent_structured_output_accepts_json_inside_code_fences() {
        let parsed = extract_json_value(
            "```json\n{\"mode\":\"action\",\"toolName\":\"createMentalModel\"}\n```",
        )
        .unwrap();
        assert_eq!(parsed["toolName"], "createMentalModel");
    }

    #[test]
    fn agent_write_validation_requires_a_mental_model_name() {
        assert!(
            validate_agent_input("mentalModels", "CREATE", &json!({"name":"芒格式决策树"})).is_ok()
        );
        assert!(validate_agent_input(
            "mentalModels",
            "CREATE",
            &json!({"corePrinciple":"逆向思考"})
        )
        .is_err());
    }

    #[test]
    fn agent_note_creation_strips_relation_fields() {
        let connection = relationship_test_db();
        let input = apply_agent_context(
            &connection,
            "notes",
            "CREATE",
            &json!({
                "title": "一个想法",
                "content": "正文",
                "projectIds": ["project-1"],
                "taskIds": ["task-1"],
                "insightIds": ["insight-1"],
                "timeLogIds": ["timelog-1"],
                "mentalModelIds": ["model-1"]
            }),
            &json!({"currentProjectId": "project-1"}),
        )
        .unwrap();
        assert_eq!(input["title"], "一个想法");
        assert_eq!(input["content"], "正文");
        assert!(input.get("projectIds").is_none());
        assert!(input.get("taskIds").is_none());
        assert!(input.get("insightIds").is_none());
        assert!(input.get("timeLogIds").is_none());
        assert!(input.get("mentalModelIds").is_none());
    }

    #[test]
    fn repeated_agent_inputs_have_the_same_idempotency_key() {
        let input = json!({"name":"芒格式决策树","category":"决策模型"});
        assert_eq!(
            action_idempotency_key("createMentalModel", &input),
            action_idempotency_key("createMentalModel", &input)
        );
    }

    #[test]
    fn timeline_metadata_separates_planned_and_actual_time() {
        let planned = apply_timeline_metadata(
            "tasks",
            &json!({"status":"todo","dueDate":"2026-08-12"}),
            "2026-08-10T08:00:00-07:00",
            "2026-08-11T08:00:00-07:00",
        );
        assert_eq!(planned["occurredAt"], "2026-08-12");
        assert_eq!(planned["timeMeaning"], "planned");
        assert_eq!(planned["timeZone"], "local");
        let actual = apply_timeline_metadata(
            "tasks",
            &json!({"status":"completed","completedAt":"2026-08-11T09:30:00-07:00"}),
            "2026-08-10T08:00:00-07:00",
            "2026-08-11T09:30:00-07:00",
        );
        assert_eq!(actual["occurredAt"], "2026-08-11T09:30:00-07:00");
        assert_eq!(actual["timeMeaning"], "actual");
        assert_eq!(actual["timeZone"], "offset");
    }

    #[test]
    fn timeline_metadata_keeps_legacy_reviews_on_created_time() {
        let review = apply_timeline_metadata(
            "reviews",
            &json!({"title":"Review"}),
            "2026-08-01T10:00:00-07:00",
            "2026-08-11T10:00:00-07:00",
        );
        assert_eq!(review["occurredAt"], "2026-08-01T10:00:00-07:00");
        assert_eq!(review["timeMeaning"], "recorded");
    }

    #[test]
    fn timeline_change_events_are_idempotent() {
        let connection = relationship_test_db();
        put(
            &connection,
            "tasks",
            "task-1",
            json!({"title":"Task","status":"todo"}),
        );
        let before = json!({"title":"Task","status":"todo"});
        let after = json!({"title":"Task","status":"completed","taskId":"task-1"});
        write_timeline_change_events(&connection, "tasks", "task-1", Some(&before), &after)
            .unwrap();
        write_timeline_change_events(&connection, "tasks", "task-1", Some(&before), &after)
            .unwrap();
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM records WHERE entity='timelineEvents'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn external_source_capacity_limits_new_and_reactivated_sources() {
        let connection = relationship_test_db();
        for index in 0..20 {
            put(
                &connection,
                "externalSources",
                &format!("source-{index}"),
                json!({"name":format!("Source {index}"),"status":"active"}),
            );
        }
        assert!(ensure_external_source_capacity(
            &connection,
            "externalSources",
            "source-new",
            &json!({"name":"New","status":"active"})
        )
        .is_err());
        assert!(ensure_external_source_capacity(
            &connection,
            "externalSources",
            "source-0",
            &json!({"name":"Existing","status":"active"})
        )
        .is_ok());
        put(
            &connection,
            "externalSources",
            "source-paused",
            json!({"name":"Paused","status":"paused"}),
        );
        assert!(ensure_external_source_capacity(
            &connection,
            "externalSources",
            "source-paused",
            &json!({"name":"Paused","status":"active"})
        )
        .is_err());
    }

    #[test]
    fn external_decisions_validate_signal_and_opportunity_relations() {
        let connection = relationship_test_db();
        put(
            &connection,
            "signals",
            "signal-1",
            json!({"title":"Signal","status":"observing"}),
        );
        put(
            &connection,
            "opportunities",
            "opportunity-1",
            json!({"title":"Opportunity","status":"draft"}),
        );
        let decision = normalize_record(
            &connection,
            "decisions",
            &json!({"title":"Decision","signalIds":["signal-1"],"opportunityId":"opportunity-1"}),
            true,
        )
        .unwrap();
        assert_eq!(decision["signalIds"], json!(["signal-1"]));
        assert_eq!(decision["opportunityId"], "opportunity-1");
        assert!(normalize_record(
            &connection,
            "decisions",
            &json!({"title":"Bad decision","signalIds":["missing"]}),
            true,
        )
        .is_err());
    }

    #[test]
    fn causal_relation_ids_must_reference_the_expected_entity() {
        let connection = relationship_test_db();
        put(
            &connection,
            "decisions",
            "decision-1",
            json!({"title":"Decision"}),
        );
        let task = normalize_record(
            &connection,
            "tasks",
            &json!({"title":"Task","decisionId":"decision-1"}),
            true,
        )
        .unwrap();
        assert_eq!(task["decisionId"], "decision-1");
        assert!(normalize_record(
            &connection,
            "tasks",
            &json!({"title":"Task","decisionId":"missing"}),
            true
        )
        .is_err());
    }

    #[test]
    fn causal_context_is_inherited_and_conflicts_are_rejected() {
        let connection = relationship_test_db();
        put(&connection, "goals", "goal-1", json!({"title":"Goal 1"}));
        put(&connection, "goals", "goal-2", json!({"title":"Goal 2"}));
        put(
            &connection,
            "projects",
            "project-1",
            json!({"title":"Project 1","goalId":"goal-1"}),
        );
        put(
            &connection,
            "projects",
            "project-2",
            json!({"title":"Project 2","goalId":"goal-2"}),
        );
        put(
            &connection,
            "decisions",
            "decision-1",
            json!({"title":"Decision","projectId":"project-1"}),
        );
        let task = normalize_record(
            &connection,
            "tasks",
            &json!({"title":"Task","decisionId":"decision-1"}),
            true,
        )
        .unwrap();
        assert_eq!(task["projectId"], "project-1");
        assert_eq!(task["goalId"], "goal-1");
        assert!(normalize_record(
            &connection,
            "tasks",
            &json!({"title":"Wrong Task","projectId":"project-2","decisionId":"decision-1"}),
            true,
        )
        .is_err());

        put(
            &connection,
            "tasks",
            "task-1",
            json!({"title":"Task","projectId":"project-1"}),
        );
        put(
            &connection,
            "results",
            "result-1",
            json!({"title":"Result","taskId":"task-1"}),
        );
        put(
            &connection,
            "reviews",
            "review-1",
            json!({"title":"Review","resultId":"result-1"}),
        );
        let review = record_by_id(&connection, "review-1").unwrap().unwrap();
        assert_eq!(review["taskId"], "task-1");
        assert_eq!(review["projectId"], "project-1");
        assert_eq!(review["goalId"], "goal-1");

        let insight = normalize_record(
            &connection,
            "insights",
            &json!({"statement":"Insight","reviewId":"review-1"}),
            true,
        )
        .unwrap();
        assert_eq!(insight["taskId"], "task-1");
        assert_eq!(insight["projectId"], "project-1");
        assert_eq!(insight["goalId"], "goal-1");
    }

    #[test]
    fn timeline_analysis_mode_is_read_only() {
        assert!(timeline_analysis_is_read_only(
            &json!({"analysisMode":"timeline_readonly"})
        ));
        assert!(!timeline_analysis_is_read_only(
            &json!({"currentRoute":"timeline"})
        ));
    }

    #[test]
    fn external_links_are_limited_to_web_urls() {
        assert!(is_external_url("https://openai.com/news"));
        assert!(is_external_url("http://example.com"));
        assert!(!is_external_url("file:///tmp/private"));
        assert!(!is_external_url("javascript:alert(1)"));
    }

    #[test]
    fn profile_context_is_related_and_length_limited() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE records(id TEXT PRIMARY KEY,entity TEXT NOT NULL,data_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);").unwrap();
        connection.execute(
            "INSERT INTO records(id,entity,data_json,created_at,updated_at) VALUES (?1,'profiles',?2,'1','2')",
            params!["profile-1", json!({"name":"Jason","longTermDirection":"打造 AI 驱动的跨境电商业务体系","workStyle":"先建立完整架构，再执行。","aiAssistancePreference":"主动指出风险。"}).to_string()],
        ).unwrap();
        let related = profile_context_for_question(&connection, "你知道我的长期方向是什么吗？")
            .unwrap()
            .unwrap();
        assert_eq!(related["type"], "PROFILE_CONTEXT");
        assert!(related["content"].as_str().unwrap().contains("跨境电商"));
        assert!(
            profile_context_for_question(&connection, "2 加 2 等于多少？")
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn only_declared_entities_are_accepted() {
        assert!(is_entity("goals"));
        assert!(is_entity("profiles"));
        assert!(!is_entity("drop table records"));
    }
    #[test]
    fn a_title_can_be_derived_from_a_record() {
        let (title, _) = title_body(&json!({"name": "First principle"}));
        assert_eq!(title, "First principle");
    }
    #[test]
    fn generated_ids_do_not_collide_within_the_same_millisecond() {
        assert_ne!(new_id("goals"), new_id("goals"));
    }
    #[test]
    fn current_provider_model_catalog_is_explicit() {
        assert_eq!(
            provider_models("deepseek"),
            &["deepseek-v4-pro", "deepseek-v4-flash"]
        );
        assert_eq!(provider_models("minimax"), &["MiniMax-M3"]);
        assert_eq!(
            provider_base_url("minimax"),
            "https://api.minimaxi.com/anthropic/v1/messages"
        );
        assert_eq!(
            provider_models("volc-agent-plan"),
            &[
                "kimi-k3",
                "deepseek-v4-flash",
                "glm-5.2",
                "minimax-m3",
                "doubao-seed-evolving",
                "kimi-k2.7-code"
            ]
        );
        assert_eq!(
            provider_base_url("volc-agent-plan"),
            "https://ark.cn-beijing.volces.com/api/plan/v3/responses"
        );
    }
    #[test]
    fn relation_fields_are_materialized() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE records(id TEXT PRIMARY KEY, data_json TEXT, deleted_at TEXT); CREATE TABLE relations(id TEXT PRIMARY KEY, from_id TEXT, to_id TEXT, relation_type TEXT, created_at TEXT, UNIQUE(from_id,to_id,relation_type));").unwrap();
        connection
            .execute(
                "INSERT INTO records(id,data_json) VALUES ('project-1','{}'),('task-1','{}')",
                [],
            )
            .unwrap();
        sync_relations(&connection, "task-1", &json!({"projectId":"project-1"})).unwrap();
        let count: i64 = connection.query_row("SELECT COUNT(*) FROM relations WHERE from_id='task-1' AND to_id='project-1' AND relation_type='field:projectId'", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn completed_research_result_snapshot_rejects_evidence_rewrite_but_keeps_user_tags_editable() {
        let existing = json!({"status":"COMPLETED","summary":"original","evidenceUrls":"https://example.com"});
        assert!(validate_research_result_snapshot(&existing, &json!({"summary":"changed"})).is_err());
        assert!(validate_research_result_snapshot(&existing, &json!({"tags":"市场"})).is_ok());
    }

    #[test]
    fn legacy_research_migration_keeps_requests_in_separate_threads_and_preserves_result_text() {
        let connection = relationship_test_db();
        put(&connection, "researchRequests", "request-a", json!({"title":"需求 A","request":"A","status":"COMPLETED"}));
        put(&connection, "researchRequests", "request-b", json!({"title":"需求 B","request":"B","status":"COMPLETED"}));
        put(&connection, "researchResults", "result-a", json!({"title":"结果 A","researchRequestId":"request-a","status":"COMPLETED","summary":"不得改写的旧摘要","researchRunIds":"provider-run-a"}));
        migrate_research_result_architecture(&connection).unwrap();
        let request_a = record_by_id(&connection, "request-a").unwrap().unwrap();
        let request_b = record_by_id(&connection, "request-b").unwrap().unwrap();
        let result = record_by_id(&connection, "result-a").unwrap().unwrap();
        assert_ne!(request_a["researchThreadId"], request_b["researchThreadId"]);
        assert_eq!(result["summary"], "不得改写的旧摘要");
        assert_eq!(result["researchThreadId"], request_a["researchThreadId"]);
        assert!(result["researchRunId"].as_str().unwrap_or("").starts_with("researchRuns-"));
    }

    fn relationship_test_db() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE records(id TEXT PRIMARY KEY,entity TEXT NOT NULL,data_json TEXT NOT NULL,title TEXT NOT NULL DEFAULT '',body TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,archived_at TEXT,deleted_at TEXT); CREATE VIRTUAL TABLE records_fts USING fts5(id UNINDEXED,entity UNINDEXED,title,body); CREATE TABLE relations(id TEXT PRIMARY KEY,from_id TEXT NOT NULL,to_id TEXT NOT NULL,relation_type TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(from_id,to_id,relation_type));").unwrap();
        connection
    }

    fn put(connection: &Connection, entity: &str, id: &str, data: Value) {
        let normalized = normalize_record(connection, entity, &data, true).unwrap();
        write_record(connection, entity, id, &normalized, None).unwrap();
        sync_relations(connection, id, &normalized).unwrap();
    }

    #[test]
    fn batch_record_actions_are_atomic_and_hide_records_from_active_queries() {
        let connection = relationship_test_db();
        put(&connection, "researchRequests", "request-a", json!({"title":"A"}));
        put(&connection, "researchRequests", "request-b", json!({"title":"B"}));

        assert!(apply_record_batch(
            &connection,
            vec!["request-a".into(), "missing".into()],
            delete_record_from_connection,
        )
        .is_err());
        assert!(record_by_id(&connection, "request-a").unwrap().is_some());

        apply_record_batch(
            &connection,
            vec!["request-a".into(), "request-b".into(), "request-a".into()],
            delete_record_from_connection,
        )
        .unwrap();
        assert!(record_by_id(&connection, "request-a").unwrap().is_none());
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM records WHERE deleted_at IS NOT NULL", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            2
        );
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM records_fts", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    fn seed_work_chain(connection: &Connection) {
        put(connection, "goals", "goal-a", json!({"title":"Goal A"}));
        put(connection, "goals", "goal-b", json!({"title":"Goal B"}));
        put(
            connection,
            "projects",
            "project-b",
            json!({"title":"Project B","goalId":"goal-a"}),
        );
        put(
            connection,
            "tasks",
            "task-c",
            json!({"title":"Task C","projectId":"project-b"}),
        );
    }

    #[test]
    fn relationship_test_1_goal_project_task_chain() {
        let connection = relationship_test_db();
        seed_work_chain(&connection);
        let task = record_by_id(&connection, "task-c").unwrap().unwrap();
        assert_eq!(task["projectId"], "project-b");
        assert_eq!(task["goalId"], "goal-a");
    }

    #[test]
    fn relationship_test_2_project_created_from_goal() {
        let connection = relationship_test_db();
        put(&connection, "goals", "goal-a", json!({"title":"A"}));
        put(
            &connection,
            "projects",
            "project-b",
            json!({"title":"B","goalId":"goal-a"}),
        );
        assert_eq!(
            record_by_id(&connection, "project-b").unwrap().unwrap()["goalId"],
            "goal-a"
        );
    }

    #[test]
    fn relationship_test_3_task_created_from_project_inherits_goal() {
        let connection = relationship_test_db();
        seed_work_chain(&connection);
        let task = record_by_id(&connection, "task-c").unwrap().unwrap();
        assert_eq!(task["goalId"], "goal-a");
    }

    #[test]
    fn relationship_test_4_timer_from_task_inherits_project_and_goal() {
        let connection = relationship_test_db();
        seed_work_chain(&connection);
        let timer = normalize_record(
            &connection,
            "timeLogs",
            &json!({"taskId":"task-c","isRunning":true}),
            true,
        )
        .unwrap();
        assert_eq!(timer["taskId"], "task-c");
        assert_eq!(timer["projectId"], "project-b");
        assert_eq!(timer["goalId"], "goal-a");
    }

    #[test]
    fn relationship_test_5_timer_from_project_inherits_goal() {
        let connection = relationship_test_db();
        seed_work_chain(&connection);
        let timer = normalize_record(
            &connection,
            "timeLogs",
            &json!({"projectId":"project-b"}),
            true,
        )
        .unwrap();
        assert_eq!(timer["projectId"], "project-b");
        assert_eq!(timer["goalId"], "goal-a");
    }

    #[test]
    fn relationship_test_6_timer_from_goal_is_valid() {
        let connection = relationship_test_db();
        put(&connection, "goals", "goal-a", json!({"title":"A"}));
        let timer =
            normalize_record(&connection, "timeLogs", &json!({"goalId":"goal-a"}), true).unwrap();
        assert_eq!(timer["goalId"], "goal-a");
    }

    #[test]
    fn relationship_test_7_independent_timer_is_allowed() {
        let connection = relationship_test_db();
        let timer = normalize_record(
            &connection,
            "timeLogs",
            &json!({"title":"Independent"}),
            true,
        )
        .unwrap();
        assert!(timer.get("taskId").is_none());
        assert!(timer.get("projectId").is_none());
        assert!(timer.get("goalId").is_none());
    }

    #[test]
    fn relationship_test_8_project_goal_change_cascades_to_tasks() {
        let connection = relationship_test_db();
        seed_work_chain(&connection);
        put(
            &connection,
            "projects",
            "project-b",
            json!({"title":"B","goalId":"goal-b"}),
        );
        cascade_context(&connection, "projects", "project-b").unwrap();
        assert_eq!(
            record_by_id(&connection, "task-c").unwrap().unwrap()["goalId"],
            "goal-b"
        );
    }

    #[test]
    fn relationship_test_9_goal_aggregates_project_task_and_time() {
        let connection = relationship_test_db();
        seed_work_chain(&connection);
        put(
            &connection,
            "timeLogs",
            "time-1",
            json!({"taskId":"task-c","durationMinutes":30}),
        );
        let records = all_records(&connection).unwrap();
        assert_eq!(
            records
                .iter()
                .filter(|record| record["goalId"] == "goal-a")
                .count(),
            3
        );
    }

    #[test]
    fn relationship_test_10_project_aggregates_tasks_and_time() {
        let connection = relationship_test_db();
        seed_work_chain(&connection);
        put(
            &connection,
            "timeLogs",
            "time-1",
            json!({"taskId":"task-c","durationMinutes":30}),
        );
        let records = all_records(&connection).unwrap();
        assert_eq!(
            records
                .iter()
                .filter(|record| record["projectId"] == "project-b")
                .count(),
            2
        );
    }

    #[test]
    fn relationship_test_11_task_aggregates_time_and_result() {
        let connection = relationship_test_db();
        seed_work_chain(&connection);
        put(
            &connection,
            "timeLogs",
            "time-1",
            json!({"taskId":"task-c"}),
        );
        put(
            &connection,
            "results",
            "result-1",
            json!({"taskId":"task-c","title":"Result"}),
        );
        let records = all_records(&connection).unwrap();
        assert_eq!(
            records
                .iter()
                .filter(|record| record["taskId"] == "task-c")
                .count(),
            2
        );
    }

    #[test]
    fn relationship_test_12_mismatched_task_goal_is_auto_corrected() {
        let connection = relationship_test_db();
        seed_work_chain(&connection);
        let task = normalize_record(
            &connection,
            "tasks",
            &json!({"projectId":"project-b","goalId":"goal-b"}),
            true,
        )
        .unwrap();
        assert_eq!(task["goalId"], "goal-a");
    }

    #[test]
    fn capture_platforms_are_detected() {
        assert_eq!(
            capture_platform("https://mp.weixin.qq.com/s/a"),
            "微信公众号"
        );
        assert_eq!(capture_platform("https://www.douyin.com/video/1"), "抖音");
        assert_eq!(
            capture_platform("https://www.xiaohongshu.com/explore/1"),
            "小红书"
        );
        assert_eq!(capture_platform("https://x.com/openai/status/1"), "X");
        assert_eq!(
            capture_platform("https://www.instagram.com/p/1"),
            "Instagram"
        );
        assert_eq!(
            capture_platform("https://www.reddit.com/r/rust/1"),
            "Reddit"
        );
        assert_eq!(
            capture_platform("https://www.facebook.com/watch/1"),
            "Facebook"
        );
    }

    #[test]
    fn sync_v1_migration_is_idempotent_and_outbox_is_atomic() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL); CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE records(id TEXT PRIMARY KEY,entity TEXT NOT NULL,data_json TEXT NOT NULL,title TEXT NOT NULL DEFAULT '',body TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,archived_at TEXT,deleted_at TEXT); CREATE VIRTUAL TABLE records_fts USING fts5(id UNINDEXED,entity UNINDEXED,title,body); CREATE TABLE relations(id TEXT PRIMARY KEY,from_id TEXT NOT NULL,to_id TEXT NOT NULL,relation_type TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(from_id,to_id,relation_type));").unwrap();
        migrate_sync_v1(&connection).unwrap();
        migrate_sync_v1(&connection).unwrap();
        connection.execute_batch("BEGIN IMMEDIATE; INSERT INTO records(id,entity,data_json,created_at,updated_at) VALUES('task-rollback','tasks','{}','1','1'); ROLLBACK;").unwrap();
        let rolled_back: i64 = connection.query_row("SELECT COUNT(*) FROM sync_outbox", [], |row| row.get(0)).unwrap();
        assert_eq!(rolled_back, 0);
        connection.execute("INSERT INTO records(id,entity,data_json,created_at,updated_at) VALUES('task-1','tasks','{\"title\":\"A\"}','1','1')", []).unwrap();
        let created: (String, i64) = connection.query_row("SELECT operation,base_revision FROM sync_outbox", [], |row| Ok((row.get(0)?,row.get(1)?))).unwrap();
        assert_eq!(created, ("CREATE".into(), 0));
        connection.execute("UPDATE records SET data_json='{\"title\":\"B\"}' WHERE id='task-1'", []).unwrap();
        let revision: i64 = connection.query_row("SELECT revision FROM records WHERE id='task-1'", [], |row| row.get(0)).unwrap();
        assert_eq!(revision, 2);
        let updates: i64 = connection.query_row("SELECT COUNT(*) FROM sync_outbox WHERE operation='UPDATE'", [], |row| row.get(0)).unwrap();
        assert_eq!(updates, 1);
    }

    #[test]
    fn notebook_category_migration_repairs_legacy_references_and_sets_schema_18() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL); CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE records(id TEXT PRIMARY KEY,entity TEXT NOT NULL,data_json TEXT NOT NULL,title TEXT NOT NULL DEFAULT '',body TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,archived_at TEXT,deleted_at TEXT); CREATE VIRTUAL TABLE records_fts USING fts5(id UNINDEXED,entity UNINDEXED,title,body); CREATE TABLE relations(id TEXT PRIMARY KEY,from_id TEXT NOT NULL,to_id TEXT NOT NULL,relation_type TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(from_id,to_id,relation_type));").unwrap();
        migrate_sync_v1(&connection).unwrap();
        connection.execute("INSERT INTO records(id,entity,data_json,created_at,updated_at) VALUES('category-live','notebookCategories','{\"name\":\"内容灵感\"}','1','1')", []).unwrap();
        connection.execute("INSERT INTO records(id,entity,data_json,created_at,updated_at) VALUES('note-legacy','notes','{\"title\":\"旧笔记\",\"notebookCategoryId\":\"category-missing\"}','1','1')", []).unwrap();
        migrate_notebook_category_ownership(&connection).unwrap();
        migrate_notebook_category_ownership(&connection).unwrap();

        let schema: i64 = connection.query_row("SELECT MAX(version) FROM schema_migrations", [], |row| row.get(0)).unwrap();
        let sync_schema: i64 = connection.query_row("SELECT schema_version FROM sync_state WHERE workspace_id='local'", [], |row| row.get(0)).unwrap();
        let index_exists: i64 = connection.query_row("SELECT COUNT(*) FROM pragma_index_list('records') WHERE name='idx_records_notebook_category_active'", [], |row| row.get(0)).unwrap();
        assert_eq!(schema, SCHEMA_VERSION);
        assert_eq!(sync_schema, SCHEMA_VERSION);
        assert_eq!(index_exists, 1);
        assert!(record_by_id(&connection, "note-legacy").unwrap().unwrap().get("notebookCategoryId").is_none());
    }

    #[test]
    fn notebook_category_queries_remain_fast_with_5000_records() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL); CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE records(id TEXT PRIMARY KEY,entity TEXT NOT NULL,data_json TEXT NOT NULL,title TEXT NOT NULL DEFAULT '',body TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,archived_at TEXT,deleted_at TEXT); CREATE TABLE relations(id TEXT PRIMARY KEY,from_id TEXT NOT NULL,to_id TEXT NOT NULL,relation_type TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(from_id,to_id,relation_type));").unwrap();
        migrate_sync_v1(&connection).unwrap();
        migrate_notebook_category_ownership(&connection).unwrap();
        connection.execute("INSERT INTO settings(key,value,updated_at) VALUES('sync.apply_mode','1','1')", []).unwrap();
        let transaction = connection.unchecked_transaction().unwrap();
        for index in 0..5_000 {
            let category = if index % 2 == 0 { "{\"notebookCategoryId\":\"category-a\"}" } else { "{}" };
            transaction.execute("INSERT INTO records(id,entity,data_json,created_at,updated_at) VALUES(?1,'notes',?2,'1','1')", params![format!("note-{index}"), category]).unwrap();
        }
        transaction.commit().unwrap();

        let started = std::time::Instant::now();
        let categorized: i64 = connection.query_row("SELECT COUNT(*) FROM records WHERE entity IN ('notes','notebookFiles','inbox') AND archived_at IS NULL AND deleted_at IS NULL AND json_extract(data_json,'$.notebookCategoryId')='category-a'", [], |row| row.get(0)).unwrap();
        let unorganized: i64 = connection.query_row("SELECT COUNT(*) FROM records WHERE entity IN ('notes','notebookFiles','inbox') AND archived_at IS NULL AND deleted_at IS NULL AND (json_extract(data_json,'$.notebookCategoryId') IS NULL OR json_extract(data_json,'$.notebookCategoryId')='')", [], |row| row.get(0)).unwrap();
        assert_eq!((categorized, unorganized), (2_500, 2_500));
        assert!(started.elapsed() < std::time::Duration::from_millis(500));
    }

    #[test]
    fn note_autosaves_keep_only_the_latest_pending_update() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL); CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE records(id TEXT PRIMARY KEY,entity TEXT NOT NULL,data_json TEXT NOT NULL,title TEXT NOT NULL DEFAULT '',body TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,archived_at TEXT,deleted_at TEXT); CREATE TABLE relations(id TEXT PRIMARY KEY,from_id TEXT NOT NULL,to_id TEXT NOT NULL,relation_type TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(from_id,to_id,relation_type));").unwrap();
        migrate_sync_v1(&connection).unwrap();
        connection.execute("INSERT INTO records(id,entity,data_json,created_at,updated_at) VALUES('note-1','notes','{\"content\":\"\"}','1','1')", []).unwrap();
        for content in ["A", "AB", "ABC"] {
            connection.execute("UPDATE records SET data_json=?1 WHERE id='note-1'", params![format!("{{\"content\":\"{content}\"}}")]).unwrap();
            coalesce_pending_note_updates(&connection, "note-1").unwrap();
        }
        let creates: i64 = connection.query_row("SELECT COUNT(*) FROM sync_outbox WHERE entity_id='note-1' AND operation='CREATE'", [], |row| row.get(0)).unwrap();
        let updates: i64 = connection.query_row("SELECT COUNT(*) FROM sync_outbox WHERE entity_id='note-1' AND operation='UPDATE'", [], |row| row.get(0)).unwrap();
        let payload: String = connection.query_row("SELECT payload_json FROM sync_outbox WHERE entity_id='note-1' AND operation='UPDATE'", [], |row| row.get(0)).unwrap();
        assert_eq!(creates, 1);
        assert_eq!(updates, 1);
        assert!(payload.contains("ABC"));
    }

    #[test]
    fn notebook_category_repair_keeps_valid_ownership_and_clears_dangling_references() {
        let connection = relationship_test_db();
        put(&connection, "notebookCategories", "category-live", json!({"name":"大码女装"}));
        put(&connection, "notes", "note-live", json!({"title":"保留分类","status":"INBOX","notebookCategoryId":"category-live"}));
        write_record(&connection, "inbox", "inbox-orphan", &json!({"title":"孤儿分类","notebookCategoryId":"category-deleted"}), None).unwrap();

        assert_eq!(repair_notebook_category_references(&connection).unwrap(), 1);
        assert_eq!(record_by_id(&connection, "note-live").unwrap().unwrap()["notebookCategoryId"], "category-live");
        assert!(record_by_id(&connection, "inbox-orphan").unwrap().unwrap().get("notebookCategoryId").is_none());
    }

    #[test]
    fn deleting_notebook_category_moves_contents_to_unorganized_without_deleting_them() {
        let connection = relationship_test_db();
        put(&connection, "notebookCategories", "category-a", json!({"name":"大码女装"}));
        put(&connection, "notes", "note-a", json!({"title":"保留正文","content":"正文","status":"INBOX","notebookCategoryId":"category-a"}));
        put(&connection, "notebookFiles", "file-a", json!({"name":"保留文件.pdf","notebookCategoryId":"category-a"}));

        delete_record_from_connection(&connection, "category-a").unwrap();

        assert!(record_by_id(&connection, "category-a").unwrap().is_none());
        let note = record_by_id(&connection, "note-a").unwrap().unwrap();
        let file = record_by_id(&connection, "file-a").unwrap().unwrap();
        assert_eq!(note["content"], "正文");
        assert!(note.get("notebookCategoryId").is_none());
        assert!(file.get("notebookCategoryId").is_none());
    }

    #[test]
    fn archiving_notebook_content_preserves_its_category_ownership() {
        let connection = relationship_test_db();
        put(&connection, "notebookCategories", "category-a", json!({"name":"大码女装"}));
        put(&connection, "notes", "note-a", json!({"title":"归档后仍属于分类","notebookCategoryId":"category-a"}));

        archive_record_from_connection(&connection, "note-a").unwrap();

        let note = record_by_id(&connection, "note-a").unwrap().unwrap();
        assert_eq!(note["notebookCategoryId"], "category-a");
        assert!(note["archivedAt"].is_string());
    }

    #[test]
    fn unsafe_note_image_references_become_missing_asset_nodes() {
        for (source, expected_type) in [
            ("blob:tauri://localhost/id", "blob"),
            ("file:///tmp/image.png", "temporary-file"),
            ("file:///var/folders/a.png", "temporary-file"),
            ("http://localhost:5173/a.png", "localhost"),
            ("https://files.test/a?X-Amz-Signature=secret", "presigned-url"),
        ] {
            let original = format!("<p>正文</p><img src=\"{source}\">");
            let (safe, count) = repair_unsafe_note_image_html(&original);
            assert_eq!(count, 1);
            assert!(!safe.contains(source));
            assert!(safe.contains("data-jason-missing-asset=\"true\""));
            assert!(safe.contains(&format!("data-jason-original-reference-type=\"{expected_type}\"")));
            assert!(safe.contains("正文"));
        }
    }

    #[test]
    fn referenced_notebook_file_counts_all_business_references() {
        let connection = relationship_test_db();
        put(&connection, "notebookFiles", "file-a", json!({"name":"a.png"}));
        put(&connection, "notes", "note-a", json!({"title":"A","fileIds":["file-a"],"contentHtml":"<img src=\"jason-file://file-a\" data-jason-file-id=\"file-a\">"}));
        put(&connection, "knowledge", "knowledge-a", json!({"title":"K","fileId":"file-a"}));
        assert_eq!(notebook_file_reference_count(&connection, "file-a").unwrap(), 2);
        connection.execute("UPDATE records SET deleted_at='1' WHERE id='note-a'", []).unwrap();
        assert_eq!(notebook_file_reference_count(&connection, "file-a").unwrap(), 1);
    }

    #[test]
    fn referenced_notebook_file_cannot_be_soft_deleted_and_legacy_tombstone_is_restored() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL); CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE records(id TEXT PRIMARY KEY,entity TEXT NOT NULL,data_json TEXT NOT NULL,title TEXT NOT NULL DEFAULT '',body TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,archived_at TEXT,deleted_at TEXT); CREATE VIRTUAL TABLE records_fts USING fts5(id UNINDEXED,entity UNINDEXED,title,body); CREATE TABLE relations(id TEXT PRIMARY KEY,from_id TEXT NOT NULL,to_id TEXT NOT NULL,relation_type TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(from_id,to_id,relation_type));").unwrap();
        migrate_sync_v1(&connection).unwrap();
        put(&connection, "notebookFiles", "file-a", json!({"name":"a.png"}));
        put(&connection, "notes", "note-a", json!({"title":"A","fileIds":["file-a"],"contentHtml":"<img src=\"jason-file://file-a\" data-jason-file-id=\"file-a\">"}));

        assert!(delete_record_from_connection(&connection, "file-a").is_err());
        connection.execute("UPDATE records SET deleted_at='1',data_json=json_set(data_json,'$.deletedAt','1') WHERE id='file-a'", []).unwrap();

        assert_eq!(repair_referenced_notebook_file_tombstones(&connection).unwrap(), 1);
        let restored = record_by_id(&connection, "file-a").unwrap().unwrap();
        assert!(restored.get("deletedAt").is_none());
        assert_eq!(restored["id"], "file-a");
        let pending_deletes: i64 = connection.query_row("SELECT COUNT(*) FROM sync_outbox WHERE entity_id='file-a' AND operation='DELETE'", [], |row| row.get(0)).unwrap();
        assert_eq!(pending_deletes, 0);
    }

    #[test]
    fn task_blocked_since_is_set_once_and_cleared_when_unblocked() {
        let mut blocked = json!({"status":"blocked"});
        apply_task_execution_fields(&mut blocked, None, "2026-09-06T10:00:00Z");
        assert_eq!(blocked["blockedSince"], "2026-09-06T10:00:00Z");

        let mut still_blocked = json!({"status":"blocked"});
        apply_task_execution_fields(&mut still_blocked, Some(&blocked), "2026-09-07T10:00:00Z");
        assert_eq!(still_blocked["blockedSince"], "2026-09-06T10:00:00Z");

        let mut unblocked = json!({"status":"todo", "blockedSince":"2026-09-06T10:00:00Z"});
        apply_task_execution_fields(&mut unblocked, Some(&still_blocked), "2026-09-08T10:00:00Z");
        assert!(unblocked.get("blockedSince").is_none());
    }

    #[test]
    #[ignore = "requires the user's configured TikHub credential and network access"]
    fn live_tikhub_search_normalizes_and_persists_evidence() {
        let search = tikhub::search_videos(&tikhub_key().expect("TikHub must be configured"), "plus size fashion", 30)
            .expect("TikHub VIDEO_SEARCH should return a response");
        assert!(!search.items.is_empty(), "TikHub returned no normalized items");

        let connection = Connection::open_in_memory().expect("open test database");
        connection
            .execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);")
            .expect("create migration table");
        external_intelligence::migrate(&connection, "1").expect("migrate external intelligence tables");
        external_intelligence::start_research_run(
            &connection,
            "live-run",
            Some("live-request"),
            "tiktok-video-search",
            "TikTok",
            "VIDEO_SEARCH",
            "tikhub",
            &[],
            "100",
        )
        .expect("start research run");

        let mut item_ids = Vec::new();
        for (index, item) in search.items.iter().enumerate() {
            let item_id = external_intelligence::upsert_item(
                &connection,
                &format!("live-item-{index}"),
                item,
                "100",
                "200",
                "test-fixture://jason-os-live-tikhub.json",
            )
            .expect("upsert normalized item");
            external_intelligence::attach_research_evidence(
                &connection,
                &format!("live-evidence-{index}"),
                "live-run",
                &item_id,
                "tikhub",
                &search.endpoint,
                item.get("canonicalUrl").and_then(Value::as_str).unwrap_or(""),
                "100",
            )
            .expect("attach evidence");
            item_ids.push(item_id);
        }
        external_intelligence::finish_research_run(&connection, "live-run", "COMPLETED", false, "101", None)
            .expect("finish research run");
        assert_eq!(
            external_intelligence::research_evidence_count(&connection, "live-run").unwrap(),
            item_ids.len() as i64
        );
    }
}
