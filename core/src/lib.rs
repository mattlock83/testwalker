//! Testwalker owns execution; adapters own interaction with the system under test.
pub mod adapter;
pub mod cli;
pub mod configuration;
pub mod decision;
pub mod engine;
pub mod graph;
pub mod model;
pub mod properties;
pub mod protocol;
pub mod report;
pub mod rpc;
pub mod session;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fault {
    pub status: String,
    pub message: String,
    #[serde(default)]
    pub result: Value,
}

impl Fault {
    pub fn unknown(message: impl Into<String>) -> Self {
        Self {
            status: "INCONCLUSIVE".into(),
            message: message.into(),
            result: Value::Null,
        }
    }
    pub fn defect(message: impl Into<String>, result: Value) -> Self {
        Self {
            status: "FAIL".into(),
            message: message.into(),
            result,
        }
    }
    pub fn rpc(&self) -> Value {
        let code = if self.result["method_not_found"] == true {
            -32601
        } else {
            -32001
        };
        json!({"code": code, "message": self.message, "data": self})
    }
}
impl std::fmt::Display for Fault {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for Fault {}

/// A target can be a browser, HTTP client, device or any other implementation.
/// Calls return observations, not a trusted overall test verdict.
pub trait Target {
    fn call(&mut self, method: &str, params: Value) -> Result<Value, Fault>;

    /// Provider evidence owned by a native host, when it supplies decisions.
    fn decision_report(&self) -> Option<Value> {
        None
    }

    fn decision_count(&self) -> Option<usize> {
        None
    }
}

impl<T: Target + ?Sized> Target for Box<T> {
    fn call(&mut self, method: &str, params: Value) -> Result<Value, Fault> {
        (**self).call(method, params)
    }
    fn decision_report(&self) -> Option<Value> {
        (**self).decision_report()
    }
    fn decision_count(&self) -> Option<usize> {
        (**self).decision_count()
    }
}
