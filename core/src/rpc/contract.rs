//! Typed JSON templates and independent deterministic assertions. No expression evaluator.
use crate::{
    Fault,
    model::{Model, business},
};
use rust_decimal::Decimal;
use serde_json::{Value, json};
use std::str::FromStr;

fn require(ok: bool, message: &str) -> Result<(), Fault> {
    if ok {
        Ok(())
    } else {
        Err(Fault::unknown(format!("Invalid RPC contract: {message}")))
    }
}
fn shape(value: &Value, allowed: &[&str], required: &[&str]) -> Result<(), Fault> {
    let object = value
        .as_object()
        .ok_or_else(|| Fault::unknown("RPC binding must be an object"))?;
    require(
        object.keys().all(|k| allowed.contains(&k.as_str()))
            && required.iter().all(|k| object.contains_key(*k)),
        "unsupported or missing fields",
    )
}
fn tokens(path: &str) -> Result<Vec<String>, Fault> {
    require(
        path.is_empty() || path.starts_with('/'),
        "path must be a JSON Pointer",
    )?;
    let mut result = Vec::new();
    for part in path.split('/').skip(1) {
        let mut chars = part.chars();
        let mut token = String::new();
        while let Some(c) = chars.next() {
            token.push(if c == '~' {
                match chars.next() {
                    Some('0') => '~',
                    Some('1') => '/',
                    _ => return Err(Fault::unknown("Invalid JSON Pointer escape")),
                }
            } else {
                c
            });
        }
        result.push(token);
    }
    Ok(result)
}
pub fn pointer<'a>(value: &'a Value, path: &str) -> Result<&'a Value, Fault> {
    let mut current = value;
    for token in tokens(path)? {
        current = match current {
            Value::Object(map) => map.get(&token),
            Value::Array(array)
                if token == "0"
                    || (!token.starts_with('0') && token.bytes().all(|c| c.is_ascii_digit())) =>
            {
                token.parse::<usize>().ok().and_then(|i| array.get(i))
            }
            _ => None,
        }
        .ok_or_else(|| Fault::unknown(format!("Unresolved JSON Pointer: {path}")))?;
    }
    Ok(current)
}
fn template(value: &Value, depth: usize, refs: bool) -> Result<(), Fault> {
    require(depth <= 64, "JSON nesting exceeds 64 levels")?;
    match value {
        Value::Object(map) if refs && map.contains_key("$ref") => {
            shape(value, &["$ref"], &["$ref"])?;
            let path = value["$ref"]
                .as_str()
                .ok_or_else(|| Fault::unknown("Reference must be a JSON Pointer"))?;
            let parts = tokens(path)?;
            require(
                parts.first().is_some_and(|p| {
                    [
                        "input",
                        "fixtures",
                        "variables",
                        "request",
                        "response",
                        "callback",
                    ]
                    .contains(&p.as_str())
                }),
                "references must name an observation scope",
            )
        }
        Value::Object(map) => {
            for child in map.values() {
                template(child, depth + 1, refs)?;
            }
            Ok(())
        }
        Value::Array(array) => {
            for child in array {
                template(child, depth + 1, refs)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}
pub fn resolve(value: &Value, context: &Value) -> Result<Value, Fault> {
    template(value, 0, true)?;
    fn visit(value: &Value, context: &Value) -> Result<Value, Fault> {
        Ok(match value {
            Value::Object(map) if map.contains_key("$ref") => {
                pointer(context, value["$ref"].as_str().unwrap())?.clone()
            }
            Value::Object(map) => Value::Object(
                map.iter()
                    .map(|(k, v)| Ok((k.clone(), visit(v, context)?)))
                    .collect::<Result<_, Fault>>()?,
            ),
            Value::Array(array) => Value::Array(
                array
                    .iter()
                    .map(|v| visit(v, context))
                    .collect::<Result<_, _>>()?,
            ),
            _ => value.clone(),
        })
    }
    visit(value, context)
}
const OPS: &[&str] = &[
    "equals",
    "not_equals",
    "type",
    "exists",
    "length",
    "contains",
    "subset",
];
pub fn validate_predicates(value: &Value) -> Result<(), Fault> {
    let array = value
        .as_array()
        .filter(|a| !a.is_empty() && a.len() <= 100)
        .ok_or_else(|| Fault::unknown("Checks need 1–100 predicates"))?;
    for predicate in array {
        let mut allowed = OPS.to_vec();
        allowed.push("path");
        shape(predicate, &allowed, &["path"])?;
        tokens(
            predicate["path"]
                .as_str()
                .ok_or_else(|| Fault::unknown("Predicate path must be text"))?,
        )?;
        let operations: Vec<_> = OPS
            .iter()
            .filter(|op| predicate.get(**op).is_some())
            .collect();
        require(
            operations.len() == 1,
            "predicate must have exactly one operation",
        )?;
        let op = *operations[0];
        let expected = &predicate[op];
        match op {
            "type" => require(
                expected.as_str().is_some_and(|s| {
                    [
                        "null", "boolean", "number", "integer", "string", "array", "object",
                    ]
                    .contains(&s)
                }),
                "unsupported JSON type",
            )?,
            "exists" => require(expected.is_boolean(), "exists must be boolean")?,
            "length" => {
                shape(expected, &["min", "max", "exact"], &[])?;
                let object = expected.as_object().unwrap();
                require(
                    !object.is_empty() && object.values().all(|v| v.as_u64().is_some()),
                    "length limits must be nonnegative integers",
                )?;
                require(
                    !object.contains_key("exact") || object.len() == 1,
                    "exact length cannot have bounds",
                )?;
                require(
                    expected["min"].as_u64().unwrap_or(0)
                        <= expected["max"].as_u64().unwrap_or(u64::MAX),
                    "length bounds are inverted",
                )?;
            }
            _ => template(expected, 0, true)?,
        }
    }
    Ok(())
}
pub fn equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => {
            if a == b {
                return true;
            }
            let decimal = |n: &serde_json::Number| {
                Decimal::from_str(&n.to_string())
                    .or_else(|_| Decimal::from_scientific(&n.to_string()))
            };
            match (decimal(a), decimal(b)) {
                (Ok(a), Ok(b)) => a == b,
                _ => a.is_f64() && b.is_f64() && a.as_f64() == b.as_f64(),
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| equal(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len() && a.iter().all(|(k, v)| b.get(k).is_some_and(|b| equal(v, b)))
        }
        _ => a == b,
    }
}
fn subset(actual: &Value, expected: &Value) -> bool {
    match expected {
        Value::Object(map) => actual.as_object().is_some_and(|a| {
            map.iter()
                .all(|(k, v)| a.get(k).is_some_and(|a| subset(a, v)))
        }),
        Value::Array(items) => actual
            .as_array()
            .is_some_and(|a| items.iter().all(|v| a.iter().any(|a| equal(a, v)))),
        _ => equal(actual, expected),
    }
}
fn compare(op: &str, actual: &Value, expected: &Value) -> bool {
    match op {
        "equals" => equal(actual, expected),
        "not_equals" => !equal(actual, expected),
        "type" => match expected.as_str().unwrap_or("") {
            "null" => actual.is_null(),
            "boolean" => actual.is_boolean(),
            "number" => actual.is_number(),
            "integer" => actual.is_i64() || actual.is_u64(),
            "string" => actual.is_string(),
            "array" => actual.is_array(),
            "object" => actual.is_object(),
            _ => false,
        },
        "subset" => subset(actual, expected),
        "contains" => match actual {
            Value::Array(a) => a.iter().any(|v| equal(v, expected)),
            Value::Object(a) => expected.as_str().is_some_and(|s| a.contains_key(s)),
            Value::String(a) => expected.as_str().is_some_and(|s| a.contains(s)),
            _ => false,
        },
        "length" => {
            let n = match actual {
                Value::String(s) => Some(s.chars().count() as u64),
                Value::Array(a) => Some(a.len() as u64),
                Value::Object(a) => Some(a.len() as u64),
                _ => None,
            };
            n.is_some_and(|n| {
                if let Some(exact) = expected["exact"].as_u64() {
                    n == exact
                } else {
                    n >= expected["min"].as_u64().unwrap_or(0)
                        && n <= expected["max"].as_u64().unwrap_or(u64::MAX)
                }
            })
        }
        _ => false,
    }
}
pub fn check(predicates: &Value, context: &Value) -> Result<Value, Fault> {
    validate_predicates(predicates)?;
    let mut results = Vec::new();
    for predicate in predicates.as_array().unwrap() {
        let op = OPS.iter().find(|op| predicate.get(**op).is_some()).unwrap();
        let actual = pointer(context, predicate["path"].as_str().unwrap()).ok();
        let mut result = json!({"path":predicate["path"],"operation":op,"expected":predicate[*op],"actual":actual,"present":actual.is_some(),"passed":false});
        match resolve(&predicate[*op], context) {
            Err(error) => result["error"] = json!(error.message),
            Ok(expected) => {
                result["expected"] = expected.clone();
                if *op == "exists" {
                    result["passed"] = json!(actual.is_some() == expected.as_bool().unwrap());
                } else if let Some(actual) = actual {
                    result["passed"] = json!(compare(op, actual, &expected));
                } else {
                    result["error"] = json!("Actual JSON Pointer does not exist");
                }
            }
        }
        results.push(result);
    }
    Ok(json!(results))
}
pub fn passed(checks: &Value) -> bool {
    checks
        .as_array()
        .is_some_and(|a| a.iter().all(|v| v["passed"] == true))
}
fn request(value: &Value, reset: bool) -> Result<(), Fault> {
    for key in ["restart", "wait_for_exit"] {
        require(
            value.get(key).is_none_or(Value::is_boolean),
            "request metadata must be boolean",
        )?;
    }
    if let Some(method) = value.get("method") {
        shape(
            value,
            &["method", "params", "restart", "wait_for_exit"],
            &["method"],
        )?;
        require(
            method.as_str().is_some_and(|s| !s.trim().is_empty()),
            "method must be nonempty text",
        )?;
        template(&value["params"], 0, true)
    } else if !reset && value.get("raw").is_some() {
        shape(value, &["raw", "restart", "wait_for_exit"], &["raw"])?;
        require(
            value["raw"]
                .as_str()
                .is_some_and(|s| !s.contains(['\n', '\r'])),
            "raw request must be a single line",
        )
    } else if !reset && value.get("envelope").is_some() {
        shape(
            value,
            &["envelope", "restart", "wait_for_exit"],
            &["envelope"],
        )?;
        template(&value["envelope"], 0, true)
    } else {
        Err(Fault::unknown(
            "RPC request needs a method, raw line or envelope",
        ))
    }
}
fn bindings(rpc: &Value, element: &Value) -> Result<(), Fault> {
    let rules = rpc["rules"]
        .as_object()
        .ok_or_else(|| Fault::unknown("RPC rules must be an object"))?;
    let business_rules = business(element)["rules"].as_array().unwrap();
    require(
        rules.len() == business_rules.len()
            && business_rules
                .iter()
                .all(|r| rules.contains_key(r.as_str().unwrap())),
        "bind every business rule exactly once",
    )?;
    for predicates in rules.values() {
        validate_predicates(predicates)?;
    }
    Ok(())
}
fn capture(value: &Value) -> Result<(), Fault> {
    let map = value
        .as_object()
        .ok_or_else(|| Fault::unknown("Capture must be an object"))?;
    for (name, path) in map {
        require(!name.trim().is_empty(), "capture name must be nonempty")?;
        tokens(
            path.as_str()
                .ok_or_else(|| Fault::unknown("Capture path must be a JSON Pointer"))?,
        )?;
    }
    Ok(())
}
fn callbacks(value: &Value) -> Result<(), Fault> {
    let map = value
        .as_object()
        .ok_or_else(|| Fault::unknown("Callbacks must be an object"))?;
    for (method, def) in map {
        require(
            !method.trim().is_empty(),
            "callback method must be nonempty",
        )?;
        shape(def, &["result", "set", "request", "capture"], &["result"])?;
        template(&def["result"], 0, true)?;
        if let Some(set) = def.get("set") {
            require(set.is_object(), "callback set must be an object")?;
            template(set, 0, true)?;
        }
        if let Some(req) = def.get("request") {
            shape(req, &["method", "params"], &["method"])?;
            request(req, true)?;
        }
        if let Some(cap) = def.get("capture") {
            capture(cap)?;
        }
    }
    Ok(())
}
pub fn validate(model: &Model) -> Result<(), Fault> {
    let spec = &model.graph["properties"]["rpc"];
    shape(
        spec,
        &[
            "version",
            "fixtures",
            "variables",
            "reset",
            "rules",
            "callbacks",
        ],
        &["version", "reset", "rules"],
    )?;
    require(spec["version"].as_u64() == Some(1), "RPC version must be 1")?;
    for key in ["fixtures", "variables"] {
        if let Some(v) = spec.get(key) {
            require(v.is_object(), "fixtures/variables must be objects")?;
            template(v, 0, false)?;
        }
    }
    request(&spec["reset"], true)?;
    bindings(spec, &model.graph)?;
    if let Some(cb) = spec.get("callbacks") {
        callbacks(cb)?;
    }
    for state in model.states.values() {
        let rpc = &state["properties"]["rpc"];
        shape(rpc, &["match", "rules"], &["match", "rules"])?;
        validate_predicates(&rpc["match"])?;
        bindings(rpc, state)?;
    }
    for edge in model.edges.values() {
        let rpc = &edge["properties"]["rpc"];
        shape(rpc, &["request", "capture", "callbacks"], &["request"])?;
        request(&rpc["request"], false)?;
        if let Some(cap) = rpc.get("capture") {
            capture(cap)?;
        }
        if let Some(cb) = rpc.get("callbacks") {
            callbacks(cb)?;
        }
    }
    Ok(())
}
