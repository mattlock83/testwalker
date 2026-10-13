//! JSON-RPC execution and response classification, independent of intended destination.
use super::{
    contract::{self, check, passed, pointer, resolve},
    transport::{Handler, Transport},
};
use crate::{Fault, Target, model::Model};
use serde_json::{Value, json};
use std::{path::PathBuf, time::Duration};
struct Callbacks {
    spec: Value,
    variables: Value,
    input: Value,
    observation: Value,
    bindings: Value,
    methods: Vec<String>,
}
impl Callbacks {
    fn context(&self) -> Value {
        let mut context = self.observation.clone();
        if !context.is_object() {
            context = json!({});
        }
        context["variables"] = self.variables.clone();
        context["input"] = self.input.clone();
        context["fixtures"] = self.spec.get("fixtures").cloned().unwrap_or(json!({}));
        context
    }
}
impl Handler for Callbacks {
    fn handle(
        &mut self,
        transport: &mut Transport,
        method: &str,
        params: Value,
    ) -> Result<Value, Fault> {
        self.methods.push(method.to_owned());
        let definition = self.bindings.get(method).cloned().ok_or_else(|| {
            Fault::unknown(format!(
                "No response is declared for target callback {method}"
            ))
        })?;
        let mut context = self.context();
        context["callback"] = json!({"method":method,"params":params});
        if let Some(set) = definition.get("set") {
            let set = resolve(set, &context)?;
            self.variables
                .as_object_mut()
                .unwrap()
                .extend(set.as_object().unwrap().clone());
        }
        context["variables"] = self.variables.clone();
        if let Some(request) = definition.get("request") {
            let request = resolve(request, &context)?;
            context["callback"]["response"] = transport.request(
                request["method"].as_str().unwrap(),
                request.get("params").cloned(),
                self,
            )?;
        }
        if let Some(captures) = definition["capture"].as_object() {
            for (name, path) in captures {
                self.variables[name] = pointer(&context, path.as_str().unwrap())?.clone();
            }
        }
        context["variables"] = self.variables.clone();
        resolve(&definition["result"], &context)
    }
}
pub struct RpcTarget {
    model: Model,
    argv: Vec<String>,
    timeout: Duration,
    cwd: Option<PathBuf>,
    transport: Option<Transport>,
    callbacks: Callbacks,
    pub trace: Vec<Value>,
    pub events: Vec<Value>,
    pub hooks: Vec<Value>,
    sequence: u64,
}
impl RpcTarget {
    pub fn new(
        model: Model,
        argv: Vec<String>,
        timeout: Duration,
        cwd: Option<PathBuf>,
    ) -> Result<Self, Fault> {
        contract::validate(&model)?;
        let spec = model.graph["properties"]["rpc"].clone();
        let callbacks = Callbacks {
            variables: spec.get("variables").cloned().unwrap_or(json!({})),
            input: json!({}),
            observation: json!({}),
            bindings: spec.get("callbacks").cloned().unwrap_or(json!({})),
            spec,
            methods: vec![],
        };
        Ok(Self {
            model,
            argv,
            timeout,
            cwd,
            transport: None,
            callbacks,
            trace: vec![],
            events: vec![],
            hooks: vec![],
            sequence: 0,
        })
    }
    fn restart(&mut self, reset: bool) -> Result<(), Fault> {
        self.transport.take();
        if reset {
            self.callbacks.variables = self
                .callbacks
                .spec
                .get("variables")
                .cloned()
                .unwrap_or(json!({}));
        }
        self.transport = Some(Transport::spawn(
            &self.argv,
            self.timeout,
            self.cwd.as_deref(),
        )?);
        Ok(())
    }
    fn invoke(&mut self, definition: &Value) -> Result<Value, Fault> {
        let definition = resolve(definition, &self.callbacks.context())?;
        if definition["restart"] == true {
            self.restart(false)?;
        }
        let transport = self
            .transport
            .as_mut()
            .ok_or_else(|| Fault::unknown("JSON-RPC target has not been initialized"))?;
        self.sequence += 1;
        self.callbacks.methods.clear();
        let (message, id, raw) = if let Some(raw) = definition["raw"].as_str() {
            (json!({"raw":raw}), Value::Null, raw.to_owned())
        } else if let Some(envelope) = definition.get("envelope") {
            let id = envelope
                .get("id")
                .filter(|v| v.is_null() || v.is_string() || v.is_number())
                .cloned()
                .unwrap_or(Value::Null);
            (envelope.clone(), id, envelope.to_string())
        } else {
            let id = json!(format!("api/{}", self.sequence));
            let mut msg = json!({"jsonrpc":"2.0","id":id,"method":definition["method"]});
            if let Some(params) = definition.get("params") {
                msg["params"] = params.clone();
            }
            let raw = msg.to_string();
            (msg, id, raw)
        };
        self.callbacks.observation = json!({"request":message,"input":self.callbacks.input});
        let begin = transport.transcript.len();
        let response = transport.exchange_raw(&raw, id, &mut self.callbacks);
        if let Ok(response) = &response {
            self.callbacks.observation["response"] = response.clone();
        }
        let response = response.and_then(|response| {
            if definition["wait_for_exit"] == true {
                transport.wait_for_exit()?;
            }
            Ok(response)
        });
        self.callbacks.observation["callback_methods"] = json!(self.callbacks.methods);
        self.callbacks.observation["variables"] = self.callbacks.variables.clone();
        let exit_code = transport.exit_code();
        self.callbacks.observation["process"] =
            json!({"running":exit_code.is_none(),"exit_code":exit_code});
        let mut entry = self.callbacks.observation.clone();
        entry["operation"] = json!("json-rpc");
        entry["messages"] = json!(transport.transcript[begin..]);
        entry["stderr"] = json!(transport.stderr());
        self.trace.push(entry);
        response.map_err(|mut error| {
            error.result = json!({"request":message,"evidence":self.callbacks.observation});
            error.run_fatal()
        })
    }
    fn context(&self, observation: &Value) -> Value {
        let mut context = observation.clone();
        context["fixtures"] = self
            .callbacks
            .spec
            .get("fixtures")
            .cloned()
            .unwrap_or(json!({}));
        context
    }
    pub fn evaluate(&self, observation: &Value) -> Result<Value, Fault> {
        let context = self.context(observation);
        let mut matches = Vec::new();
        let mut diagnostics = json!({});
        for (id, state) in &self.model.states {
            let result = check(&state["properties"]["rpc"]["match"], &context)?;
            if passed(&result) {
                matches.push(id.clone());
            }
            diagnostics[id] = result;
        }
        let observed = if matches.len() == 1 {
            Some(matches[0].clone())
        } else {
            None
        };
        let mut checks = Vec::new();
        let mut bindings = vec![("global", &self.callbacks.spec["rules"])];
        if let Some(id) = &observed {
            bindings.push((
                "state",
                &self.model.states[id]["properties"]["rpc"]["rules"],
            ));
        }
        for (scope, rules) in bindings {
            for (rule, predicates) in rules.as_object().unwrap() {
                let result = check(predicates, &context)?;
                checks.push(json!({"rule":rule,"scope":scope,"status":if passed(&result) {"met"} else {"broken"},"predicates":result}));
            }
        }
        let mut result = json!({"observed":observed,"checks":checks,"matching_states":matches});
        if observed.is_none() {
            result["reason"] = json!(if matches.is_empty() {
                "RPC response matches no state"
            } else {
                "RPC response matches multiple states"
            });
            result["state_diagnostics"] = diagnostics;
        }
        Ok(result)
    }
    pub fn close(&mut self) {
        self.transport.take();
    }
}
impl Target for RpcTarget {
    fn call(&mut self, method: &str, params: Value) -> Result<Value, Fault> {
        match method {
            "run.event" => {
                self.events.push(params);
                Ok(json!({}))
            }
            "target.hook" => {
                self.hooks.push(params);
                Ok(json!({}))
            }
            "target.initialize" => Ok(
                json!({"capabilities":{"evaluator":"adapter","isolated_checkpoints":false,"artifacts":true,"screenshots":false}}),
            ),
            "target.reset" => {
                self.callbacks.input = json!({});
                self.callbacks.bindings = self
                    .callbacks
                    .spec
                    .get("callbacks")
                    .cloned()
                    .unwrap_or(json!({}));
                self.restart(true)?;
                self.invoke(&self.callbacks.spec["reset"].clone())?;
                Ok(json!({}))
            }
            "target.execute" => {
                self.callbacks.input = params["input"].clone();
                let binding = &params["edge"]["properties"]["rpc"];
                self.callbacks.bindings = self
                    .callbacks
                    .spec
                    .get("callbacks")
                    .cloned()
                    .unwrap_or(json!({}));
                if let Some(overrides) = binding["callbacks"].as_object() {
                    self.callbacks
                        .bindings
                        .as_object_mut()
                        .unwrap()
                        .extend(overrides.clone());
                }
                self.invoke(&binding["request"])?;
                if let Some(captures) = binding["capture"].as_object() {
                    for (name, path) in captures {
                        self.callbacks.variables[name] =
                            pointer(&self.callbacks.context(), path.as_str().unwrap())?.clone();
                    }
                }
                self.callbacks.observation["variables"] = self.callbacks.variables.clone();
                self.trace.last_mut().unwrap()["variables"] = self.callbacks.variables.clone();
                Ok(json!({"executed":true}))
            }
            "target.observe" => Ok(self.callbacks.observation.clone()),
            "target.evaluate" => self.evaluate(&params["observation"]),
            "target.audit" => {
                let mut checks = Vec::new();
                for rule in params["rules"].as_array().unwrap() {
                    let mut results = Vec::new();
                    for record in params["records"].as_array().unwrap() {
                        if record["evidence"].is_object() {
                            results.push(check(
                                &self.callbacks.spec["rules"][rule.as_str().unwrap()],
                                &self.context(&record["evidence"]),
                            )?);
                        }
                    }
                    let met = !results.is_empty() && results.iter().all(passed);
                    checks.push(json!({"rule":rule,"scope":"global","status":if met {"met"} else {"broken"},"predicates":results}));
                }
                Ok(json!(checks))
            }
            "target.artifacts" => {
                let offset = params["offset"].as_u64().unwrap_or(0) as usize;
                let limit = params["limit"].as_u64().unwrap_or(128).min(128) as usize;
                let total = self.trace.len() + self.hooks.len();
                if offset > total || limit == 0 {
                    return Err(Fault::unknown("Invalid artifact page"));
                }
                let entries = self
                    .trace
                    .iter()
                    .map(|data| json!({"kind":"trace","data":data}))
                    .chain(
                        self.hooks
                            .iter()
                            .map(|data| json!({"kind":"hook","data":data})),
                    )
                    .skip(offset)
                    .take(limit)
                    .collect::<Vec<_>>();
                let next = offset + entries.len();
                Ok(
                    json!({"entries":entries,"next_offset":if next < total {Some(next)} else {None}}),
                )
            }
            "target.close" => {
                self.close();
                Ok(json!({}))
            }
            _ => Err(Fault::unknown(format!(
                "The RPC target does not implement {method}"
            ))),
        }
    }
}
