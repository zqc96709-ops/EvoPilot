use rusqlite::{params, Connection};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

pub fn migrate(connection: &Connection, applied_at: &str) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_finance_transaction_date
               ON records(entity, json_extract(data_json,'$.occurredAt'))
               WHERE entity='financialTransactions';
             CREATE INDEX IF NOT EXISTS idx_finance_transaction_account
               ON records(entity, json_extract(data_json,'$.accountId'))
               WHERE entity='financialTransactions';
             CREATE INDEX IF NOT EXISTS idx_finance_transaction_project
               ON records(entity, json_extract(data_json,'$.projectId'))
               WHERE entity='financialTransactions';
             CREATE INDEX IF NOT EXISTS idx_outcome_project
               ON records(entity, json_extract(data_json,'$.projectId'))
               WHERE entity='results';",
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES('base_currency','CNY',?1)",
            params![applied_at],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(8,?1)",
            params![applied_at],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn migrate_allocations(connection: &Connection, applied_at: &str) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_finance_allocation_transaction
               ON records(entity, json_extract(data_json,'$.transactionId'))
               WHERE entity='financialTransactionAllocations';
             CREATE INDEX IF NOT EXISTS idx_finance_allocation_project
               ON records(entity, json_extract(data_json,'$.projectId'))
               WHERE entity='financialTransactionAllocations';",
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(14,?1)",
            params![applied_at],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn migrate_budgets(connection: &Connection, applied_at: &str) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_finance_budget_project
               ON records(entity, json_extract(data_json,'$.projectId'))
               WHERE entity='financialBudgets';
             CREATE INDEX IF NOT EXISTS idx_finance_budget_category
               ON records(entity, json_extract(data_json,'$.categoryId'))
               WHERE entity='financialBudgets';
             CREATE INDEX IF NOT EXISTS idx_finance_budget_period
               ON records(entity, json_extract(data_json,'$.periodStart'), json_extract(data_json,'$.periodEnd'))
               WHERE entity='financialBudgets';",
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(15,?1)",
            params![applied_at],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn string(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string()
}

fn parse_integer(value: &Value, key: &str) -> Result<Option<i128>, String> {
    let raw = string(value, key);
    if raw.is_empty() {
        return Ok(None);
    }
    raw.parse::<i128>()
        .map(Some)
        .map_err(|_| format!("{key} 必须使用最小货币单位的整数保存"))
}

fn parse_decimal(value: &Value, key: &str) -> Result<Option<i128>, String> {
    let raw = string(value, key).replace(',', "");
    if raw.is_empty() {
        return Ok(None);
    }
    let negative = raw.starts_with('-');
    let raw = raw.trim_start_matches('-');
    let mut parts = raw.split('.');
    let whole = parts.next().unwrap_or("");
    let fraction = parts.next().unwrap_or("");
    if parts.next().is_some()
        || whole.is_empty()
        || !whole.chars().all(|value| value.is_ascii_digit())
        || !fraction.chars().all(|value| value.is_ascii_digit())
    {
        return Err(format!("{key} 必须是有效十进制数"));
    }
    let fraction = format!("{fraction:0<4}");
    let fraction = &fraction[..4.min(fraction.len())];
    let mut scaled = whole
        .parse::<i128>()
        .map_err(|_| format!("{key} 超出支持范围"))?
        * 10_000
        + fraction.parse::<i128>().unwrap_or(0);
    if negative {
        scaled = -scaled;
    }
    Ok(Some(scaled))
}

fn format_decimal(value: i128) -> String {
    let negative = value < 0;
    let value = value.abs();
    let whole = value / 10_000;
    let fraction = format!("{:04}", value % 10_000)
        .trim_end_matches('0')
        .to_string();
    format!(
        "{}{}{}",
        if negative { "-" } else { "" },
        whole,
        if fraction.is_empty() {
            String::new()
        } else {
            format!(".{fraction}")
        }
    )
}

fn insert_string(object: &mut Map<String, Value>, key: &str, value: impl ToString) {
    object.insert(key.into(), Value::String(value.to_string()));
}

pub fn normalize(entity: &str, data: &mut Value) -> Result<(), String> {
    let object = data.as_object_mut().ok_or("记录必须是结构化对象")?;
    match entity {
        "results" => {
            object
                .entry("outcomeType")
                .or_insert_with(|| Value::String("QUALITATIVE".into()));
            object
                .entry("status")
                .or_insert_with(|| Value::String("PLANNED".into()));
            object
                .entry("evidenceStatus")
                .or_insert_with(|| Value::String("RECORDED".into()));
            let snapshot = Value::Object(object.clone());
            if let (Some(target), Some(actual)) = (
                parse_integer(&snapshot, "targetAmountMinor")?,
                parse_integer(&snapshot, "actualAmountMinor")?,
            ) {
                insert_string(object, "varianceAmountMinor", actual - target);
                if target != 0 {
                    insert_string(object, "achievementBps", actual * 10_000 / target);
                } else {
                    object.remove("achievementBps");
                }
            }
            if let (Some(target), Some(actual)) = (
                parse_decimal(&snapshot, "targetValue")?,
                parse_decimal(&snapshot, "actualValue")?,
            ) {
                insert_string(object, "varianceValue", format_decimal(actual - target));
                if target != 0 {
                    insert_string(object, "achievementBps", actual * 10_000 / target);
                }
            }
        }
        "decisions" => {
            let snapshot = Value::Object(object.clone());
            for key in [
                "expectedRevenueMinor",
                "expectedCostMinor",
                "actualRevenueMinor",
                "actualCostMinor",
            ] {
                parse_integer(&snapshot, key)?;
            }
            if ["MATERIAL", "STRATEGIC"].contains(&string(&snapshot, "decisionLevel").as_str())
                && string(&snapshot, "expectedOutcome").is_empty()
            {
                return Err("重要或战略决策必须写明预期结果，才能在未来校准判断".into());
            }
        }
        "financialAccounts" => {
            object
                .entry("currency")
                .or_insert_with(|| Value::String("CNY".into()));
            object
                .entry("status")
                .or_insert_with(|| Value::String("ACTIVE".into()));
            object
                .entry("evidenceStatus")
                .or_insert_with(|| Value::String("RECORDED".into()));
            let snapshot = Value::Object(object.clone());
            parse_integer(&snapshot, "openingBalanceMinor")?;
        }
        "financialCategories" => {
            object
                .entry("status")
                .or_insert_with(|| Value::String("ACTIVE".into()));
        }
        "financialTransactions" => {
            object
                .entry("status")
                .or_insert_with(|| Value::String("POSTED".into()));
            object
                .entry("currency")
                .or_insert_with(|| Value::String("CNY".into()));
            object
                .entry("baseCurrency")
                .or_insert_with(|| Value::String("CNY".into()));
            object
                .entry("evidenceStatus")
                .or_insert_with(|| Value::String("RECORDED".into()));
            let snapshot = Value::Object(object.clone());
            let amount = parse_integer(&snapshot, "amountMinor")?.ok_or("财务流水必须填写金额")?;
            if amount <= 0 {
                return Err("收入、支出、转账、退款和调整的金额必须使用正数".into());
            }
            let currency = string(&snapshot, "currency");
            let base_currency = string(&snapshot, "baseCurrency");
            if currency == base_currency && string(&snapshot, "baseAmountMinor").is_empty() {
                insert_string(object, "baseAmountMinor", amount);
            }
            let snapshot = Value::Object(object.clone());
            let base_amount =
                parse_integer(&snapshot, "baseAmountMinor")?.ok_or("外币交易必须填写基础币金额")?;
            if base_amount <= 0 {
                return Err("基础币金额必须大于零".into());
            }
            let transaction_type = string(&snapshot, "transactionType");
            if !["INCOME", "EXPENSE", "TRANSFER", "REFUND", "ADJUSTMENT"]
                .contains(&transaction_type.as_str())
            {
                return Err("请选择有效的交易类型".into());
            }
            if transaction_type == "TRANSFER"
                && (string(&snapshot, "accountId").is_empty()
                    || string(&snapshot, "destinationAccountId").is_empty())
            {
                return Err("转账必须同时选择来源账户和目标账户".into());
            }
            if transaction_type == "REFUND" && string(&snapshot, "refundKind").is_empty() {
                return Err("退款必须说明是费用退款还是收入退款".into());
            }
            if transaction_type == "ADJUSTMENT"
                && string(&snapshot, "adjustmentDirection").is_empty()
            {
                return Err("余额调整必须选择增加或减少".into());
            }
        }
        "financialTransactionAllocations" => {
            object
                .entry("title")
                .or_insert_with(|| Value::String("项目分摊".into()));
            let snapshot = Value::Object(object.clone());
            if string(&snapshot, "transactionId").is_empty() {
                return Err("项目分摊必须选择财务流水".into());
            }
            if string(&snapshot, "projectId").is_empty() {
                return Err("项目分摊必须选择项目".into());
            }
            let amount = parse_integer(&snapshot, "amountMinor")?.ok_or("项目分摊必须填写基础币金额")?;
            if amount <= 0 {
                return Err("项目分摊金额必须大于零".into());
            }
        }
        "financialBudgets" => {
            object
                .entry("baseCurrency")
                .or_insert_with(|| Value::String("CNY".into()));
            object
                .entry("status")
                .or_insert_with(|| Value::String("ACTIVE".into()));
            let snapshot = Value::Object(object.clone());
            if string(&snapshot, "title").is_empty() {
                return Err("预算必须填写名称".into());
            }
            let amount = parse_integer(&snapshot, "amountMinor")?.ok_or("预算必须填写基础币金额")?;
            if amount <= 0 {
                return Err("预算金额必须大于零".into());
            }
            let start = string(&snapshot, "periodStart");
            let end = string(&snapshot, "periodEnd");
            if start.is_empty() || end.is_empty() {
                return Err("预算必须填写开始和结束日期".into());
            }
            if start > end {
                return Err("预算结束日期不能早于开始日期".into());
            }
        }
        _ => {}
    }
    Ok(())
}

pub fn validate_allocation(
    connection: &Connection,
    entity: &str,
    allocation_id: &str,
    allocation: &Value,
) -> Result<(), String> {
    if entity != "financialTransactionAllocations" {
        return Ok(());
    }
    let transaction_id = string(allocation, "transactionId");
    let transaction_raw: String = connection
        .query_row(
            "SELECT data_json FROM records WHERE id=?1 AND entity='financialTransactions' AND archived_at IS NULL AND deleted_at IS NULL",
            params![transaction_id],
            |row| row.get(0),
        )
        .map_err(|_| "项目分摊关联的财务流水不存在".to_string())?;
    let transaction = serde_json::from_str::<Value>(&transaction_raw)
        .map_err(|_| "项目分摊关联的财务流水数据无效".to_string())?;
    if transaction.get("status").and_then(Value::as_str).unwrap_or("POSTED") == "VOIDED" {
        return Err("不能为已作废财务流水创建项目分摊".into());
    }
    if ["TRANSFER", "ADJUSTMENT"].contains(&string(&transaction, "transactionType").as_str()) {
        return Err("转账和余额调整不能分摊到项目".into());
    }
    let transaction_amount = parse_integer(&transaction, "baseAmountMinor")?
        .or(parse_integer(&transaction, "amountMinor")?)
        .unwrap_or(0);
    let allocation_amount = parse_integer(allocation, "amountMinor")?.unwrap_or(0);
    let mut statement = connection
        .prepare(
            "SELECT data_json FROM records
             WHERE entity='financialTransactionAllocations' AND archived_at IS NULL AND deleted_at IS NULL
               AND id<>?1 AND json_extract(data_json,'$.transactionId')=?2",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![allocation_id, transaction_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    let mut allocated = allocation_amount;
    for row in rows {
        let raw = row.map_err(|error| error.to_string())?;
        let existing = serde_json::from_str::<Value>(&raw).unwrap_or_else(|_| json!({}));
        allocated += parse_integer(&existing, "amountMinor")?.unwrap_or(0);
    }
    if allocated > transaction_amount {
        return Err("项目分摊合计不能超过财务流水基础币金额".into());
    }
    Ok(())
}

pub fn validate_transition(
    entity: &str,
    existing: Option<&Value>,
    after: &Value,
) -> Result<(), String> {
    if entity != "financialTransactions" {
        return Ok(());
    }
    let Some(before) = existing else {
        return Ok(());
    };
    if before.get("status").and_then(Value::as_str) != Some("POSTED") {
        return Ok(());
    }
    if after.get("status").and_then(Value::as_str) == Some("VOIDED") {
        if string(after, "voidReason").is_empty() {
            return Err("作废已入账流水必须填写原因".into());
        }
        return Ok(());
    }
    for key in [
        "transactionType",
        "amountMinor",
        "currency",
        "baseCurrency",
        "baseAmountMinor",
        "accountId",
        "destinationAccountId",
        "occurredAt",
    ] {
        if before.get(key) != after.get(key) {
            return Err("已入账流水的核心事实不能直接修改；请作废后创建更正流水".into());
        }
    }
    Ok(())
}

pub fn freeze_decision_snapshot(
    connection: &Connection,
    data: &mut Value,
    captured_at: &str,
) -> Result<(), String> {
    let level = string(data, "decisionLevel");
    if !["MATERIAL", "STRATEGIC"].contains(&level.as_str())
        || !string(data, "evidenceSnapshot").is_empty()
    {
        return Ok(());
    }
    let project_id = string(data, "projectId");
    if project_id.is_empty() {
        return Err("重要或战略决策必须关联真实项目，才能冻结决策时证据".into());
    }
    let evidence = summary(connection, Some(&project_id))?;
    let object = data.as_object_mut().ok_or("决策必须是结构化对象")?;
    object.insert(
        "evidenceSnapshot".into(),
        Value::String(serde_json::to_string_pretty(&evidence).map_err(|error| error.to_string())?),
    );
    object.insert(
        "evidenceSnapshotAt".into(),
        Value::String(captured_at.into()),
    );
    object.insert("dataCoverage".into(), evidence["dataCoverage"].clone());
    if evidence["dataCoverage"].as_i64().unwrap_or(0) < 100
        && string(&Value::Object(object.clone()), "knownUnknowns").is_empty()
    {
        object.insert(
            "knownUnknowns".into(),
            Value::String("部分财务、时间或 Outcome 尚未完整核验。".into()),
        );
    }
    Ok(())
}

pub fn summary(connection: &Connection, project_id: Option<&str>) -> Result<Value, String> {
    let mut statement = connection.prepare(
        "SELECT id,entity,data_json FROM records WHERE archived_at IS NULL AND deleted_at IS NULL AND entity IN ('financialTransactions','financialTransactionAllocations','results','timeLogs','tasks')"
    ).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        })
        .map_err(|error| error.to_string())?;
    let mut records = Vec::new();
    for row in rows {
        let (id, entity, raw) = row.map_err(|error| error.to_string())?;
        records.push((id, entity, serde_json::from_str::<Value>(&raw).unwrap_or_else(|_| json!({}))));
    }
    let mut allocations: HashMap<String, Vec<Value>> = HashMap::new();
    let mut task_projects: HashMap<String, String> = HashMap::new();
    for (id, entity, data) in &records {
        if entity == "financialTransactionAllocations" {
            let transaction_id = string(data, "transactionId");
            if !transaction_id.is_empty() {
                allocations.entry(transaction_id).or_default().push(data.clone());
            }
        }
        if entity == "tasks" {
            let task_project = string(data, "projectId");
            if !id.is_empty() && !task_project.is_empty() {
                task_projects.insert(id.clone(), task_project);
            }
        }
    }
    let belongs_to_project = |data: &Value, expected: &str| {
        string(data, "projectId") == expected
            || task_projects
                .get(&string(data, "taskId"))
                .map(String::as_str)
                == Some(expected)
    };
    let mut income = 0i128;
    let mut expense = 0i128;
    let mut cash_net = 0i128;
    let mut minutes = 0i64;
    let mut transaction_count = 0i64;
    let mut outcome_count = 0i64;
    let mut verified_outcomes = 0i64;
    for (id, entity, data) in records {
        match entity.as_str() {
            "financialTransactions"
                if data
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("POSTED")
                    == "POSTED" =>
            {
                let total_amount = parse_integer(&data, "baseAmountMinor")?
                    .or(parse_integer(&data, "amountMinor")?)
                    .unwrap_or(0);
                let amount = if let Some(project_id) = project_id {
                    let splits = allocations.get(&id);
                    if let Some(splits) = splits.filter(|splits| !splits.is_empty()) {
                        splits.iter().filter(|allocation| string(allocation, "projectId") == project_id).try_fold(0i128, |total, allocation| Ok::<i128, String>(total + parse_integer(allocation, "amountMinor")?.unwrap_or(0)))?
                    } else if belongs_to_project(&data, project_id) {
                        total_amount
                    } else {
                        0
                    }
                } else {
                    total_amount
                };
                if amount <= 0 {
                    continue;
                }
                transaction_count += 1;
                match string(&data, "transactionType").as_str() {
                    "INCOME" => {
                        income += amount;
                        cash_net += amount;
                    }
                    "EXPENSE" => {
                        expense += amount;
                        cash_net -= amount;
                    }
                    "REFUND" if string(&data, "refundKind") == "INCOME_REFUND" => {
                        income -= amount;
                        cash_net -= amount;
                    }
                    "REFUND" => {
                        expense -= amount;
                        cash_net += amount;
                    }
                    "ADJUSTMENT" if string(&data, "adjustmentDirection") == "DECREASE" => {
                        cash_net -= amount
                    }
                    "ADJUSTMENT" => cash_net += amount,
                    _ => {}
                }
            }
            "timeLogs" if project_id.map(|id| belongs_to_project(&data, id)).unwrap_or(true) => {
                minutes += data
                    .get("durationMinutes")
                    .and_then(Value::as_i64)
                    .unwrap_or(0)
            }
            "results" if project_id.map(|id| belongs_to_project(&data, id)).unwrap_or(true) => {
                outcome_count += 1;
                if data.get("evidenceStatus").and_then(Value::as_str) == Some("VERIFIED") {
                    verified_outcomes += 1;
                }
            }
            _ => {}
        }
    }
    let contribution = income - expense;
    let coverage = [
        transaction_count > 0,
        minutes > 0,
        outcome_count > 0,
        verified_outcomes > 0,
    ]
    .into_iter()
    .filter(|value| *value)
    .count() as i64
        * 25;
    Ok(json!({
        "baseCurrency":"CNY", "incomeMinor":income.to_string(), "expenseMinor":expense.to_string(), "cashNetMinor":cash_net.to_string(), "managementContributionMinor":contribution.to_string(),
        "timeMinutes":minutes, "unitTimeContributionMinor": if minutes > 0 && transaction_count > 0 { Some((contribution * 60 / minutes as i128).to_string()) } else { None },
        "postedTransactions":transaction_count, "outcomeCount":outcome_count, "verifiedOutcomeCount":verified_outcomes, "dataCoverage":coverage,
        "warnings": if transaction_count == 0 { vec!["尚未记录已入账流水"] } else { Vec::<&str>::new() }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL); CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE records(id TEXT PRIMARY KEY,entity TEXT NOT NULL,data_json TEXT NOT NULL,title TEXT NOT NULL DEFAULT '',body TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,archived_at TEXT,deleted_at TEXT);").unwrap();
        migrate(&connection, "1").unwrap();
        connection
    }

    #[test]
    fn migration_v8_creates_indexes_and_base_currency() {
        let connection = db();
        let version: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version=8",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let currency: String = connection
            .query_row(
                "SELECT value FROM settings WHERE key='base_currency'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let indexes: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'idx_finance_%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, 1);
        assert_eq!(currency, "CNY");
        assert_eq!(indexes, 3);
    }

    #[test]
    fn migration_v14_creates_allocation_indexes() {
        let connection = db();
        migrate_allocations(&connection, "2").unwrap();
        let version: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version=14",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let indexes: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'idx_finance_allocation_%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, 1);
        assert_eq!(indexes, 2);
    }

    #[test]
    fn budget_migration_and_validation_require_a_positive_date_bound_budget() {
        let connection = db();
        migrate_budgets(&connection, "2").unwrap();
        let version: i64 = connection.query_row("SELECT COUNT(*) FROM schema_migrations WHERE version=15", [], |row| row.get(0)).unwrap();
        assert_eq!(version, 1);
        let mut valid = json!({"title":"广告预算","amountMinor":"10000","periodStart":"2026-08-01","periodEnd":"2026-08-31"});
        normalize("financialBudgets", &mut valid).unwrap();
        assert_eq!(valid["baseCurrency"], "CNY");
        let mut invalid = json!({"title":"错误预算","amountMinor":"0","periodStart":"2026-09-01","periodEnd":"2026-08-31"});
        assert!(normalize("financialBudgets", &mut invalid).is_err());
    }

    #[test]
    fn allocation_cannot_exceed_transaction_amount() {
        let connection = db();
        connection.execute(
            "INSERT INTO records(id,entity,data_json,title,body,created_at,updated_at) VALUES('tx','financialTransactions',?1,'','', '1','1')",
            params![json!({"status":"POSTED","transactionType":"EXPENSE","baseAmountMinor":"10000"}).to_string()],
        ).unwrap();
        connection.execute(
            "INSERT INTO records(id,entity,data_json,title,body,created_at,updated_at) VALUES('split-1','financialTransactionAllocations',?1,'','', '1','1')",
            params![json!({"transactionId":"tx","projectId":"p1","amountMinor":"6000"}).to_string()],
        ).unwrap();
        let allocation = json!({"transactionId":"tx","projectId":"p2","amountMinor":"5000"});
        assert!(validate_allocation(&connection, "financialTransactionAllocations", "split-2", &allocation).is_err());
    }

    #[test]
    fn project_summary_uses_allocations_without_changing_global_total() {
        let connection = db();
        connection.execute(
            "INSERT INTO records(id,entity,data_json,title,body,created_at,updated_at) VALUES('tx','financialTransactions',?1,'','', '1','1')",
            params![json!({"status":"POSTED","transactionType":"EXPENSE","baseAmountMinor":"10000"}).to_string()],
        ).unwrap();
        for (id, project_id, amount) in [("split-1", "p1", "4000"), ("split-2", "p2", "6000")] {
            connection.execute(
                "INSERT INTO records(id,entity,data_json,title,body,created_at,updated_at) VALUES(?1,'financialTransactionAllocations',?2,'','', '1','1')",
                params![id, json!({"transactionId":"tx","projectId":project_id,"amountMinor":amount}).to_string()],
            ).unwrap();
        }
        assert_eq!(summary(&connection, Some("p1")).unwrap()["expenseMinor"], "4000");
        assert_eq!(summary(&connection, Some("p2")).unwrap()["expenseMinor"], "6000");
        assert_eq!(summary(&connection, None).unwrap()["expenseMinor"], "10000");
    }

    #[test]
    fn material_decision_freezes_current_project_evidence() {
        let connection = db();
        for (id, entity, data) in [
            (
                "tx",
                "financialTransactions",
                json!({"title":"收入","status":"POSTED","transactionType":"INCOME","baseAmountMinor":"100000","projectId":"p1"}),
            ),
            (
                "time",
                "timeLogs",
                json!({"title":"工作","durationMinutes":60,"projectId":"p1"}),
            ),
            (
                "result",
                "results",
                json!({"title":"结果","projectId":"p1","evidenceStatus":"VERIFIED","actualValue":"1"}),
            ),
        ] {
            connection.execute("INSERT INTO records(id,entity,data_json,title,body,created_at,updated_at) VALUES(?1,?2,?3,'','', '1','1')", params![id, entity, data.to_string()]).unwrap();
        }
        let mut decision = json!({"decisionLevel":"MATERIAL","projectId":"p1"});
        freeze_decision_snapshot(&connection, &mut decision, "2").unwrap();
        assert_eq!(decision["evidenceSnapshotAt"], "2");
        assert_eq!(decision["dataCoverage"], 100);
        assert!(decision["evidenceSnapshot"]
            .as_str()
            .unwrap()
            .contains("100000"));
    }

    #[test]
    fn outcome_amounts_are_calculated_in_minor_units() {
        let mut data = json!({"metricKind":"MONEY","targetAmountMinor":"10000000","actualAmountMinor":"5200000"});
        normalize("results", &mut data).unwrap();
        assert_eq!(data["varianceAmountMinor"], "-4800000");
        assert_eq!(data["achievementBps"], "5200");
    }

    #[test]
    fn posted_transactions_are_immutable_without_voiding() {
        let before = json!({"status":"POSTED","transactionType":"EXPENSE","amountMinor":"10000","baseAmountMinor":"10000","currency":"CNY","baseCurrency":"CNY","accountId":"a","occurredAt":"2026-08-11"});
        let changed = json!({"status":"POSTED","transactionType":"EXPENSE","amountMinor":"20000","baseAmountMinor":"20000","currency":"CNY","baseCurrency":"CNY","accountId":"a","occurredAt":"2026-08-11"});
        assert!(validate_transition("financialTransactions", Some(&before), &changed).is_err());
        let voided = json!({"status":"VOIDED","voidReason":"重复记录"});
        assert!(validate_transition("financialTransactions", Some(&before), &voided).is_ok());
    }

    #[test]
    fn transaction_amounts_must_be_positive() {
        let mut data =
            json!({"transactionType":"EXPENSE","amountMinor":"-100","baseAmountMinor":"-100"});
        assert!(normalize("financialTransactions", &mut data).is_err());
    }
}
